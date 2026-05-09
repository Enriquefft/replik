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
import { assets, creatives, idempotencyKeys, products } from "@/db/schema"
import { classifyAngle } from "@/lib/ai/angle-classify.ts"
import { imperativeVerbCheck } from "@/lib/ai/guards.ts"
import { classifyRelevance } from "@/lib/ai/relevance-classify.ts"
import { scrapeProductInfo } from "@/lib/ai/scrape.ts"
import { transcribe } from "@/lib/ai/transcribe.ts"
import * as apify from "@/lib/apify"
import * as meta from "@/lib/meta"
import { logEvent, markProductFailed, withTiming } from "@/lib/observability/log.ts"
import { isBlocked } from "@/lib/scrape-blocklist.ts"
import { MAX_ADS, MAX_ADS_FETCH } from "@/lib/scrape-limits.ts"
import { normalizeScrapeReason } from "@/lib/scrape-reason.ts"
import { uploadSrt } from "@/lib/video"
import type { ScrapePhase } from "./metadata.ts"

const TASK_ID = "scrape-product"
// Maximum number of distinct keyword search calls per provider before giving
// up. Both Meta and Apify are bounded — Meta calls are cheap but rate-limited,
// Apify calls are metered (~$0.116 per 20-ad run worst case). Fanning out 5
// broad-first terms keeps recall high without runaway cost.
const META_MAX_KEYWORDS = 5
const APIFY_MAX_KEYWORDS = 2
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
  /** Advertiser page name. Consumed by `isBlocked` and the relevance gate. */
  page_name?: string
  /** Advertiser page id. Preserved for future page-level expansion (search_page_ids). */
  page_id?: string
  /** Concatenated ad copy (creative bodies for Meta, body text for Apify). */
  ad_text?: string
}

/**
 * Order keyword tiers broad-first and dedupe (case-insensitive). Broad tier
 * (1-2 word generic terms) drives category recall; narrow tier (3-6 word
 * long-tail buyer-intent phrases) is a fallback for niches where broad terms
 * are saturated. Empty entries are dropped.
 */
