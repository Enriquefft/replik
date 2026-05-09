import { logger, metadata, task } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys, products } from "@/db/schema"
import { cuesToSrt, translateSrt } from "@/lib/ai/srt-translate.ts"
import { transcribe } from "@/lib/ai/transcribe.ts"
import { logError, withTiming } from "@/lib/observability/log.ts"
import { burnSubs, uploadEditedVideo, uploadSrt } from "@/lib/video"
import type { BurnPhase } from "./metadata.ts"

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

    try {
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
            productId: creatives.productId,
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

      // 2b. Load product for brand tokens (§10 brand-token preservation).
      const product = await withUser(userId, async (db) => {
        const rows = await db
          .select({ brandTokens: products.brandTokens })
          .from(products)
          .where(and(eq(products.id, creative.productId), eq(products.userId, userId)))
          .limit(1)
        return rows[0]
      })
      if (!product) throw new Error(`product not found for creative: ${creativeId}`)

      // 3. Resolve original video + source SRT assets in one round-trip.
      const ownedAssets = await withUser(userId, async (db) => {
        return await db
          .select({ kind: assets.kind, url: assets.url })
          .from(assets)
          .where(and(eq(assets.ownerType, "creative"), eq(assets.ownerId, creativeId)))
      })
      const originalAsset = ownedAssets.find((a) => a.kind === "original_video")
      const sourceSrtAsset = ownedAssets.find((a) => a.kind === "srt")
      if (!originalAsset) {
        throw new Error(`original_video asset missing for creative ${creativeId}`)
      }

      // Music-only fast-path: Whisper found no speech (transcriptText === "")
      // so there is nothing to translate or burn. Re-publish the original
      // video URL as the `edited_video` asset so the publish gate's
      // editedAssets count matches selectedCreatives. The same UploadThing
      // URL is reused — no re-upload, no transcode.
      if (creative.transcriptText === "") {
        const language = creative.language ?? "es"
        logger.info("translateAndBurnSubs:music-only-fast-path", {
          creativeId,
          language,
          originalUrl: originalAsset.url,
        })
        await withUser(userId, async (db) => {
          await db
            .insert(assets)
            .values({
              ownerType: "creative",
              ownerId: creativeId,
              kind: "edited_video",
              url: originalAsset.url,
              bytes: null,
              mime: "video/mp4",
            })
            .onConflictDoUpdate({
              target: [assets.ownerType, assets.ownerId, assets.kind],
              set: { url: originalAsset.url, bytes: null, mime: "video/mp4" },
            })
          await db
            .update(creatives)
            .set({ translated: false })
            .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
        })
        const persisted = await loadPersistedAssets(userId, creativeId)
        if (persisted) return persisted
        return {
          editedUrl: originalAsset.url,
          srtUrl: sourceSrtAsset?.url ?? "",
          language,
          translated: false,
        }
      }

      // 4. Resolve the source SRT. Fast path: read the persisted asset from
      // UploadThing (text/plain, cheap). Backfill path: creatives scraped
      // before the scrape-time SRT rollout have no asset row, so re-Whisper
      // the original video once and persist for future burns.
      metadata.set("phase", "transcribe" satisfies BurnPhase)
      let sourceSrt: string
      const language = creative.language ?? "es"
      if (sourceSrtAsset) {
        logger.info("source_srt_load_started", { creativeId })
        const srtResponse = await fetch(sourceSrtAsset.url, { redirect: "follow" })
        if (!srtResponse.ok) {
          throw new Error(
            `source srt download failed ${srtResponse.status.toString()} ${srtResponse.statusText}`,
          )
        }
        sourceSrt = await srtResponse.text()
        if (sourceSrt.length === 0) {
          throw new Error(`source srt empty for creative ${creativeId}`)
        }
        logger.info("source_srt_loaded", {
          creativeId,
          language,
          srtBytes: sourceSrt.length,
        })
      } else {
        logger.info("source_srt_backfill_started", { creativeId })
        const videoResponse = await fetch(originalAsset.url, { redirect: "follow" })
        if (!videoResponse.ok) {
          throw new Error(
            `original video download failed ${videoResponse.status.toString()} ${videoResponse.statusText}`,
          )
        }
        const audioBuffer = Buffer.from(await videoResponse.arrayBuffer())
        const transcribed = await withTiming(
          "task.translateAndBurn.transcribe_backfill",
          () => transcribe({ mode: "srt", audio: audioBuffer }),
          { creativeId },
        )
        if (transcribed.srt === null || transcribed.srt.length === 0) {
          throw new Error(`backfill transcribe returned empty SRT for creative ${creativeId}`)
        }
        sourceSrt = transcribed.srt
        logger.info("source_srt_backfilled", {
          creativeId,
          language,
          srtBytes: sourceSrt.length,
        })
      }

      // 5. Translate when source isn't Spanish (§10).
      let finalSrt: string
      let translated: boolean
      if (language === "es") {
        finalSrt = sourceSrt
        translated = false
      } else {
        metadata.set("phase", "translate" satisfies BurnPhase)
        logger.info("translate_started", {
          creativeId,
          from: language,
          to: "es-PE",
        })
        const result = await withTiming(
          "task.translateAndBurn.translate",
          () =>
            translateSrt({
              sourceSrt,
              brandTokens: product.brandTokens,
              targetLocale: "es-PE",
            }),
          { creativeId },
        )
        finalSrt = cuesToSrt(result.cues)
        translated = result.translated
        logger.info("translate_done", {
          creativeId,
          srtBytes: finalSrt.length,
          translated,
        })
      }

      // 6. Upload the final (possibly translated) SRT and persist as the
      // canonical SRT asset for this creative. Scrape pass already inserted a
      // source-language SRT under the same `(ownerType, ownerId, srt)` key;
      // overwrite so downstream readers see the SRT that's actually burned
      // into the video.
      const srtUpload = await uploadSrt(finalSrt, `${creativeId}.srt`)
      await withUser(userId, async (db) => {
        await db
          .insert(assets)
          .values({
            ownerType: "creative",
            ownerId: creativeId,
            kind: "srt",
            url: srtUpload.url,
            bytes: Buffer.byteLength(finalSrt, "utf8"),
            mime: "text/plain",
          })
          .onConflictDoUpdate({
            target: [assets.ownerType, assets.ownerId, assets.kind],
            set: {
              url: srtUpload.url,
              bytes: Buffer.byteLength(finalSrt, "utf8"),
              mime: "text/plain",
            },
          })
      })

      // 7. Burn the SRT into the video.
      metadata.set("phase", "burn" satisfies BurnPhase)
      logger.info("burn_started", { creativeId })
      const burned = await withTiming(
        "task.translateAndBurn.burn",
        () => burnSubs({ videoUrl: originalAsset.url, srt: finalSrt }),
        { creativeId },
      )
      metadata.set("bytes", burned.buffer.byteLength)
      logger.info("burn_done", {
        creativeId,
        bytes: burned.buffer.byteLength,
      })

      // 8. Upload the edited video.
      metadata.set("phase", "upload" satisfies BurnPhase)
      const videoUpload = await withTiming(
        "task.translateAndBurn.upload",
        () => uploadEditedVideo(burned.buffer, `${creativeId}.mp4`),
        { creativeId },
      )
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

      // 10. Persist `translated` flag onto the creatives row so the UI can
      // surface a badge when the fallback fired (§10 / §6 Phase 3 item 5).
      await withUser(userId, async (db) => {
        await db
          .update(creatives)
          .set({ translated })
          .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
      })

      return {
        editedUrl: videoUpload.url,
        srtUrl: srtUpload.url,
        language,
        translated,
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logError("task.translateAndBurn.fatal", { creativeId, userId, attempt, reason })
      throw err
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
    const creativeRow = await db
      .select({
        language: creatives.language,
        translated: creatives.translated,
        transcriptText: creatives.transcriptText,
      })
      .from(creatives)
      .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
      .limit(1)
    return { rows, creativeRow: creativeRow[0] ?? null }
  })
  const edited = result.rows.find((r) => r.kind === "edited_video")
  const srt = result.rows.find((r) => r.kind === "srt")
  if (!edited) return null
  const lang = result.creativeRow?.language ?? "unknown"
  // Read the persisted flag directly — inferring from language was wrong because
  // it returned `true` for any non-es source even when the fallback fired.
  // Null means the previous run pre-dates the column; fall back to language heuristic
  // only for those legacy rows.
  const translated = result.creativeRow?.translated ?? lang !== "es"
  // Music-only creatives have no SRT (Whisper found no speech). The
  // transcriptText === "" signal — set by scrapeProduct's empty-transcript
  // branch — means a missing SRT row is expected, not a half-completed run.
  if (!srt) {
    if (result.creativeRow?.transcriptText === "") {
      return {
        editedUrl: edited.url,
        srtUrl: "",
        language: lang,
        translated,
      }
    }
    return null
  }
  return {
    editedUrl: edited.url,
    srtUrl: srt.url,
    language: lang,
    translated,
  }
}
