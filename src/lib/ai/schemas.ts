import { z } from "zod"
import { Product } from "@/db/zod.ts"
import { InterestCategory, Locale, SalesAngle, TemplateId } from "@/lib/ai/taxonomies.ts"

// ─── Copy ────────────────────────────────────────────────────────────────────

/**
 * Single Meta ad copy unit. Length limits are spec-owned (§4) — not derived
 * from Meta API direct. DB column: ads.copyJson jsonb.
 */
export const CopyContentSchema = z.object({
  primaryText: z.string().min(1).max(125),
  headline: z.string().min(1).max(40),
  description: z.string().min(1).max(30),
})

export type CopyContent = z.infer<typeof CopyContentSchema>

/** Five framing variants generated in parallel per §11 Stage 1. */
export const CopyContentBatchSchema = z.array(CopyContentSchema).length(5)

export type CopyContentBatch = z.infer<typeof CopyContentBatchSchema>

/**
 * Per-creative input for copy gen (§11). Carries id, classified angle,
 * raw transcript (capped at the call site), and the source language.
 */
export const CopyGenCreativeSchema = z.object({
  id: z.string().min(1),
  angle: SalesAngle.nullable(),
  transcript: z.string(),
  language: z.string(),
})

export type CopyGenCreative = z.infer<typeof CopyGenCreativeSchema>

/**
 * Input to `generateCopy` (§11). The product row is sourced from the DB —
 * derived via drizzle-zod's `Product` schema so the shape stays SSOT with
 * `products.$inferSelect`. Creatives carry the angle + transcript pair the
 * upstream pipeline produced.
 */
export const CopyGenInputSchema = z.object({
  product: Product,
  creatives: z.array(CopyGenCreativeSchema).min(1),
})

export type CopyGenInput = z.infer<typeof CopyGenInputSchema>

// ─── Scrape ──────────────────────────────────────────────────────────────────

/**
 * Output of Stage A deterministic extractor (§7). Every field is nullable
 * because the extractor degrades gracefully — Stage B gates on presence.
 */
export const ProductPartialSchema = z.object({
  imageUrl: z.url().nullable(),
  productName: z.string().nullable(),
  category: InterestCategory.nullable(),
  priceText: z.string().nullable(),
  description: z.string().nullable(),
  locale: Locale.nullable(),
})

export type ProductPartial = z.infer<typeof ProductPartialSchema>

/**
 * Keyword buckets emitted by Stage C (§7).
 * `broad` = 1-2 word generic search terms (3-5 entries).
 * `narrow` = 3-6 word long-tail buyer-intent phrases (3-5 entries).
 */
export const ProductKeywordsSchema = z.object({
  broad: z.array(z.string().min(1)).min(3).max(5),
  narrow: z.array(z.string().min(1)).min(3).max(5),
})

export type ProductKeywords = z.infer<typeof ProductKeywordsSchema>

/**
 * Stage C LLM output (§7). Only the three mandatory fields plus keywords —
 * priceText, description, and locale ride through from Stage A.
 */
export const ProductFinalLLMSchema = z.object({
  imageUrl: z.url(),
  productName: z.string().min(1),
  category: InterestCategory,
  keywords: ProductKeywordsSchema,
})

export type ProductFinalLLM = z.infer<typeof ProductFinalLLMSchema>

/**
 * Fully-resolved product after Stage C LLM gap-fill + Stage D merge (§7).
 * Mandatory: imageUrl, productName, category, keywords. Carry-forward fields
 * (priceText, description, locale) are nullable because Stage A may legitimately
 * miss them on sparse pages — the demo path only gates on the mandatory three.
 */
export const ProductFinalSchema = z.object({
  imageUrl: z.url(),
  productName: z.string().min(1),
  category: InterestCategory,
  priceText: z.string().nullable(),
  description: z.string().nullable(),
  locale: Locale.nullable(),
  keywords: ProductKeywordsSchema,
})

export type ProductFinal = z.infer<typeof ProductFinalSchema>

/**
 * Caller input for the §7 scrape pipeline. `html` is an optional injection
 * seam — production callers omit it and let `scrapeProductInfo` fetch the
 * entry URL itself; tests pass pre-loaded HTML to avoid network I/O.
 */
export const ScrapeInputSchema = z.object({
  url: z.url(),
  html: z.string().optional(),
})

export type ScrapeInput = z.infer<typeof ScrapeInputSchema>

/**
 * Successful end of the §7 pipeline — every mandatory field landed.
 */
