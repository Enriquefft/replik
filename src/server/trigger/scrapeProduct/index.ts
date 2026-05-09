import "server-only"

/**
 * Lane L3a — Scrape pipeline orchestrator (Trigger.dev v4).
 *
 * Four-step pipeline:
 *   1. scrapeProductInfo — §7 four-stage scrape (deterministic Stage A +
 *      Sonnet 4.6 gap-fill in Stage C). Returns either `READY` with the
 *      fully-resolved product + keyword tiers, or `SCRAPE_PARTIAL` with the
 *      best-effort partial. Either branch backfills product fields.
 *   2. findAds — fan out across broad-first keywords on Apify's Facebook Ads
 *      Library scraper. If empty → `products.status='SCRAPE_EMPTY'`.
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
import { canonicalizeBrand } from "@/lib/ai/canonicalize-brand.ts"
import { imperativeVerbCheck } from "@/lib/ai/guards.ts"
import { classifyRelevance } from "@/lib/ai/relevance-classify.ts"
import { scrapeProductInfo } from "@/lib/ai/scrape.ts"
import { transcribe } from "@/lib/ai/transcribe.ts"
import * as apify from "@/lib/apify"
import * as tiktokApify from "@/lib/apify/tiktok.ts"
import { logEvent, markProductFailed, withTiming } from "@/lib/observability/log.ts"
import { isBlocked } from "@/lib/scrape-blocklist.ts"
import { MAX_ADS, MAX_ADS_FETCH } from "@/lib/scrape-limits.ts"
import { normalizeScrapeReason } from "@/lib/scrape-reason.ts"
import { uploadSrt } from "@/lib/video"
import { normalizeVideoUrl } from "@/lib/video-url.ts"
import type { ScrapePhase } from "./metadata.ts"

const TASK_ID = "scrape-product"
// Apify Facebook Ads scraper is the sole creative source. Calls are metered
// (~$0.116 per 20-ad run worst case); the query ladder fans out across at
// most APIFY_MAX_QUERIES distinct queries (brand-first → broad keywords).
// Worst-case spend per scrape is therefore ~6 × $0.116 ≈ $0.70, but the
// circuit breaker (MAX_ADS_FETCH=50) typically halts the ladder after 2-3
// brand-tier calls when the brand actually advertises.
const APIFY_MAX_QUERIES = 6
const WHISPER_MAX_BYTES = 25 * 1024 * 1024
const TRANSCRIBE_CONCURRENCY = 10
const IDEMPOTENCY_TTL_DAYS = 7

type CreativeSource = "apify_fb" | "apify_tiktok"

type SummarySource = CreativeSource | "mixed" | "none"

interface ScrapeSummary {
  creativeCount: number
  withTranscript: number
  withAngle: number
  source: SummarySource
}

interface FoundAd {
  source: CreativeSource
  ad_id: string
  scrape_url: string
  /** Advertiser page name (FB) or creator handle (TikTok). Persisted on
   *  creatives.advertiserName and consumed by `isBlocked` + the relevance gate. */
  page_name?: string
  /** Apify body text (FB) or video caption (TikTok). Consumed by the relevance gate. */
  ad_text?: string
}

/**
 * Compress a list of source-tagged rows into a single summary label.
 *   0 rows         → "none"
 *   1 unique src   → that source verbatim
 *   2+ unique srcs → "mixed"
 */
function summarizeSources(rows: ReadonlyArray<{ source: CreativeSource }>): SummarySource {
  if (rows.length === 0) return "none"
  const unique = new Set<CreativeSource>()
  for (const r of rows) unique.add(r.source)
  if (unique.size === 1) {
    const [only] = unique
    if (only !== undefined) return only
  }
  return "mixed"
}

/**
 * One step in the query ladder. `tier` is operator-facing telemetry only —
 * the Apify call doesn't see it.
 */
interface LadderQuery {
  tier: "canonical_brand" | "raw_brand" | "brand_plus_name" | "broad_keyword" | "narrow_keyword"
  keyword: string
}

/**
 * Build an ordered query ladder (most specific → category fallback) from
 * the brand identity + scraped keyword tiers. Customer flow §0: real
 * operators query brand-first, then fall back to category terms only when
 * brand exhausts. Tiers, in order:
 *
 *   1. canonicalBrand alone (e.g. "JoySpring") — highest signal-to-noise.
 *   2. rawBrand alone (only if differs from canonicalBrand).
 *   3. (rawBrand|canonicalBrand) + productName — pinpoints the SKU's own
 *      ads even when the brand runs many products.
 *   4. broad keywords (1-2 word category terms).
 *   5. narrow keywords (3-6 word long-tail buyer-intent phrases) — last
 *      because category-style products on Apify return 0 for over-specified
 *      substrings.
 *
 * Dedupe is case-insensitive. Empty entries are dropped. Caller still caps
 * to `APIFY_MAX_QUERIES` and can short-circuit on `MAX_ADS_FETCH`.
 */
