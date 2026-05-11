import { z } from "zod"

/** Locked Phase 1 — see docs/ai-2.0.md §3. */
export const SalesAngle = z.enum([
  "precio",
  "demostracion",
  "testimonio",
  "urgencia",
  "dolor",
  "aspiracional",
  "comparacion",
  "regalo",
])

export type SalesAngle = z.infer<typeof SalesAngle>

export const InterestCategory = z.enum(["home_garden", "beauty", "fitness", "kitchen", "pets"])

export type InterestCategory = z.infer<typeof InterestCategory>

export const TemplateId = z.union([z.literal(1), z.literal(2), z.literal(3)])

export type TemplateId = z.infer<typeof TemplateId>

export const Locale = z.enum(["es-PE"])

export type Locale = z.infer<typeof Locale>

/**
 * A single burned-in caption band detected on the source frame, expressed in
 * normalised frame coordinates so the values survive any later downscale.
 * Output of the OCR-driven `detectBurnedSubs` pipeline; persisted on
 * `creatives.burnedSubsBands` so retries skip the call. Lives here to keep
 * `db/schema.ts` and `lib/video/detect-burned-subs.ts` free of an import
 * cycle.
 *
 * Coordinates are absolute fractions of frame height / width — the masker
 * doesn't need a separate dimensions probe.
 *
 * The temporal envelope (`activeStartSec`/`activeEndSec`) lets the masker
 * gate the drawbox with `enable='between(t,a,b)'` so we only paint over the
 * frames where the caption is actually on screen — no permanent black bar
 * across the whole video.
 *
 * `leftFraction` + `widthFraction` are optional. When omitted the band is
 * treated as full-width (legacy behaviour, matches anything Hormozi-style).
 * When present the masker draws a tight box that hugs the caption and
 * preserves the unmasked sides — required for hook overlays and midblock
 * memes that don't span the full canvas.
 */
/**
 * Caption styles the detector can return. The kind drives masking strategy:
 *   - `dialog`: lower-third transcript captions — bottom-anchored.
 *   - `hook`: top-anchored headline (TikTok hook overlay).
 *   - `midblock`: centered meme/Hormozi text — must be blurred or boxed,
 *     never cropped.
 *   - `karaoke`: word-pop style where the band flickers per-word. Masked
 *     with the same blur-by-default policy as other kinds (tall or
 *     low-confidence karaoke bands still escalate to drawbox via
 *     `resolveMaskPlan`).
 */
export const BurnedSubsKindSchema = z.enum(["dialog", "hook", "midblock", "karaoke"])
export type BurnedSubsKind = z.infer<typeof BurnedSubsKindSchema>

export const BurnedSubsBandSchema = z.object({
  topFraction: z.number().describe("Top edge of the band as a fraction of frame height (0..1)."),
  heightFraction: z.number().describe("Band height as a fraction of frame height (0..1)."),
  leftFraction: z
    .number()
    .optional()
    .describe(
      "Left edge of the band as a fraction of frame width (0..1). Omit for full-width bands.",
    ),
  widthFraction: z
    .number()
    .optional()
    .describe(
      "Band width as a fraction of frame width (0..1). Omit for full-width bands. Both leftFraction and widthFraction must be set together or both omitted.",
    ),
  activeStartSec: z
    .number()
    .optional()
    .describe("First second (inclusive) the band is on screen. Omit to mask for the entire video."),
  activeEndSec: z
    .number()
    .optional()
    .describe("Last second (inclusive) the band is on screen. Omit to mask for the entire video."),
  confidence: z.number().describe("Probability this band is a burned-in caption (0..1)."),
  kind: BurnedSubsKindSchema.optional().describe(
    "Caption style hint — drives whether the masker prefers crop, blur, or opaque box. Optional for back-compat with bands persisted before the field existed.",
  ),
})
export type BurnedSubsBand = z.infer<typeof BurnedSubsBandSchema>