export const ScrapeReadyResultSchema = z.object({
  status: z.literal("READY"),
  product: ProductFinalSchema,
})

export type ScrapeReadyResult = z.infer<typeof ScrapeReadyResultSchema>

/**
 * Graceful-degrade end of the §7 pipeline (Stage D fallback). The trigger
 * task persists `partial` fields and flips `products.status = SCRAPE_PARTIAL`
 * for the manual-fill UI. `reason` is operator-facing diagnostic text.
 */
export const ScrapePartialResultSchema = z.object({
  status: z.literal("SCRAPE_PARTIAL"),
  partial: ProductPartialSchema,
  reason: z.string().min(1),
})

export type ScrapePartialResult = z.infer<typeof ScrapePartialResultSchema>

/**
 * Discriminated result of the §7 scrape pipeline. The `status` discriminator
 * mirrors `productStatusEnum` in the DB so callers can branch once and persist
 * directly. NEVER throws — failures collapse into `SCRAPE_PARTIAL`.
 */
export const ScrapeResultSchema = z.discriminatedUnion("status", [
  ScrapeReadyResultSchema,
  ScrapePartialResultSchema,
])

export type ScrapeResult = z.infer<typeof ScrapeResultSchema>

// ─── Template picker ─────────────────────────────────────────────────────────

/**
 * Input to the Shopify template picker (§8).
 * Free-text fields (name, description) originate from scraped pages and must
 * be wrapped with `wrapUntrusted` before passing to any LLM.
 */
export const TemplatePickInputSchema = z.object({
  name: z.string(),
  category: InterestCategory,
  description: z.string(),
  priceText: z.string(),
  heroImageUrl: z.url(),
})

export type TemplatePickInput = z.infer<typeof TemplatePickInputSchema>

/** Output of Shopify template picker (§8). Fallback: templateId = 1. */
export const TemplatePickResultSchema = z.object({
  templateId: TemplateId,
})

export type TemplatePickResult = z.infer<typeof TemplatePickResultSchema>

// ─── Whisper / transcription ─────────────────────────────────────────────────

/**
 * Result of a transcription run (§9). The mode discriminator lives on the
 * input options — the result shape is the same either way; `srt` is null
 * when mode was "text".
 */
export const TranscribeResultSchema = z.object({
  transcriptText: z.string(),
  srt: z.string().nullable(),
  language: z.string(),
})

export type TranscribeResult = z.infer<typeof TranscribeResultSchema>

// ─── SRT translation ─────────────────────────────────────────────────────────

/** A single timestamped subtitle unit (§10). */
export const CueSchema = z.object({
  index: z.int().positive(),
  startMs: z.int().nonnegative(),
  endMs: z.int().positive(),
  text: z.string(),
})

export type Cue = z.infer<typeof CueSchema>

/** Cue after translation. Same shape as Cue — spec §10 adds no extra fields. */
export const TranslatedCueSchema = CueSchema
export type TranslatedCue = Cue

/**
 * Result of a single-batch SRT translation call (§10).
 *
 * `translated: false` is the fallback marker — when the LLM round trips
 * exhaust the retry budget the call site persists the source SRT verbatim
 * with this flag set so the publish path never blocks (§10 fallback).
 *
 * The structural schema validates `cues[].index` is unique inside the
 * batch. Source-dependent constraints (count match, brand-token preservation,
 * line-length / line-count limits) live in the call-site validator — Zod has
 * no other way to compare against runtime input data.
 */
export const SrtTranslateResultSchema = z
  .object({
    cues: z.array(TranslatedCueSchema),
    translated: z.boolean(),
  })
  .refine(
    (out) => {
      const seen = new Set<number>()
      for (const c of out.cues) {
        if (seen.has(c.index)) return false
        seen.add(c.index)
      }
      return true
    },
    { message: "duplicate cue indices" },
  )

export type SrtTranslateResult = z.infer<typeof SrtTranslateResultSchema>

/**
 * Bare-shape variant used when calling `generateObject` — the LLM never
 * controls the `translated` flag (the call site stamps it after success or
 * during fallback). Keeping the LLM-facing schema lean prevents the model
 * from emitting a stray `translated: false` and tripping a real success.
 */
export const SrtTranslateLLMResultSchema = z.object({
  cues: z.array(TranslatedCueSchema),
})

export type SrtTranslateLLMResult = z.infer<typeof SrtTranslateLLMResultSchema>

