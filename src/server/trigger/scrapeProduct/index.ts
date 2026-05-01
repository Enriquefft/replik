import "server-only"

/**
 * Lane L3a — Scrape pipeline orchestrator (Trigger.dev v4).
 *
 * Four-step pipeline:
 *   1. scrapeProductInfo — §7 four-stage scrape (deterministic Stage A +
 *      Sonnet 4.6 gap-fill in Stage C). Returns either `READY` with the
 *      fully-resolved product + keyword tiers, or `SCRAPE_PARTIAL` with the
 *      best-effort partial. Either branch backfills product fields.
 *   2. findAds — try `meta.adLibrarySearch`, fall back to Apify on
 *      empty/error. If both empty → `products.status='SCRAPE_EMPTY'`.
 *   3. transcribeAds — for each creative, download video, push original to
 *      UploadThing, transcribe via the canonical §9 entry point (skip if
 *      > 25 MB), persist transcript + language.
 *   4. classifyAngle — §12 self-consistency classifier (5 parallel Sonnet
 *      calls, majority/tie-break vote) → SalesAngle | null per creative.
 *
 * Idempotency: a row in `idempotency_keys` keyed by
 * `scrape_${productId}_${attempt}` short-circuits a duplicate run with the
 * last-known summary.
 */

import { logger, task } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { UTApi } from "uploadthing/server"

import { withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys, products } from "@/db/schema"
import { classifyAngle } from "@/lib/ai/angle-classify.ts"
import { imperativeVerbCheck } from "@/lib/ai/guards.ts"
import { scrapeProductInfo } from "@/lib/ai/scrape.ts"
import { transcribe } from "@/lib/ai/transcribe.ts"
import * as apify from "@/lib/apify"
import * as meta from "@/lib/meta"

const TASK_ID = "scrape-product"
const MAX_ADS = 20
const WHISPER_MAX_BYTES = 25 * 1024 * 1024
const TRANSCRIBE_CONCURRENCY = 3
const IDEMPOTENCY_TTL_DAYS = 7

interface ScrapeSummary {
  creativeCount: number
  withTranscript: number
  withAngle: number
  source: "meta_ad_library" | "apify_fb" | "none"
}

let cachedUTApi: UTApi | undefined

function getUTApi(): UTApi {
  cachedUTApi ??= new UTApi()
  return cachedUTApi
}

interface FoundAd {
  source: "meta_ad_library" | "apify_fb"
  ad_id: string
  scrape_url: string
}

