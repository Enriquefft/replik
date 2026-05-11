import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"

import { defaultTemperature } from "@/lib/ai/models.ts"
import { type BurnedSubsKind, BurnedSubsKindSchema } from "@/lib/ai/taxonomies.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"
import type { TextTrack } from "@/lib/video/text-lines.ts"

/**
 * Track decision returned by Haiku:
 *   - `mask`: cover this region with our viral caption later. The `kind`
 *     drives mask style (drawbox vs blur vs crop).
 *   - `keep`: visible content text (product label, on-product print,
 *     graphic copy) that must NOT be masked.
 */
const TrackDecisionSchema = z.object({
  index: z
    .number()
    .describe(
      "Zero-based index of the track within the request. The .int() modifier is intentionally omitted because Anthropic's structured-output rejects JSON Schema min/max bounds that zod auto-injects for integers; we group by the value, never compute on it.",
    ),
  decision: z
    .enum(["mask", "keep"])
    .describe("Whether the region should be masked over (mask) or left visible (keep)."),
  kind: BurnedSubsKindSchema.optional().describe(
    "Caption style when `decision === 'mask'`. Drives masker behaviour (drawbox vs blur vs crop). Omit when decision is keep.",
  ),
  confidence: z.number().describe("Probability the decision is correct (0..1)."),
})

const ClassifyTracksResponseSchema = z.object({
  tracks: z.array(TrackDecisionSchema),
})

/** Captures the per-track outcome plus the source track for the masker. */
export interface ClassifiedTrack {
  track: TextTrack
  kind: BurnedSubsKind
  confidence: number
}

export interface ClassifyTracksDeps {
  model?: LanguageModel
}

export interface ClassifyTracksContext {
  /** Total source video duration in seconds — used to derive each
   *  track's `videoCoverageFraction` signal for the classifier. */
  durationSec: number
}

const MIN_DECISION_CONFIDENCE = 0.4

/**
 * Classify each track as caption-to-mask vs content-to-keep with a
 * single Haiku call. Captions get a `kind` (dialog/hook/midblock/
 * karaoke) used by the masker to pick a strategy.
 *
 * Why Haiku and not pure geometry: geometry alone confuses on-product
 * printed copy ("CLEANS 99% OF BACTERIA" on a bottle) with hook
 * overlays, and confuses static product callouts ("100% NATURAL") with
 * midblock memes. The model reads the text and decides on linguistic
 * grounds. Haiku is cheap (~$1/MTok) and fast (≤2s for a dozen tracks).
 *
 * Fail-mode: any error → all tracks default to `keep`. Better to leave
 * the source unmasked than to destroy product visuals.
 */
export async function classifyTracks(
  tracks: readonly TextTrack[],
  context: ClassifyTracksContext,
  deps: ClassifyTracksDeps = {},
): Promise<ClassifiedTrack[]> {
  if (tracks.length === 0) return []

  const model = deps.model ?? anthropic("claude-haiku-4-5-20251001")
  return withTiming(
    "classify_tracks",
    async () => {
      try {
        const { object } = await generateObject({
          model,
          schema: ClassifyTracksResponseSchema,
          schemaName: "ClassifyTextTracks",
          schemaDescription:
            "Per-track decision (mask vs keep) with caption kind. One entry per input track, in index order.",
          temperature: defaultTemperature,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: renderUser(tracks, context) }],
        })
        const parsed = ClassifyTracksResponseSchema.parse(object)
        return materialise(tracks, parsed.tracks)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logEvent("classify_tracks.failed", { reason })
        return []
      }
    },
    { trackCount: tracks.length },
  )
}

function materialise(
  tracks: readonly TextTrack[],
  decisions: readonly z.infer<typeof TrackDecisionSchema>[],
): ClassifiedTrack[] {
  const byIndex = new Map<number, z.infer<typeof TrackDecisionSchema>>()
  for (const d of decisions) byIndex.set(d.index, d)
  const out: ClassifiedTrack[] = []
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i]
    if (track === undefined) continue
    const decision = byIndex.get(i)
    if (decision === undefined) continue
    if (decision.decision !== "mask") continue
    if (decision.confidence < MIN_DECISION_CONFIDENCE) continue
    const kind = decision.kind ?? inferKindFromGeometry(track)
    out.push({ track, kind, confidence: decision.confidence })
  }
  return out
}

/**
 * Backstop when the model returned `decision: "mask"` without a kind.
 * Geometry-only inference is fine here because the model already
 * decided it IS a caption — kind only picks the mask strategy.
 */
