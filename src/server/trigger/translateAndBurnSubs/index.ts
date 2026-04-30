import { logger, task } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys } from "@/db/schema"
import { transcribe } from "@/lib/ai/transcribe.ts"
import { burnSubs, translateSrt, uploadEditedVideo, uploadSrt } from "@/lib/video"

interface TranslateAndBurnSubsPayload {
  creativeId: string
  userId: string
  attempt?: number
}

interface TranslateAndBurnSubsResult {
  editedUrl: string
  srtUrl: string
  language: string
  translated: boolean
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Lane L3b — Whisper transcribe → Claude translate (when needed) → libass
 * burn-in → UploadThing. Persists the SRT and the edited video as `assets`
 * rows so downstream lanes (publishLanding, ad creative upload) can read them
 * by `creativeId`.
 *
 * Idempotency: insert one row per `(creativeId, attempt)`. On conflict we
 * short-circuit by reading the persisted edited_video / srt assets.
 */
export const translateAndBurnSubsTask = task({
  id: "translateAndBurnSubs",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  machine: "large-1x",
  run: async (
    payload: TranslateAndBurnSubsPayload,
    { ctx },
  ): Promise<TranslateAndBurnSubsResult> => {
    const { creativeId, userId } = payload
    const attempt = payload.attempt ?? ctx.attempt.number
    logger.info("translateAndBurnSubs:start", {
      creativeId,
      userId,
      attempt,
    })

    // 1. Idempotency row. On conflict, replay from persisted assets.
    const idemKey = `burn_${creativeId}_${attempt.toString()}`
    const replay = await withUser(userId, async (db) => {
      const inserted = await db
        .insert(idempotencyKeys)
        .values({
          key: idemKey,
          userId,
          expiresAt: new Date(Date.now() + ONE_DAY_MS),
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key })
      return inserted.length === 0
    })
    if (replay) {
      logger.info("translateAndBurnSubs:idempotent-replay", { idemKey })
      const persisted = await loadPersistedAssets(userId, creativeId)
      if (persisted) return persisted
      // Idempotency row exists but assets missing → previous attempt crashed
      // mid-pipeline. Fall through and re-run the work.
    }

    // 2. Load creative inside tenant scope. Guard `selected` and transcript.
    const creative = await withUser(userId, async (db) => {
      const rows = await db
        .select({
          id: creatives.id,
          transcriptText: creatives.transcriptText,
          language: creatives.language,
          selectedBool: creatives.selectedBool,
        })
        .from(creatives)
        .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
        .limit(1)
      return rows[0]
    })
    if (!creative) throw new Error(`creative not found: ${creativeId}`)
    if (!creative.selectedBool) {
      throw new Error(`creative not selected: ${creativeId}`)
    }
    if (creative.transcriptText === null) {
      throw new Error(`creative transcript missing: ${creativeId}`)
    }

    // 3. Resolve original video asset.
    const originalAsset = await withUser(userId, async (db) => {
      const rows = await db
        .select({ url: assets.url })
        .from(assets)
        .where(
          and(
            eq(assets.ownerType, "creative"),
            eq(assets.ownerId, creativeId),
            eq(assets.kind, "original_video"),
          ),
        )
        .limit(1)
      return rows[0]
    })
    if (!originalAsset) {
      throw new Error(`original_video asset missing for creative ${creativeId}`)
    }

    // 4. Re-transcribe to obtain a real timed SRT. L3a only persists plain
    // text; we cannot fabricate timestamps from it.
    logger.info("transcribe_started", { creativeId })
    const videoResponse = await fetch(originalAsset.url, { redirect: "follow" })
    if (!videoResponse.ok) {
      throw new Error(
        `original video download failed ${videoResponse.status.toString()} ${videoResponse.statusText}`,
      )
    }
    const audioBuffer = Buffer.from(await videoResponse.arrayBuffer())
    const transcribed = await transcribe({ mode: "srt", audio: audioBuffer })
    if (transcribed.srt === null || transcribed.srt.length === 0) {
      throw new Error(`transcribe returned empty SRT for creative ${creativeId}`)
    }
    logger.info("transcribe_done", {
      creativeId,
      language: transcribed.language,
      srtBytes: transcribed.srt.length,
    })

    // Whisper's `language` is the raw two-letter code (e.g. "en", "es").
    // The DB column is informational only; whatever L3a stored takes
    // precedence for display, but the burn pipeline relies on Whisper's
    // detection (it's tied to the actual SRT we just produced).
    const language = transcribed.language
    const sourceSrt = transcribed.srt

    // 5. Translate when source isn't Spanish.
    let finalSrt: string
    let translated: boolean
    if (language === "es") {
      finalSrt = sourceSrt
      translated = false
    } else {
      logger.info("translate_started", {
        creativeId,
        from: language,
        to: "es-PE",
      })
      finalSrt = await translateSrt(sourceSrt, "es-PE")
      translated = true
      logger.info("translate_done", {
        creativeId,
        srtBytes: finalSrt.length,
      })
    }

    // 6. Upload the SRT and persist as an asset.
    const srtUpload = await uploadSrt(finalSrt, `${creativeId}.srt`)
    await withUser(userId, async (db) => {
      await db.insert(assets).values({
        ownerType: "creative",
        ownerId: creativeId,
        kind: "srt",
        url: srtUpload.url,
        bytes: Buffer.byteLength(finalSrt, "utf8"),
        mime: "text/plain",
      })
    })

    // 7. Burn the SRT into the video.
    logger.info("burn_started", { creativeId })
    const burned = await burnSubs({
      videoUrl: originalAsset.url,
      srt: finalSrt,
    })
    logger.info("burn_done", {
      creativeId,
      bytes: burned.buffer.byteLength,
    })

    // 8. Upload the edited video.
    const videoUpload = await uploadEditedVideo(burned.buffer, `${creativeId}.mp4`)
    logger.info("upload_done", {
      creativeId,
      key: videoUpload.key,
      url: videoUpload.url,
    })

    // 9. Persist edited video asset.
    await withUser(userId, async (db) => {
      await db.insert(assets).values({
        ownerType: "creative",
        ownerId: creativeId,
        kind: "edited_video",
        url: videoUpload.url,
        bytes: burned.buffer.byteLength,
        mime: "video/mp4",
      })
    })

    return {
      editedUrl: videoUpload.url,
      srtUrl: srtUpload.url,
      language,
      translated,
    }
  },
})

async function loadPersistedAssets(
  userId: string,
  creativeId: string,
): Promise<TranslateAndBurnSubsResult | null> {
  const result = await withUser(userId, async (db) => {
    const rows = await db
      .select({ kind: assets.kind, url: assets.url })
      .from(assets)
      .where(and(eq(assets.ownerType, "creative"), eq(assets.ownerId, creativeId)))
    const language = await db
      .select({ language: creatives.language })
      .from(creatives)
      .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
      .limit(1)
    return { rows, language: language[0]?.language ?? null }
  })
  const edited = result.rows.find((r) => r.kind === "edited_video")
  const srt = result.rows.find((r) => r.kind === "srt")
  if (!edited || !srt) return null
  const lang = result.language ?? "unknown"
  return {
    editedUrl: edited.url,
    srtUrl: srt.url,
    language: lang,
    translated: lang !== "es",
  }
}