function orderedKeywords(input: { broad: string[]; narrow: string[] }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const kw of [...input.broad, ...input.narrow]) {
    const trimmed = kw.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/**
 * Discover up to `MAX_ADS_FETCH` distinct video ads for the supplied
 * broad-first keyword list.
 *
 * The pre-filter ceiling is `MAX_ADS_FETCH` (50), not `MAX_ADS` (20). The
 * downstream blocklist + LLM relevance gate trim back to `MAX_ADS` before
 * any Whisper or DB cost; over-fetching gives the gate room to drop noise
 * (DramaBox-class spam, marketplace ads tagging every category) without
 * starving the creative grid.
 *
 * Algorithm:
 *   1. Iterate the keyword list (already broad-first). For each keyword call
 *      `meta.adLibrarySearch` with that single keyword as `searchTerms`.
 *      Accumulate de-duped ads keyed by `ad_id`. Stop once `MAX_ADS_FETCH`
 *      reached or `META_MAX_KEYWORDS` keywords tried.
 *   2. If Meta produced any ads, return them tagged `meta_ad_library`.
 *   3. Otherwise fall back to Apify on the first `APIFY_MAX_KEYWORDS` broad
 *      keywords (Apify is metered per dataset item, so we cap aggressively).
 *      Same per-keyword loop + de-dup.
 *
 * Joining broad+narrow into one whitespace-delimited query (the previous
 * behaviour) over-specified Meta's substring matcher and silently returned 0
 * for category-style products. Iterating per-keyword is the recall fix.
 */
async function findAds(
  keywords: string[],
): Promise<{ ads: FoundAd[]; source: "meta_ad_library" | "apify_fb" | "none" }> {
  if (keywords.length === 0) return { ads: [], source: "none" }

  // ---------- Meta first ----------
  const metaAds = new Map<string, FoundAd>()
  const metaTried = keywords.slice(0, META_MAX_KEYWORDS)
  for (const keyword of metaTried) {
    if (metaAds.size >= MAX_ADS_FETCH) break
    try {
      const remaining = MAX_ADS_FETCH - metaAds.size
      const batch = await meta.adLibrarySearch({
        searchTerms: keyword,
        countries: ["PE"],
        limit: Math.max(remaining, 1),
      })
      let added = 0
      for (const ad of batch) {
        if (metaAds.has(ad.ad_id)) continue
        // Video-only ingestion — `ad_snapshot_url` (HTML page) was previously
        // accepted as a fallback but is unfetchable by Whisper and unplayable
        // in `<video>`, leaving rows that clog the selection grid forever.
        if (!ad.video_url) continue
        const found: FoundAd = {
          source: "meta_ad_library",
          ad_id: ad.ad_id,
          scrape_url: ad.video_url,
        }
        if (ad.page_name !== undefined) found.page_name = ad.page_name
        if (ad.page_id !== undefined) found.page_id = ad.page_id
        const adText = ad.ad_creative_bodies?.join(" ").trim()
        if (adText !== undefined && adText.length > 0) found.ad_text = adText
        metaAds.set(ad.ad_id, found)
        added++
        if (metaAds.size >= MAX_ADS_FETCH) break
      }
      logger.info("meta_ad_library_keyword", {
        keyword,
        rawCount: batch.length,
        added,
        total: metaAds.size,
      })
    } catch (err) {
      logger.warn("meta_ad_library_failed", {
        keyword,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (metaAds.size > 0) {
    return { ads: Array.from(metaAds.values()), source: "meta_ad_library" }
  }

  // ---------- Apify fallback ----------
  // Apify is metered per dataset item (~$0.0058/ad) — keep fetch tight at
  // MAX_ADS so spend stays bounded. The relevance gate still runs on Apify
  // results; over-fetch is a Meta-only optimization.
  const apifyAds = new Map<string, FoundAd>()
  const apifyTried = keywords.slice(0, APIFY_MAX_KEYWORDS)
  for (const keyword of apifyTried) {
    if (apifyAds.size >= MAX_ADS) break
    try {
      const batch = await apify.searchFBAdsByKeyword(keyword)
      let added = 0
      for (const ad of batch) {
        if (apifyAds.has(ad.ad_id)) continue
        if (!ad.video_url) continue
        const found: FoundAd = {
          source: "apify_fb",
          ad_id: ad.ad_id,
          scrape_url: ad.video_url,
        }
        if (ad.page_name !== undefined) found.page_name = ad.page_name
        if (ad.ad_text !== undefined && ad.ad_text.length > 0) found.ad_text = ad.ad_text
        apifyAds.set(ad.ad_id, found)
        added++
        if (apifyAds.size >= MAX_ADS) break
      }
      logger.info("apify_keyword", {
        keyword,
        rawCount: batch.length,
        added,
        total: apifyAds.size,
      })
    } catch (err) {
      logger.warn("apify_failed", {
        keyword,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (apifyAds.size > 0) {
    return { ads: Array.from(apifyAds.values()), source: "apify_fb" }
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

  // Transcribe in SRT mode so we capture timed segments alongside the plain
  // text. The burn pipeline (translateAndBurnSubs) reads the persisted SRT
  // asset instead of re-running Whisper. whisper-1 and gpt-4o-transcribe are
  // priced the same per minute, so this is cost-neutral in exchange for
  // skipping the second transcription later.
  let transcriptText: string
  let language: string
  let srt: string | null
  try {
    const result = await transcribe({ mode: "srt", audio: buffer })
    transcriptText = result.transcriptText
    language = result.language
    srt = result.srt
  } catch (err) {
    logger.warn("whisper_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { transcribed: false, reason: "whisper_failed" }
  }

  // Empty transcriptText with no thrown exception is a positive signal:
  // Whisper successfully analysed the audio and found no speech (music-only
  // ad, ambient sounds, etc). Persist "" + detected language so downstream
  // tasks can branch on `transcriptText === ""` (music-only fast-path) vs
  // `transcriptText === null` (transcribe never ran).
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

  if (transcriptText.length === 0) {
    return { transcribed: true, reason: "no_speech_detected" }
  }

  if (srt !== null && srt.length > 0) {
    try {
      const upload = await uploadSrt(srt, `${creative.id}.srt`)
      await withUser(userId, async (db) => {
        await db
          .insert(assets)
          .values({
            ownerType: "creative",
            ownerId: creative.id,
            kind: "srt",
            url: upload.url,
            bytes: Buffer.byteLength(srt, "utf8"),
            mime: "text/plain",
          })
          .onConflictDoNothing({
            target: [assets.ownerType, assets.ownerId, assets.kind],
          })
      })
    } catch (err) {
      // SRT persist is best-effort during scrape — burn falls back to
      // re-transcribing if the asset is missing. Log and keep the transcript
      // we already wrote.
      logger.warn("srt_persist_failed", {
        creativeId: creative.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
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
 * Derive brand tokens from the LLM-emitted brand string (Phase 1).
 *
 * The brand column is the canonical source of brand identity for this
 * product. SRT-translate still consumes `brandTokens: string[]` (its API
 * is locked), so we mirror the column into tokens via a deterministic
 * whitespace split, dropping any short connectives (≤ 2 chars). No
 * uppercase heuristic — Stage C emits the brand verbatim from the page,
 * which may legitimately be all-lowercase ("loreal") or contain
 * lowercase connectives ("Florería de Bloom").
 *
 * Returns [] for null/empty brand or when no tokens qualify.
 */
function deriveBrandTokens(brand: string | null): string[] {
  if (brand === null || brand === "") return []
  const tokens = brand
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
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
            imageUrls: scrapeResult.product.imageUrls,
            productName: scrapeResult.product.productName,
            category: scrapeResult.product.category,
            description: scrapeResult.product.description,
            brand: scrapeResult.product.brand,
          }
        : {
            imageUrls: scrapeResult.partial.imageUrls,
            productName: scrapeResult.partial.productName,
            category: scrapeResult.partial.category,
            description: scrapeResult.partial.description,
            brand: scrapeResult.partial.brand,
          }
      // Broad-first ordering: `findAds` fans out per-keyword, and broad terms
      // (e.g. "flores", "ramos") drive category recall on Meta Ad Library /
      // Apify. Narrow long-tail phrases come last as a fallback for niches
      // where broad terms are saturated. `orderedKeywords` also dedupes the
      // tiers (case-insensitive) since the LLM occasionally repeats a phrase
      // across buckets.
      const adKeywords = isReady ? orderedKeywords(scrapeResult.product.keywords) : []

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
              imageUrls: products.imageUrls,
              category: products.category,
              brand: products.brand,
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
          // Image-set: only seed if user hasn't set anything (`row.imageUrls`
          // is `[]` for new rows since the column is `not null default '{}'`).
          // Stage C / vision-pick produces 1-3 ordered URLs.
          const existingImages = row?.imageUrls ?? []
          if (existingImages.length === 0 && productView.imageUrls.length > 0) {
            updates.imageUrls = productView.imageUrls
          }
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
          // Brand: persist whatever Stage C emitted (or null on non-PDP
          // pages without a detectable brand). Brand-tokens mirror the
          // brand string deterministically — keeps SRT-translate's
          // brandTokens API contract intact.
          updates.brand = productView.brand
          updates.brandTokens = deriveBrandTokens(productView.brand)
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
      if (productView.imageUrls.length > 0) {
        metadata.set("imageUrls", productView.imageUrls)
      }
      metadata.set("keywords", adKeywords)

      // Mark partial scrapes early so the manual-fill UI surfaces them. We still
      // proceed to ad discovery + transcription so the demo path keeps running.
      if (!isReady) {
        const partialReason = normalizeScrapeReason(scrapeResult.reason)
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_PARTIAL", scrapeReason: partialReason, keywords: adKeywords })
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
      logger.info("find_ads_done", { count: ads.length, source })
      metadata.set("ads_fetched", ads.length)

      if (ads.length === 0) {
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_EMPTY", scrapeReason: "no-ads", keywords: adKeywords })
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

      // ---------- Relevance gate ----------
      // Two-stage filter before Whisper + DB cost:
      //   1. Static blocklist drops known unrelated mass spenders by page_name.
      //   2. LLM gate (Sonnet 4.6, single batched call) drops ads the model
      //      classifies as off-topic for the product.
      // Fail-open: gate failure marks every ad relevant=true so the demo path
      // never regresses to an empty creative grid because the gate went down.
      metadata.set("phase", "relevance_gating" satisfies ScrapePhase)
      const fetchedCount = ads.length
      const afterBlocklist = ads.filter((a) => !isBlocked(a.page_name))
      const blocklisted = fetchedCount - afterBlocklist.length
      metadata.set("relevance.fetched", fetchedCount)
      metadata.set("relevance.blocklisted", blocklisted)
      logger.info("relevance_blocklist_done", {
        fetched: fetchedCount,
        blocklisted,
        remaining: afterBlocklist.length,
      })

      let finalAds: FoundAd[]
      if (afterBlocklist.length === 0) {
        finalAds = []
        metadata.set("relevance.dropped_by_llm", 0)
        metadata.set("relevance.kept", 0)
      } else {
        const verdict = await withTiming(
          "task.scrape.classify_relevance",
          () =>
            classifyRelevance({
              product: {
                name: productView.productName ?? "",
                category: productView.category,
                keywords: adKeywords,
              },
              ads: afterBlocklist.map((a) => ({
                id: a.ad_id,
                page_name: a.page_name,
                ad_text: a.ad_text,
              })),
            }),
          { count: afterBlocklist.length },
        )
        const adById = new Map(afterBlocklist.map((a) => [a.ad_id, a] as const))
        for (const v of verdict.verdicts) {
          const ad = adById.get(v.adId)
          logger.info("relevance_verdict", {
            adId: v.adId,
            page_name: ad?.page_name,
            relevant: v.relevant,
            reason: v.reason,
          })
        }
        const relevantIds = new Set(verdict.verdicts.filter((v) => v.relevant).map((v) => v.adId))
        finalAds = afterBlocklist.filter((a) => relevantIds.has(a.ad_id)).slice(0, MAX_ADS)
        metadata.set("relevance.dropped_by_llm", afterBlocklist.length - finalAds.length)
        metadata.set("relevance.kept", finalAds.length)
      }

      // Set `ads_total` to the post-gate count so the progress UI's transcribe
      // skeletons render the right denominator (we only transcribe finalAds).
      metadata.set("ads_total", finalAds.length)
      logger.info("relevance_done", {
        fetched: fetchedCount,
        blocklisted,
        kept: finalAds.length,
      })

      if (finalAds.length === 0) {
        await withUser(userId, async (db) => {
          await db
            .update(products)
            .set({ status: "SCRAPE_EMPTY", scrapeReason: "no-ads", keywords: adKeywords })
            .where(and(eq(products.id, productId), eq(products.userId, userId)))
        })
        const exhaustionReason =
          afterBlocklist.length === 0 ? "no-ads-after-blocklist" : "no-ads-after-gate"
        const summary: ScrapeSummary = {
          creativeCount: 0,
          withTranscript: 0,
          withAngle: 0,
          source,
        }
        logEvent("task.scrape.done", { ...summary, reason: exhaustionReason })
        return summary
      }

      // Insert creative rows.
      const insertedCreatives = await withUser(userId, async (db) => {
        const rows = finalAds.map((ad) => ({
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
          .set({ status: "READY", scrapeReason: null, keywords: adKeywords })
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
