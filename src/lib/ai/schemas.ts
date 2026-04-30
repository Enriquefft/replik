import { z } from "zod"
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
 * Fully-resolved product after Stage C LLM gap-fill (§7).
 * All fields required, plus extracted keyword buckets.
 */
export const ProductFinalSchema = z.object({
  imageUrl: z.url(),
  productName: z.string().min(1),
  category: InterestCategory,
  priceText: z.string(),
  description: z.string(),
  locale: Locale,
  keywords: z.object({
    broad: z.array(z.string()),
    narrow: z.array(z.string()),
  }),
})

export type ProductFinal = z.infer<typeof ProductFinalSchema>

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
 * The `.refine` brand-token check is wired at the call site in Phase 1;
 * the foundation declares the structural shape only.
 * Phase 1 adds: `.refine(s => brandTokens.every(b => s.cues.some(c => c.text.includes(b))))`.
 */
export const SrtTranslateResultSchema = z.object({
  cues: z.array(TranslatedCueSchema),
})

export type SrtTranslateResult = z.infer<typeof SrtTranslateResultSchema>

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
 */
export const AdjustCopyInputSchema = z.object({
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
