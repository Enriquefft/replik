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