function inferKindFromGeometry(track: TextTrack): BurnedSubsKind {
  const center = track.topFraction + track.heightFraction / 2
  if (center < 0.25) return "hook"
  if (center > 0.7) return "dialog"
  return "midblock"
}

const SYSTEM_PROMPT = [
  "You are a video QA classifier deciding which detected text regions in a",
  "social-ad video are BURNED-IN CAPTIONS (transcript / hook / meme text",
  "rendered into the pixels) vs CONTENT (on-product print, packaging text,",
  "graphic copy, prices) that must be preserved.",
  "",
  "You will receive a list of text tracks. Each track has:",
  "  - position: top/left/height/width as fractions of the frame",
  "  - active window: time range it appears (seconds)",
  "  - frameCount: how many frames it appeared in",
  "  - textSamples: up to 8 distinct text strings seen across frames",
  "  - distinctSampleCount: number of distinct text strings observed",
  "  - videoCoverageFraction: (activeEnd - activeStart) / total video duration",
  "",
  "Return one decision per track in index order:",
  '  { "tracks": [{ "index", "decision": "mask"|"keep", "kind"?, "confidence" }] }',
  "",
  "DECIDE `mask` WHEN:",
  "- Text reads like a transcript line, hook headline, viral meme",
  "  block, or per-word karaoke caption.",
  "- Position + persistence match a caption pattern (hooks pin to the",
  "  top and rarely change text; dialog sits bottom and rotates text",
  "  every few seconds; karaoke has many distinct samples in a short",
  "  active window).",
  "- The text is the kind of thing you'd see on a creator's burned-in",
  '  subtitle, e.g. "I CANT BELIEVE THIS WORKS", "wait for it…",',
  '  "ATTENTION!!!", "POV: you forgot…", "and that\'s how I…", etc.',
  "",
  "DECIDE `keep` WHEN:",
  "- Text is printed on the product itself (label, packaging, ingredient list).",
  "- Text is a price tag, model number, dimension callout, or technical spec.",
  "- Text is a brand wordmark integrated into the product graphic.",
  "- You're <40% confident the region is a caption — keep is the safe default.",
  "",
  "STATIC-CONTENT BIAS:",
  "- A track with `distinctSampleCount === 1` AND `videoCoverageFraction > 0.5`",
  "  is almost always static graphic content: a logo, a brand chyron, a",
  "  persistent meme block that IS the content, or product packaging.",
  "  Strongly prefer `keep` for these unless the text reads unambiguously",
  "  as a short caption/hook headline (e.g. `WAIT FOR IT`, `POV:`, an",
  "  `ATTENTION!!!` banner). Masking static content destroys the joke.",
  "",
  "KIND ENUM when decision=mask:",
  '- "dialog":   transcript captions, usually bottom third, multiple distinct samples.',
  '- "hook":     static headline at the top, often UPPERCASE, persists for many seconds.',
  '- "midblock": centered meme/Hormozi text — must be blurred or boxed.',
  '- "karaoke":  word-pop / single-word captions that change every <1s.',
  "",
  "Confidence: your honest 0..1 probability the decision is correct.",
  "We discard decisions below 0.40, so don't push borderline calls toward `mask`.",
].join("\n")

interface TrackPayload {
  index: number
  topFraction: number
  heightFraction: number
  leftFraction: number
  widthFraction: number
  activeStartSec: number
  activeEndSec: number
  frameCount: number
  textSamples: string[]
  distinctSampleCount: number
  videoCoverageFraction: number
}

function renderUser(tracks: readonly TextTrack[], context: ClassifyTracksContext): string {
  const safeDuration = context.durationSec > 0 ? context.durationSec : 1
  const payload: TrackPayload[] = tracks.map((track, index) => ({
    index,
    topFraction: round(track.topFraction),
    heightFraction: round(track.heightFraction),
    leftFraction: round(track.leftFraction),
    widthFraction: round(track.widthFraction),
    activeStartSec: round(track.activeStartSec),
    activeEndSec: round(track.activeEndSec),
    frameCount: track.frameCount,
    textSamples: track.textSamples,
    distinctSampleCount: track.textSamples.length,
    videoCoverageFraction: round((track.activeEndSec - track.activeStartSec) / safeDuration),
  }))
  return [
    `Classify ${tracks.length.toString()} text tracks.`,
    `Source video duration: ${context.durationSec.toFixed(2)}s.`,
    "Return one decision per index in the order shown.",
    "",
    JSON.stringify({ tracks: payload }, null, 2),
  ].join("\n")
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