export function buildQueryLadder(input: {
  rawBrand: string | null
  canonicalBrand: string | null
  productName: string | null
  broadKeywords: string[]
  narrowKeywords: string[]
}): LadderQuery[] {
  const out: LadderQuery[] = []
  const seen = new Set<string>()
  const push = (tier: LadderQuery["tier"], keyword: string) => {
    const trimmed = keyword.trim()
    if (trimmed.length === 0) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ tier, keyword: trimmed })
  }

  if (input.canonicalBrand !== null) push("canonical_brand", input.canonicalBrand)
  if (input.rawBrand !== null) push("raw_brand", input.rawBrand)
  if (input.productName !== null) {
    if (input.canonicalBrand !== null) {
      push("brand_plus_name", `${input.canonicalBrand} ${input.productName}`)
    }
    if (input.rawBrand !== null && input.rawBrand !== input.canonicalBrand) {
      push("brand_plus_name", `${input.rawBrand} ${input.productName}`)
    }
  }
  for (const kw of input.broadKeywords) push("broad_keyword", kw)
  for (const kw of input.narrowKeywords) push("narrow_keyword", kw)

  return out
}

/**
 * Discover up to `MAX_ADS_FETCH` distinct video creatives by walking the
 * brand-first query ladder against BOTH source lanes (FB Ad Library +
 * TikTok) in parallel per step.
 *
 * Per ladder step we fan out FB and TikTok concurrently; both pools merge
 * into the same dedup map keyed by `${source}:${ad_id}` to keep the two
 * id-namespaces from colliding. The pre-filter ceiling is `MAX_ADS_FETCH`
 * (50), not `MAX_ADS` (20) — the downstream blocklist + LLM relevance
 * gate trim back to `MAX_ADS` before any Whisper or DB cost.
 *
 * Hard cap: `APIFY_MAX_QUERIES` ladder steps. Circuit breaker: stop the
 * ladder as soon as accumulated creatives reach `MAX_ADS_FETCH` — paying
 * for extra tiers once the brand call filled the bucket is waste.
 *
 * Worst-case spend: APIFY_MAX_QUERIES × 2 sources × per-keyword actor cap.
 */