/**
 * Hard layout limits per §10. Exported so the call-site validator and the
 * snapshot tests share a single source.
 */
export const SRT_MAX_CHARS_PER_LINE = 42
export const SRT_MAX_LINES_PER_CUE = 2
export const SRT_MAX_CUES_PER_BATCH = 60

/**
 * Caller input for `translateSrt` (§10).
 *
 * `targetLocale` is constrained to the project Locale enum. `brandTokens`
 * is the per-product list whose entries must survive the round trip
 * verbatim inside any cue that mentions them.
 */
export const SrtTranslateInputSchema = z.object({
  sourceSrt: z.string().min(1),
  brandTokens: z.array(z.string().min(1)),
  targetLocale: Locale,
})

export type SrtTranslateInput = z.infer<typeof SrtTranslateInputSchema>

// ─── adjustCopy chat (§13) ────────────────────────────────────────────────────

/**
 * Partial field overrides for the hero creative asset (§13).
 * Derived from CopyContentSchema — char limits are SSOT there.
 */
export const HeroOverrideSchema = CopyContentSchema.partial()

export type HeroOverride = z.infer<typeof HeroOverrideSchema>

/**
 * Field-level copy overrides — same shape as HeroOverrideSchema (§13 adds no
 * distinction between hero and copy override fields at the schema level).
 */
export const CopyOverridesSchema = HeroOverrideSchema

export type CopyOverrides = HeroOverride

/**
 * Discriminated-union response from the adjustCopy chat route (§13).
 * Use generateObject — NOT streamObject (AI SDK does not validate partial
 * outputs against discriminated-union schemas; vercel/ai #2036, #7358).
 */
export const AdjustCopyActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rewrite_hero"), hero: HeroOverrideSchema }),
  z.object({ kind: z.literal("adjust_copy"), overrides: CopyOverridesSchema }),
  z.object({ kind: z.literal("regenerate_angle"), angle: SalesAngle }),
  z.object({ kind: z.literal("clarify"), message: z.string().max(300) }),
  z.object({ kind: z.literal("reject"), reason: z.string().max(200) }),
])

export type AdjustCopyAction = z.infer<typeof AdjustCopyActionSchema>

/**
 * Per-creative context handed to the adjustCopy chat route alongside the
 * current copy + user message (§13). Angle is nullable because the §12
 * classifier emits null for transcripts that fall under the 15-char floor.
 */
export const AdjustCopyCreativeContextSchema = z.object({
  id: z.string().min(1),
  angle: SalesAngle.nullable(),
})

export type AdjustCopyCreativeContext = z.infer<typeof AdjustCopyCreativeContextSchema>

/**
 * Caller input for `adjustCopy` (§13). The user message is bounded so a
 * single tenant cannot blow the model context budget; spec §13 doesn't pin
 * an exact ceiling but 2000 chars maps to <500 tokens.
 *
 * `userId` is the per-tenant rate-limit key — §13 caps each user at
 * 1 req/sec and 30 req/min via Upstash sliding windows.
 */
export const AdjustCopyInputSchema = z.object({
  userId: z.string().min(1),
  current: CopyContentSchema,
  message: z.string().min(1).max(2000),
  context: z.object({
    productId: z.string().min(1),
    creatives: z.array(AdjustCopyCreativeContextSchema),
  }),
})

export type AdjustCopyInput = z.infer<typeof AdjustCopyInputSchema>

/**
 * Discriminated result of the adjustCopy chat route (§13).
 *
 * - `ok: true`  → the LLM produced an `AdjustCopyAction` and (when the
 *   action carries a copy patch) every guard passed.
 * - `ok: false` → either the LLM could not satisfy the schema after one
 *   critique retry, or a post-check guard rejected the patch. The client
 *   branches on `ok` BEFORE rendering — spec §13 is explicit.
 */
export const AdjustCopyResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), action: AdjustCopyActionSchema }),
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
])

export type AdjustCopyResult = z.infer<typeof AdjustCopyResultSchema>

// ─── Sales-angle classification (§12) ────────────────────────────────────────

/**
 * Output of one self-consistency vote call. `null` is the only sentinel
 * value — never magic strings. Aggregation logic lives in the call site.
 */
export const SalesAngleClassificationSchema = z.object({
  angles: z.array(
    z.object({
      creativeId: z.string(),
      angle: SalesAngle.nullable(),
    }),
  ),
})

export type SalesAngleClassification = z.infer<typeof SalesAngleClassificationSchema>
