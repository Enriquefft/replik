import type { BurnedSubsBand } from "@/lib/ai/taxonomies.ts"

/**
 * Mask plan — one action per detected band. Every action operates in
 * SOURCE-FRAME fractional coordinates (no crop, no reprojection)
 * because the burn pipeline runs every mask action BEFORE normalising
 * to the 1080×1920 output canvas.
 *
 * Why no crop: cropping is permanent for the full video duration and
 * has no time-gated equivalent. Time-gated blur/drawbox preserves the
 * frame outside the caption's active window, which matters when a
 * hook overlay only appears in the first 3 seconds — we don't want
 * the censor-bar look across the entire video.
 *
 * `activeStartSec`/`activeEndSec` produce an ffmpeg
 * `enable='between(t,a,b)'` clause when both are present. When either
 * is null the mask is unconditional (no time gate).
 *
 * Coordinates: `topFraction`, `heightFraction` are fractions of source
 * height. `leftFraction`, `widthFraction` are fractions of source
 * width. When the band came back without `leftFraction`/`widthFraction`
 * (legacy full-width path) the resolver fills in `left=0`, `width=1`.
 */
export interface MaskAction {
  kind: "blur" | "blackbox"
  topFraction: number
  heightFraction: number
  leftFraction: number
  widthFraction: number
  activeStartSec: number | null
  activeEndSec: number | null
}

export interface MaskPlan {
  actions: readonly MaskAction[]
}

/**
 * Blur is unreliable on bands taller than this — even a heavy
 * gaussian falloff still leaves text shape readable. Escalate to
 * opaque drawbox.
 */
const BLUR_HEIGHT_ESCALATION = 0.35
/**
 * Below this confidence we don't trust blur to hide the band
 * cleanly — fall back to drawbox.
 */
const BLACK_BOX_CONFIDENCE_FLOOR = 0.6

const NOOP: MaskPlan = { actions: [] }

/**
 * Build the mask plan from detected bands. Tall bands escalate to
 * drawbox (blur of a giant block still shows the text shape) and
 * low-confidence bands escalate to drawbox (we don't trust blur to
 * hide a band we're not sure about). Everything else gets blurred.
 *
 * Karaoke is NOT auto-escalated. Heavy gaussian blur hides per-word
 * captions adequately, and false-positive `karaoke` detections (e.g.
 * blinking-light signage misread as flickering captions) under a
 * drawbox erase entire regions of legitimate content — the asymmetric
 * cost favours blur.
 *
 * Pure helper — exported for unit tests.
 */
export function resolveMaskPlan(bands: readonly BurnedSubsBand[]): MaskPlan {
  if (bands.length === 0) return NOOP
  const actions: MaskAction[] = []
  for (const band of bands) {
    actions.push(toAction(band))
  }
  return { actions }
}

function toAction(band: BurnedSubsBand): MaskAction {
  const kind: "blur" | "blackbox" = shouldEscalateToBlackBox(band) ? "blackbox" : "blur"
  const left = band.leftFraction ?? 0
  const width = band.widthFraction ?? 1
  return {
    kind,
    topFraction: band.topFraction,
    heightFraction: band.heightFraction,
    leftFraction: left,
    widthFraction: width,
    activeStartSec: band.activeStartSec ?? null,
    activeEndSec: band.activeEndSec ?? null,
  }
}

function shouldEscalateToBlackBox(band: BurnedSubsBand): boolean {
  if (band.heightFraction > BLUR_HEIGHT_ESCALATION) return true
  if (band.confidence < BLACK_BOX_CONFIDENCE_FLOOR) return true
  return false
}