async function findAds(ladder: LadderQuery[]): Promise<{ ads: FoundAd[]; source: SummarySource }> {
  if (ladder.length === 0) return { ads: [], source: "none" }

  const apifyAds = new Map<string, FoundAd>()
  const tried = ladder.slice(0, APIFY_MAX_QUERIES)
  for (const step of tried) {
    if (apifyAds.size >= MAX_ADS_FETCH) {
      logger.info("apify_ladder_circuit_break", {
        nextTier: step.tier,
        nextKeyword: step.keyword,
        total: apifyAds.size,
      })
      break
    }
    const [fbResult, tiktokResult] = await Promise.allSettled([
      apify.searchFBAdsByKeyword(step.keyword),
      tiktokApify.searchTikTokByKeyword(step.keyword),
    ])

    const unwrapBatch = (
      result: PromiseSettledResult<apify.RawCreative[]>,
      source: CreativeSource,
    ): apify.RawCreative[] => {
      if (result.status === "fulfilled") return result.value
      logger.warn("apify_ladder_failed", {
        tier: step.tier,
        keyword: step.keyword,
        source,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
      return []
    }
    const fbBatch = unwrapBatch(fbResult, "apify_fb")
    const tiktokBatch = unwrapBatch(tiktokResult, "apify_tiktok")

    let addedFb = 0
    let addedTiktok = 0
    const ingest = (raw: apify.RawCreative, source: CreativeSource): boolean => {
      if (!raw.video_url) return false
      const key = `${source}:${raw.ad_id}`
      if (apifyAds.has(key)) return false
      const found: FoundAd = {
        source,
        ad_id: raw.ad_id,
        scrape_url: raw.video_url,
      }
      if (raw.page_name !== undefined) found.page_name = raw.page_name
      if (raw.ad_text !== undefined && raw.ad_text.length > 0) found.ad_text = raw.ad_text
      apifyAds.set(key, found)
      return true
    }

    for (const ad of fbBatch) {
      if (apifyAds.size >= MAX_ADS_FETCH) break
      if (ingest(ad, "apify_fb")) addedFb += 1
    }
    for (const ad of tiktokBatch) {
      if (apifyAds.size >= MAX_ADS_FETCH) break
      if (ingest(ad, "apify_tiktok")) addedTiktok += 1
    }

    logger.info("apify_ladder_step", {
      tier: step.tier,
      keyword: step.keyword,
      fbRaw: fbBatch.length,
      fbAdded: addedFb,
      tiktokRaw: tiktokBatch.length,
      tiktokAdded: addedTiktok,
      total: apifyAds.size,
    })
  }
  const ads = Array.from(apifyAds.values())
  return { ads, source: summarizeSources(ads) }
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
        source: summarizeSources(summary),
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
        source: summarizeSources(summary),
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
      const broadKeywords = isReady ? scrapeResult.product.keywords.broad : []
      const narrowKeywords = isReady ? scrapeResult.product.keywords.narrow : []
      // Flat keyword list (broad → narrow, deduped) — only used to (a) gate
      // "no keywords at all" early-exit, (b) feed the relevance classifier
      // its product-context array, and (c) persist on `products.keywords`
      // for the dashboard. The Apify ladder is built separately below from
      // brand identity + tiered buckets.
      const adKeywords: string[] = []
      const seen = new Set<string>()
      for (const kw of [...broadKeywords, ...narrowKeywords]) {
        const trimmed = kw.trim()
        if (trimmed.length === 0) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        adKeywords.push(trimmed)
      }

      if (isReady) {
        logger.info("scrape_done", {
          productName: productView.productName,
          category: productView.category,
          broadCount: broadKeywords.length,
          narrowCount: narrowKeywords.length,
        })
      } else {
        logger.warn("scrape_partial", { reason: scrapeResult.reason })
      }

      // ---------- Step 1.5 — canonicalizeBrand (Phase P1.1) ----------
      // The page's brand string (og:site_name / JSON-LD `brand.name`) is
      // what the storefront declares — it can drift from the canonical
      // brand identifier the company actually advertises under on
      // Facebook (e.g. "Lingolib" vs parent "JoySpring"). Resolve once,
      // persist alongside the raw brand, and feed BOTH into the query
      // ladder. Fail-open: missing rawBrand or LLM error → null
      // canonicalBrand and the ladder falls back to whatever it has.
      let canonicalBrand: string | null = null
      const rawBrand = productView.brand
      if (rawBrand !== null && rawBrand.length > 0) {
        try {
          const result = await withTiming(
            "task.scrape.canonicalize_brand",
            () =>
              canonicalizeBrand({
                rawBrand,
                productName: productView.productName,
                category: productView.category,
                entryUrl: competitorUrl,
              }),
            { rawBrand },
          )
          canonicalBrand = result.canonicalBrand
          logger.info("canonicalize_brand_done", {
            rawBrand,
            canonicalBrand,
            rationale: result.rationale,
          })
        } catch (err) {
          logger.warn("canonicalize_brand_failed", {
            rawBrand,
            error: err instanceof Error ? err.message : String(err),
          })
        }
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
          // brandTokens API contract intact. `canonicalBrand` is the
          // web-search-resolved name we query Facebook Ad Library with;
          // null when canonicalize-brand failed or rawBrand was already
          // canonical (caller substitutes rawBrand at the ladder).
          updates.brand = productView.brand
          updates.canonicalBrand = canonicalBrand
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
      // Brand-first query ladder (Phase P1.2): canonicalBrand → rawBrand →
      // brand+name → broad keywords → narrow keywords. Hard-capped at
      // APIFY_MAX_QUERIES Apify calls; circuit-breaks once MAX_ADS_FETCH ads
      // accumulate.
      metadata.set("phase", "finding_ads" satisfies ScrapePhase)
      const ladder = buildQueryLadder({
        rawBrand: productView.brand,
        canonicalBrand,
        productName: productView.productName,
        broadKeywords,
        narrowKeywords,
      })
      logger.info("find_ads_started", {
        ladderSize: ladder.length,
        capped: Math.min(ladder.length, APIFY_MAX_QUERIES),
        tiers: ladder.slice(0, APIFY_MAX_QUERIES).map((s) => s.tier),
      })
      const { ads, source } = await withTiming("task.scrape.find_ads", () => findAds(ladder), {
        ladderSize: ladder.length,
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
                brands: [canonicalBrand, productView.brand].filter(
                  (b): b is string => b !== null && b.length > 0,
                ),
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
        const afterRelevance = afterBlocklist.filter((a) => relevantIds.has(a.ad_id))
        // Collapse rows that share a normalized video URL — same advertiser
        // running one video across multiple placements gets a fresh `ad_id`
        // per placement, so ad_id-only dedup in `findAds` lets duplicates
        // through. Run this AFTER the relevance gate: the gate's prompt
        // judges each ad's `ad_text`/`page_name`, so it needs all variants.
        const seenUrls = new Set<string>()
        const unique: FoundAd[] = []
        for (const ad of afterRelevance) {
          const key = normalizeVideoUrl(ad.scrape_url)
          if (seenUrls.has(key)) continue
          seenUrls.add(key)
          unique.push(ad)
        }
        finalAds = unique.slice(0, MAX_ADS)
        metadata.set("relevance.dropped_by_llm", afterBlocklist.length - afterRelevance.length)
        metadata.set("relevance.dedup_dropped", afterRelevance.length - unique.length)
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

      // Insert creative rows. `advertiserName` (page_name from Apify) is
      // persisted so downstream phases (P2 brand-match boost, P4 angle
      // diversity grouping) can read advertiser identity without re-scraping.
      const insertedCreatives = await withUser(userId, async (db) => {
        const rows = finalAds.map((ad) => ({
          productId,
          userId,
          source: ad.source,
          scrapeUrl: ad.scrape_url,
          advertiserName: ad.page_name ?? null,
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
