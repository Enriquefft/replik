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

import { logger, metadata, task } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"

import { withUser } from "@/db/client"
import { creatives, idempotencyKeys, products } from "@/db/schema"
import { classifyAngle } from "@/lib/ai/angle-classify.ts"
import { imperativeVerbCheck } from "@/lib/ai/guards.ts"
import { scrapeProductInfo } from "@/lib/ai/scrape.ts"
import { transcribe } from "@/lib/ai/transcribe.ts"
import * as apify from "@/lib/apify"
import * as meta from "@/lib/meta"
import { logEvent, markProductFailed, withTiming } from "@/lib/observability/log.ts"
import { normalizeScrapeReason } from "@/lib/scrape-reason.ts"
import type { ScrapePhase } from "./metadata.ts"

const TASK_ID = "scrape-product"
const MAX_ADS = 20
const WHISPER_MAX_BYTES = 25 * 1024 * 1024
const TRANSCRIBE_CONCURRENCY = 10
const IDEMPOTENCY_TTL_DAYS = 7

interface ScrapeSummary {
  creativeCount: number
  withTranscript: number
  withAngle: number
  source: "meta_ad_library" | "apify_fb" | "none"
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
  const sizeBytes = buffer.byteLength

  // Skip Whisper if file too big — Whisper API caps at 25 MB. Rehosting to
  // UploadThing is deferred until the user selects this creative for editing
  // (see `rehostCreatives` task).
  if (sizeBytes > WHISPER_MAX_BYTES) {
    logger.info("transcribe_skip_oversize", {
      creativeId: creative.id,
      sizeBytes,
    })
    return { transcribed: false, reason: "oversize" }
  }

  // Transcribe via the canonical AI transcribe entrypoint (§9, text mode).
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
  maxDuration: 1800,
  machine: { preset: "large-1x" },
  run: async (payload: ScrapePayload): Promise<ScrapeSummary> => {
    const { productId, userId, competitorUrl } = payload
    const attempt = payload.attempt ?? 1
    const idempotencyKey = `scrape_${productId}_${attempt.toString()}`

    logEvent("task.scrape.start", { productId, userId, attempt })

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
            source: creatives.source,
          })
          .from(creatives)
          .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
      })
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter((s) => typeof s.transcriptText === "string").length,
        withAngle: summary.filter((s) => s.angle !== null).length,
        source: summary[0]?.source ?? "none",
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
            source: creatives.source,
          })
          .from(creatives)
          .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
      })
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter((s) => typeof s.transcriptText === "string").length,
        withAngle: summary.filter((s) => s.angle !== null).length,
        source: summary[0]?.source ?? "none",
      }
    }

    try {
      // ---------- Step 1 — scrapeProductInfo (§7) ----------
      metadata.set("phase", "scraping" satisfies ScrapePhase)
      logger.info("scrape_started", { productId, competitorUrl })
      const scrapeResult = await withTiming(
        "task.scrape.product_info",
        () => scrapeProductInfo({ url: competitorUrl }),
        { productId, url: competitorUrl },
      )

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

      // Surface Stage A signals to realtime metadata as soon as we have them
      // — the progress UI uses these to render a "Detected" panel within
      // seconds of the run starting, even before findAds finishes.
      if (productView.productName) {
        metadata.set("productName", productView.productName)
      }
      if (productView.imageUrl) {
        metadata.set("imageUrl", productView.imageUrl)
      }
      metadata.set("keywordCount", adKeywords.length)

      // Mark partial scrapes early so the manual-fill UI surfaces them. We still
      // proceed to ad discovery + transcription so the demo path keeps running.
      if (!isReady) {
        const partialReason = normalizeScrapeReason(scrapeResult.reason)
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_PARTIAL", scrapeReason: partialReason })
            .where(and(eq(products.id, productId), eq(products.userId, userId)))
        })
      }

      if (adKeywords.length === 0) {
        // Without keyword tiers we can't search Meta Ad Library or Apify. Stop
        // here with whatever Stage A captured. Persist the reason so the UI
        // can explain why ad discovery didn't run.
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_PARTIAL", scrapeReason: "no-keywords" })
            .where(and(eq(products.id, productId), eq(products.userId, userId)))
        })
        const summary: ScrapeSummary = {
          creativeCount: 0,
          withTranscript: 0,
          withAngle: 0,
          source: "none",
        }
        logEvent("task.scrape.done", { ...summary, reason: "no-keywords" })
        return summary
      }

      // ---------- Step 2 — findAds ----------
      metadata.set("phase", "finding_ads" satisfies ScrapePhase)
      logger.info("find_ads_started", { keywordCount: adKeywords.length })
      const { ads, source } = await withTiming("task.scrape.find_ads", () => findAds(adKeywords), {
        keywordCount: adKeywords.length,
      })
      metadata.set("ads_total", ads.length)
      logger.info("find_ads_done", { count: ads.length, source })

      if (ads.length === 0) {
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_EMPTY", scrapeReason: "no-ads" })
            .where(and(eq(products.id, productId), eq(products.userId, userId)))
        })
        const summary: ScrapeSummary = {
          creativeCount: 0,
          withTranscript: 0,
          withAngle: 0,
          source,
        }
        logEvent("task.scrape.done", { ...summary, reason: "no-ads" })
        return summary
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
      metadata.set("phase", "transcribing" satisfies ScrapePhase)
      metadata.set("transcribed", 0)
      logger.info("transcribe_started", { count: insertedCreatives.length })
      const transcriptionResults = await runWithConcurrency(
        insertedCreatives,
        TRANSCRIBE_CONCURRENCY,
        async (creative) => {
          const res = await transcribeOne(creative, userId)
          if (res.transcribed) {
            metadata.increment("transcribed", 1)
          }
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
      metadata.set("phase", "classifying" satisfies ScrapePhase)
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
      metadata.set("classified", classification.angles.length)
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

      // Final status flip. Clear any prior scrapeReason so retried-then-
      // succeeded rows don't carry stale failure copy.
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "READY", scrapeReason: null })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })

      const summary: ScrapeSummary = {
        creativeCount: insertedCreatives.length,
        withTranscript,
        withAngle,
        source,
      }
      logEvent("task.scrape.done", { ...summary })
      return summary
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await markProductFailed(userId, productId, reason, "task-crashed")
      throw err
    }
  },
})