async function findAds(
  keywords: string[],
): Promise<{ ads: FoundAd[]; source: "meta_ad_library" | "apify_fb" | "none" }> {
  const searchTerms = keywords.join(" ")
  // Try Meta Ad Library first.
  try {
    const metaAds = await meta.adLibrarySearch({
      searchTerms,
      countries: ["PE"],
      limit: MAX_ADS,
    })
    if (metaAds.length > 0) {
      const mapped: FoundAd[] = []
      for (const ad of metaAds) {
        const url = ad.video_url ?? ad.ad_snapshot_url
        if (!url) continue
        mapped.push({
          source: "meta_ad_library",
          ad_id: ad.ad_id,
          scrape_url: url,
        })
        if (mapped.length >= MAX_ADS) break
      }
      if (mapped.length > 0) return { ads: mapped, source: "meta_ad_library" }
    }
  } catch (err) {
    logger.warn("meta_ad_library_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fallback to Apify.
  try {
    const apifyAds = await apify.searchFBAdsByKeywords(keywords)
    if (apifyAds.length > 0) {
      const mapped: FoundAd[] = []
      for (const ad of apifyAds) {
        if (!ad.video_url) continue
        mapped.push({
          source: "apify_fb",
          ad_id: ad.ad_id,
          scrape_url: ad.video_url,
        })
        if (mapped.length >= MAX_ADS) break
      }
      if (mapped.length > 0) return { ads: mapped, source: "apify_fb" }
    }
  } catch (err) {
    logger.warn("apify_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { ads: [], source: "none" }
}

interface CreativeRow {
  id: string
  scrapeUrl: string
}

async function transcribeOne(
  creative: CreativeRow,
  userId: string,
): Promise<{ transcribed: boolean; reason?: string }> {
  let response: Response
  try {
    response = await fetch(creative.scrapeUrl, {
      redirect: "follow",
      cache: "no-store",
    })
  } catch (err) {
    logger.warn("creative_fetch_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { transcribed: false, reason: "fetch_failed" }
  }

  if (!response.ok) {
    logger.warn("creative_fetch_non_ok", {
      creativeId: creative.id,
      status: response.status,
    })
    return { transcribed: false, reason: `http_${response.status.toString()}` }
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const mime = response.headers.get("content-type") ?? "video/mp4"
  const sizeBytes = buffer.byteLength

  // 1. Upload original to UploadThing.
  let uploadedUrl: string | undefined
  try {
    const file = new File([new Uint8Array(buffer)], `${creative.id}.mp4`, {
      type: mime,
    })
    const result = await getUTApi().uploadFiles(file)
    if (result.data) {
      uploadedUrl = result.data.ufsUrl
    } else {
      logger.warn("uploadthing_failed", {
        creativeId: creative.id,
        error: result.error.message,
      })
    }
  } catch (err) {
    logger.warn("uploadthing_threw", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (uploadedUrl) {
    try {
      await withUser(userId, async (db) => {
        await db.insert(assets).values({
          ownerType: "creative",
          ownerId: creative.id,
          kind: "original_video",
          url: uploadedUrl,
          bytes: sizeBytes,
          mime,
        })
      })
    } catch (err) {
      logger.warn("asset_insert_failed", {
        creativeId: creative.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 2. Skip Whisper if file too big — Whisper API caps at 25 MB.
  if (sizeBytes > WHISPER_MAX_BYTES) {
    logger.info("transcribe_skip_oversize", {
      creativeId: creative.id,
      sizeBytes,
    })
    return { transcribed: false, reason: "oversize" }
  }

  // 3. Transcribe via the canonical AI transcribe entrypoint (§9, text mode).
  let transcriptText: string
  let language: string
  try {
    const result = await transcribe({ mode: "text", audio: buffer })
    transcriptText = result.transcriptText
    language = result.language
  } catch (err) {
    logger.warn("whisper_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { transcribed: false, reason: "whisper_failed" }
  }

  if (transcriptText.length === 0) {
    return { transcribed: false, reason: "empty_transcript" }
  }

  try {
    await withUser(userId, async (db) => {
      await db
        .update(creatives)
        .set({ transcriptText, language })
        .where(and(eq(creatives.id, creative.id), eq(creatives.userId, userId)))
    })
  } catch (err) {
    logger.warn("transcript_persist_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { transcribed: false, reason: "persist_failed" }
  }

  return { transcribed: true }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]
      if (item === undefined) return
      try {
        const value = await worker(item, idx)
        out[idx] = { status: "fulfilled", value }
      } catch (reason) {
        out[idx] = { status: "rejected", reason }
      }
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * Derive brand tokens from a product name. Splits on whitespace and keeps
 * tokens of length ≥ 3 that contain at least one uppercase letter (typical
 * brand-name pattern). Returns a uniqued list. Returns [] for null/empty name
 * or when no tokens qualify.
 */
function deriveBrandTokens(name: string | null): string[] {
  if (name === null || name === "") return []
  const tokens = name.split(/\s+/).filter((t) => t.length >= 3 && /[A-Z]/.test(t))
  return [...new Set(tokens)]
}

interface ScrapePayload {
  productId: string
  userId: string
  competitorUrl: string
  attempt?: number
}

export const scrapeProduct = task({
  id: TASK_ID,
  maxDuration: 600,
  machine: { preset: "medium-1x" },
  run: async (payload: ScrapePayload): Promise<ScrapeSummary> => {
    const { productId, userId, competitorUrl } = payload
    const attempt = payload.attempt ?? 1
    const idempotencyKey = `scrape_${productId}_${attempt.toString()}`

    // ---------- Idempotency ----------
    const existing = await withUser(userId, async (db) => {
      return await db
        .select({ key: idempotencyKeys.key })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1)
    })
    if (existing.length > 0) {
      logger.info("idempotency_short_circuit", { idempotencyKey })
      const summary = await withUser(userId, async (db) => {
        return await db
          .select({
            id: creatives.id,
            transcriptText: creatives.transcriptText,
            angle: creatives.angle,
          })
          .from(creatives)
          .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
      })
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter((s) => typeof s.transcriptText === "string").length,
        withAngle: summary.filter((s) => s.angle !== null).length,
        source: "none",
      }
    }

    try {
      await withUser(userId, async (db) => {
        await db.insert(idempotencyKeys).values({
          key: idempotencyKey,
          userId,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
      })
    } catch (err) {
      // Unique violation → another runner won; replay summary.
      logger.info("idempotency_race", {
        idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      })
      const summary = await withUser(userId, async (db) => {
        return await db
          .select({
            id: creatives.id,
            transcriptText: creatives.transcriptText,
            angle: creatives.angle,
          })
          .from(creatives)
          .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
      })
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter((s) => typeof s.transcriptText === "string").length,
        withAngle: summary.filter((s) => s.angle !== null).length,
        source: "none",
      }
    }

    // ---------- Step 1 — scrapeProductInfo (§7) ----------
    logger.info("scrape_started", { productId, competitorUrl })
    const scrapeResult = await scrapeProductInfo({ url: competitorUrl })

    // §7: scrape NEVER throws — the partial branch is a soft-degrade, not a
    // failure. We always try to backfill whatever Stage A captured and let the
    // user complete missing fields manually.
    const isReady = scrapeResult.status === "READY"
    const productView = isReady
      ? {
          imageUrl: scrapeResult.product.imageUrl,
          productName: scrapeResult.product.productName,
          category: scrapeResult.product.category,
          description: scrapeResult.product.description,
        }
      : {
          imageUrl: scrapeResult.partial.imageUrl,
          productName: scrapeResult.partial.productName,
          category: scrapeResult.partial.category,
          description: scrapeResult.partial.description,
        }
    const adKeywords = isReady
      ? [...scrapeResult.product.keywords.broad, ...scrapeResult.product.keywords.narrow]
      : []

    if (isReady) {
      logger.info("scrape_done", {
        productName: productView.productName,
        category: productView.category,
        broadCount: scrapeResult.product.keywords.broad.length,
        narrowCount: scrapeResult.product.keywords.narrow.length,
      })
    } else {
      logger.warn("scrape_partial", { reason: scrapeResult.reason })
    }

    // Best-effort backfill of product metadata. Only writes columns the user
    // hasn't filled in manually.
    try {
      await withUser(userId, async (db) => {
        const [row] = await db
          .select({
            name: products.name,
            imageUrl: products.imageUrl,
            category: products.category,
          })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        const updates: Partial<typeof products.$inferInsert> = {}
        if (!row?.name && productView.productName) {
          const nameCheck = imperativeVerbCheck(productView.productName)
          if (nameCheck.ok) {
            updates.name = productView.productName
          } else {
            logger.warn("ai_speak_imperative_blocked", {
              field: "name",
              value: productView.productName,
            })
          }
        }
        if (!row?.imageUrl && productView.imageUrl) updates.imageUrl = productView.imageUrl
        if (!row?.category && productView.category) updates.category = productView.category
        if (productView.description != null) {
          const descCheck = imperativeVerbCheck(productView.description)
          if (descCheck.ok) {
            updates.description = productView.description
          } else {
            logger.warn("ai_speak_imperative_blocked", {
              field: "description",
              value: productView.description,
            })
          }
        } else {
          updates.description = null
        }
        updates.brandTokens = deriveBrandTokens(productView.productName)
        await db
          .update(products)
          .set(updates)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })
    } catch (err) {
      logger.warn("product_backfill_failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Mark partial scrapes early so the manual-fill UI surfaces them. We still
    // proceed to ad discovery + transcription so the demo path keeps running.
    if (!isReady) {
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "SCRAPE_PARTIAL" })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })
    }

    if (adKeywords.length === 0) {
      // Without keyword tiers we can't search Meta Ad Library or Apify. Stop
      // here with whatever Stage A captured.
      return {
        creativeCount: 0,
        withTranscript: 0,
        withAngle: 0,
        source: "none",
      }
    }

    // ---------- Step 2 — findAds ----------
    logger.info("find_ads_started", { keywordCount: adKeywords.length })
    const { ads, source } = await findAds(adKeywords)
    logger.info("find_ads_done", { count: ads.length, source })

    if (ads.length === 0) {
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "SCRAPE_EMPTY" })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })
      return {
        creativeCount: 0,
        withTranscript: 0,
        withAngle: 0,
        source,
      }
    }

    // Insert creative rows.
    const insertedCreatives = await withUser(userId, async (db) => {
      const rows = ads.map((ad) => ({
        productId,
        userId,
        source: ad.source,
        scrapeUrl: ad.scrape_url,
        selectedBool: false,
      }))
      return await db
        .insert(creatives)
        .values(rows)
        .returning({ id: creatives.id, scrapeUrl: creatives.scrapeUrl })
    })

    // ---------- Step 3 — transcribeAds ----------
    logger.info("transcribe_started", { count: insertedCreatives.length })
    const transcriptionResults = await runWithConcurrency(
      insertedCreatives,
      TRANSCRIBE_CONCURRENCY,
      async (creative) => {
        const res = await transcribeOne(creative, userId)
        logger.info("transcribe_progress", {
          creativeId: creative.id,
          transcribed: res.transcribed,
          reason: res.reason,
        })
        return res
      },
    )
    const withTranscript = transcriptionResults.filter(
      (r): r is PromiseFulfilledResult<{ transcribed: boolean }> =>
        r.status === "fulfilled" && r.value.transcribed,
    ).length

    // ---------- Step 4 — classifyAngle (§12) ----------
    logger.info("classify_started", { count: insertedCreatives.length })
    const rows = await withUser(userId, async (db) => {
      return await db
        .select({
          id: creatives.id,
          transcriptText: creatives.transcriptText,
          language: creatives.language,
        })
        .from(creatives)
        .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
    })

    const classifyInput = rows.map((r) => ({
      id: r.id,
      transcript: r.transcriptText ?? "",
      language: r.language ?? "es",
    }))
    const classification = await classifyAngle({ creatives: classifyInput })
    logger.info("classify_done", { count: classification.angles.length })

    await withUser(userId, async (db) => {
      await Promise.all(
        classification.angles.map((entry) =>
          db
            .update(creatives)
            .set({ angle: entry.angle })
            .where(and(eq(creatives.id, entry.creativeId), eq(creatives.userId, userId))),
        ),
      )
    })

    const withAngle = classification.angles.filter((a) => a.angle !== null).length

    // Final status flip.
    await withUser(userId, async (db) => {
      await db
        .update(products)
        .set({ status: "READY" })
        .where(and(eq(products.id, productId), eq(products.userId, userId)))
    })

    return {
      creativeCount: insertedCreatives.length,
      withTranscript,
      withAngle,
      source,
    }
  },
})
