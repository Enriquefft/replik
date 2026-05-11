import "server-only"

import { z } from "zod"

import {
  type BurnedSubsBand,
  BurnedSubsBandSchema,
  type BurnedSubsKind,
} from "@/lib/ai/taxonomies.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"
import { filterChromeTracks } from "@/lib/video/chrome-filters.ts"
import { type ClassifiedTrack, classifyTracks } from "@/lib/video/classify-tracks.ts"
import { runOcrOnVideo } from "@/lib/video/ocr-detect.ts"
import { groupIntoTracks, type TextTrack } from "@/lib/video/text-lines.ts"

export { type BurnedSubsBand, BurnedSubsBandSchema }

/**
 * Pipeline result. `passThrough: true` is set when the detection
 * concluded there's nothing to mask — caller should burn the new
 * subtitle on the unmodified source. When `bands` is non-empty the
 * masker uses them; passThrough is implicitly false.
 */
export const DetectBurnedSubsResultSchema = z.object({
  bands: z.array(BurnedSubsBandSchema),
  passThrough: z.boolean().optional(),
})
export type DetectBurnedSubsResult = z.infer<typeof DetectBurnedSubsResultSchema>

export interface DetectBurnedSubsInput {
  /** Absolute path to a video file already downloaded locally. */
  inputPath: string
  /** Total duration of the video in seconds (from ffprobe). */
  durationSec: number
}

/**
 * Padding (as a fraction of the track's height) added around the
 * mask bbox to absorb anti-aliased glyph edges, drop shadows, and
 * outline glow. Captions visually exceed the OCR text bbox by a
 * non-trivial margin on TikTok-style burns.
 */
const VERTICAL_PAD_RATIO = 0.3
const HORIZONTAL_PAD_RATIO = 0.2
const MIN_VERTICAL_PAD = 0.015
const MIN_HORIZONTAL_PAD = 0.015

/**
 * Hard cap on a single band's height — beyond this the mask destroys
 * too much of the frame and we're better off pass-through.
 */
const MAX_BAND_HEIGHT_FRACTION = 0.4

/**
 * Hard cap on the union of all bands' vertical coverage. Text-heavy
 * product demos (on-product labels, packaging text, comparison charts)
 * often produce many high-confidence OCR tracks that the classifier
 * decides to mask. Past 50% of the frame, masking is more destructive
 * than the source captions themselves — fail-open instead.
 */
const MAX_AGGREGATE_COVERAGE = 0.5

/**
 * Vertical IoU at which two bands of the same kind and overlapping
 * active windows get merged into one. Padding inflation frequently
 * pushes neighbouring text-rows into touching/overlapping bands;
 * merging recovers a single tall band instead of N stacked ones.
 * Same-kind threshold is looser than cross-kind because same-kind
 * mis-clusters are common (PaddleOCR splits a single dialog row into
 * two adjacent bands).
 */
const SAME_KIND_VERTICAL_IOU_MERGE = 0.2

/**
 * Min(vIoU, hIoU) at which two bands get merged even when their
 * classified `kind` differs. Two captions covering near-identical
 * pixels but tagged hook + dialog (mis-classification) would otherwise
 * paint two stacked blur boxes on the same region — strictly worse
 * than one merged blur. Threshold is high enough that distinct
 * captions (e.g. top hook + bottom dialog) keep their independence,
 * since their spatial IoU is ~0.
 */
const CROSS_KIND_SPATIAL_IOU_MERGE = 0.3

/**
 * When two same-kind bands have time overlap and zero vIoU, merge
 * them anyway if the vertical gap between their nearest edges is at
 * most this multiple of the smaller band's height. Captures the case
 * where a single multi-row caption (two transcript lines stacked
 * within the standard line gap) gets fragmented into two adjacent
 * bands by OCR row clustering. Ratio of 1.0 means "merge if the gap
 * is no wider than the shorter band itself"; wider gaps imply
 * genuinely independent captions and stay separate.
 */
const SAME_KIND_VERTICAL_GAP_MERGE_RATIO = 1.0

/**
 * Snap a band's left/right to the canvas edges when it lands within
 * this gap. Captures the empirical fact that hooks and dialog are
 * full-width by convention — leaving a 5% sliver of un-masked text
 * defeats the entire purpose. Skipped for midblock kind so floating
 * meme blocks keep their pillarbox.
 */
const HORIZONTAL_EDGE_SNAP_GAP = 0.08

/**
 * Active-window padding seconds. Adds buffer before/after the
 * tracked window so the mask doesn't pop off a frame early or
 * activate a frame late.
 */
const ACTIVE_WINDOW_PAD_SEC = 0.4

const FAIL_OPEN: DetectBurnedSubsResult = { bands: [], passThrough: true }

/**
 * Full burned-subs detection pipeline:
 *   1. Sample frames at 1Hz, OCR every frame with PP-OCRv5 mobile.
 *   2. Group OCR words → frame-local lines → cross-frame TextTracks.
 *   3. Drop chrome (handles, hashtags, URLs, share/like UI…) via regex.
 *   4. Ask Haiku to classify each remaining track as mask vs keep,
 *      tagging each maskable track with a `kind` (dialog/hook/midblock/karaoke).
 *   5. Convert maskable tracks into BurnedSubsBands with inflated bbox,
 *      edge-snap on full-width bands, and clipped active windows.
 *
 * Fail-open at every step: ffmpeg / OCR / Haiku errors all return
 * `{ bands: [], passThrough: true }`. The lane never blocks on a
 * detection failure.
 */
export async function detectBurnedSubs(
  input: DetectBurnedSubsInput,
): Promise<DetectBurnedSubsResult> {
  if (input.durationSec <= 0) {
    logEvent("detect_burned_subs.skipped_zero_duration", { inputPath: input.inputPath })
    return FAIL_OPEN
  }

  return withTiming(
    "detect_burned_subs",
    async () => {
      try {
        const frames = await runOcrOnVideo({
          inputPath: input.inputPath,
          durationSec: input.durationSec,
        })
        if (frames.length === 0) return FAIL_OPEN
        const rawTracks = groupIntoTracks(frames)
        const captionCandidates = filterChromeTracks(rawTracks)
        logEvent("detect_burned_subs.tracks", {
          rawCount: rawTracks.length,
          afterChrome: captionCandidates.length,
        })
        if (captionCandidates.length === 0) return FAIL_OPEN
        const classified = await classifyTracks(captionCandidates, {
          durationSec: input.durationSec,
        })
        if (classified.length === 0) return FAIL_OPEN
        const rawBands = classified
          .map((c) => toBand(c, input.durationSec))
          .filter((b): b is BurnedSubsBand => b !== null)
        if (rawBands.length === 0) return FAIL_OPEN
        const bands = mergeOverlappingBands(rawBands)
        const coverage = aggregateCoverage(bands)
        if (coverage > MAX_AGGREGATE_COVERAGE) {
          logEvent("detect_burned_subs.fail_open_high_coverage", {
            coverage,
            bandCount: bands.length,
          })
          return FAIL_OPEN
        }
        logEvent("detect_burned_subs.bands_ready", {
          rawCount: rawBands.length,
          mergedCount: bands.length,
          coverage,
        })
        return { bands }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logEvent("detect_burned_subs.failed", { reason })
        return FAIL_OPEN
      }
    },
    { inputPath: input.inputPath },
  )
}

/**
 * Convert a Haiku-approved track into the BurnedSubsBand the masker
 * consumes. Adds asymmetric vertical padding (captures glyph
 * descenders and outline glow), horizontal edge-snap on full-width
 * bands, and a time-window padded by ACTIVE_WINDOW_PAD_SEC clamped
 * to the video duration.
 *
 * Exported for unit testing.
 */
export function toBand(c: ClassifiedTrack, durationSec: number): BurnedSubsBand | null {
  const { track } = c
  const vPad = Math.max(MIN_VERTICAL_PAD, track.heightFraction * VERTICAL_PAD_RATIO)
  const hPad = Math.max(MIN_HORIZONTAL_PAD, track.heightFraction * HORIZONTAL_PAD_RATIO)
  const top = clamp01(track.topFraction - vPad)
  const bottom = clamp01(track.topFraction + track.heightFraction + vPad)
  const height = bottom - top
  if (height <= 0) return null
  if (height > MAX_BAND_HEIGHT_FRACTION) {
    logEvent("detect_burned_subs.dropped_oversize_band", {
      heightFraction: height,
      kind: c.kind,
    })
    return null
  }

  let left = clamp01(track.leftFraction - hPad)
  let right = clamp01(track.leftFraction + track.widthFraction + hPad)
  const isFullWidthCaption = c.kind === "dialog" || c.kind === "hook" || c.kind === "karaoke"
  if (isFullWidthCaption) {
    if (left <= HORIZONTAL_EDGE_SNAP_GAP) left = 0
    if (1 - right <= HORIZONTAL_EDGE_SNAP_GAP) right = 1
  }
  const width = right - left
  if (width <= 0) return null
  const isFullWidth = left === 0 && right === 1

  const activeStart = Math.max(0, track.activeStartSec - ACTIVE_WINDOW_PAD_SEC)
  const activeEnd = Math.min(durationSec, track.activeEndSec + ACTIVE_WINDOW_PAD_SEC)

  return {
    topFraction: top,
    heightFraction: height,
    confidence: c.confidence,
    activeStartSec: activeStart,
    activeEndSec: activeEnd,
    kind: c.kind,
    ...(isFullWidth ? {} : { leftFraction: left, widthFraction: width }),
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Merge bands that share vertical extent AND overlap in time. The
 * pad inflation in `toBand` frequently pushes neighbouring text rows
 * into touching bands which look — and mask — like one tall band.
 * Merging is order-independent: we sort by topFraction and iteratively
 * absorb any band that overlaps the running accumulator. Exported for
 * unit testing.
 */
export function mergeOverlappingBands(bands: readonly BurnedSubsBand[]): BurnedSubsBand[] {
  const sorted = [...bands].sort((a, b) => a.topFraction - b.topFraction)
  const merged: BurnedSubsBand[] = []
  for (const band of sorted) {
    const target = merged.findIndex((m) => bandsShouldMerge(m, band))
    if (target === -1) {
      merged.push(band)
      continue
    }
    const existing = merged[target]
    if (existing === undefined) continue
    merged[target] = mergeBandPair(existing, band)
  }
  return merged
}

function bandsShouldMerge(a: BurnedSubsBand, b: BurnedSubsBand): boolean {
  const aStart = a.activeStartSec ?? 0
  const aEnd = a.activeEndSec ?? Number.POSITIVE_INFINITY
  const bStart = b.activeStartSec ?? 0
  const bEnd = b.activeEndSec ?? Number.POSITIVE_INFINITY
  if (Math.min(aEnd, bEnd) <= Math.max(aStart, bStart)) return false
  const vIoU = bandVerticalIoU(a, b)
  if (a.kind === b.kind) {
    if (vIoU >= SAME_KIND_VERTICAL_IOU_MERGE) return true
    // Vertical IoU is zero but the bands may still be adjacent rows of
    // a single multi-row caption fragmented by OCR. Merge when the gap
    // is at most the smaller band's height.
    const gap = bandVerticalGap(a, b)
    const minHeight = Math.min(a.heightFraction, b.heightFraction)
    if (gap >= 0 && minHeight > 0 && gap <= SAME_KIND_VERTICAL_GAP_MERGE_RATIO * minHeight) {
      return true
    }
    return false
  }
  // Different `kind` — only merge when spatial overlap is high enough
  // that two separate masks would paint over each other anyway.
  const hIoU = bandHorizontalIoU(a, b)
  return Math.min(vIoU, hIoU) >= CROSS_KIND_SPATIAL_IOU_MERGE
}

function bandVerticalGap(a: BurnedSubsBand, b: BurnedSubsBand): number {
  const aBottom = a.topFraction + a.heightFraction
  const bBottom = b.topFraction + b.heightFraction
  return Math.max(a.topFraction, b.topFraction) - Math.min(aBottom, bBottom)
}

function bandVerticalIoU(a: BurnedSubsBand, b: BurnedSubsBand): number {
  const intersection = Math.max(
    0,
    Math.min(a.topFraction + a.heightFraction, b.topFraction + b.heightFraction) -
      Math.max(a.topFraction, b.topFraction),
  )
  const union =
    Math.max(a.topFraction + a.heightFraction, b.topFraction + b.heightFraction) -
    Math.min(a.topFraction, b.topFraction)
  if (union <= 0) return 0
  return intersection / union
}

function bandHorizontalIoU(a: BurnedSubsBand, b: BurnedSubsBand): number {
  const aLeft = a.leftFraction ?? 0
  const bLeft = b.leftFraction ?? 0
  const aRight = aLeft + (a.widthFraction ?? 1)
  const bRight = bLeft + (b.widthFraction ?? 1)
  const intersection = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft))
  const union = Math.max(aRight, bRight) - Math.min(aLeft, bLeft)
  if (union <= 0) return 0
  return intersection / union
}

function mergeBandPair(a: BurnedSubsBand, b: BurnedSubsBand): BurnedSubsBand {
  const top = Math.min(a.topFraction, b.topFraction)
  const bottom = Math.max(a.topFraction + a.heightFraction, b.topFraction + b.heightFraction)
  const aLeft = a.leftFraction ?? 0
  const bLeft = b.leftFraction ?? 0
  const aRight = aLeft + (a.widthFraction ?? 1)
  const bRight = bLeft + (b.widthFraction ?? 1)
  const left = Math.min(aLeft, bLeft)
  const right = Math.max(aRight, bRight)
  const isFullWidth = left === 0 && right === 1
  const aStart = a.activeStartSec ?? 0
  const aEnd = a.activeEndSec ?? Number.POSITIVE_INFINITY
  const bStart = b.activeStartSec ?? 0
  const bEnd = b.activeEndSec ?? Number.POSITIVE_INFINITY
  const start = Math.min(aStart, bStart)
  const end = Math.max(aEnd, bEnd)
  return {
    topFraction: top,
    heightFraction: bottom - top,
    confidence: Math.max(a.confidence, b.confidence),
    activeStartSec: start,
    activeEndSec: Number.isFinite(end) ? end : (a.activeEndSec ?? b.activeEndSec ?? 0),
    kind: pickMergedKind(a, b),
    ...(isFullWidth ? {} : { leftFraction: left, widthFraction: right - left }),
  }
}

/**
 * Tie-breaker when merging two bands of different `kind`. Picks the
 * higher-confidence kind; on a tie prefers the more conservative
 * mask strategy in `resolveMaskPlan` (midblock > hook > karaoke >
 * dialog) so the merged band doesn't accidentally degrade to a
 * lighter mask.
 */
function pickMergedKind(a: BurnedSubsBand, b: BurnedSubsBand): BurnedSubsKind | undefined {
  if (a.kind === b.kind) return a.kind
  if (a.kind === undefined) return b.kind
  if (b.kind === undefined) return a.kind
  if (a.confidence > b.confidence) return a.kind
  if (b.confidence > a.confidence) return b.kind
  return kindPriority(a.kind) >= kindPriority(b.kind) ? a.kind : b.kind
}

function kindPriority(kind: BurnedSubsKind): number {
  switch (kind) {
    case "midblock":
      return 3
    case "hook":
      return 2
    case "karaoke":
      return 1
    case "dialog":
      return 0
  }
}

/**
 * Max fraction of the frame's vertical extent that is masked at any
 * single moment in time. Replaces a naive Y-union (which compounded
 * bands across non-overlapping time windows) — the only thing the
 * viewer sees is the bands active at their current playback instant,
 * so coverage should be measured per-instant and then maxed.
 *
 * Algorithm:
 *   1. Collect (time, band, edge) events for every band's
 *      [activeStartSec, activeEndSec] window.
 *   2. Sweep events in time order, maintaining the active set.
 *   3. At each event time, recompute the Y-union coverage of the
 *      currently active bands and take the running max.
 *
 * Bands with null active windows are treated as on for the entire
 * video — i.e. they count at every instant. Exported for unit testing.
 */
export function aggregateCoverage(bands: readonly BurnedSubsBand[]): number {
  if (bands.length === 0) return 0
  const events: { t: number; idx: number; type: "start" | "end" }[] = []
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]
    if (band === undefined) continue
    const start = band.activeStartSec ?? Number.NEGATIVE_INFINITY
    const end = band.activeEndSec ?? Number.POSITIVE_INFINITY
    if (end <= start) continue
    events.push({ t: start, idx: i, type: "start" })
    events.push({ t: end, idx: i, type: "end" })
  }
  if (events.length === 0) return 0
  // Sort by time, with `start` before `end` at the same instant so
  // an instantaneous transition still reports the band as active.
  events.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t
    if (a.type === b.type) return 0
    return a.type === "start" ? -1 : 1
  })
  const active = new Set<number>()
  let maxCoverage = 0
  for (const event of events) {
    if (event.type === "start") active.add(event.idx)
    else active.delete(event.idx)
    if (active.size === 0) continue
    const activeBands: BurnedSubsBand[] = []
    for (const i of active) {
      const band = bands[i]
      if (band !== undefined) activeBands.push(band)
    }
    const instantCoverage = yUnionCoverage(activeBands)
    if (instantCoverage > maxCoverage) maxCoverage = instantCoverage
  }
  return maxCoverage
}

function yUnionCoverage(bands: readonly BurnedSubsBand[]): number {
  const intervals = bands.map((b) => ({
    start: b.topFraction,
    end: b.topFraction + b.heightFraction,
  }))
  intervals.sort((a, b) => a.start - b.start)
  let covered = 0
  let cursor = 0
  for (const interval of intervals) {
    const start = Math.max(interval.start, cursor)
    if (interval.end > start) {
      covered += interval.end - start
      cursor = interval.end
    }
  }
  return covered
}

/**
 * Re-exported for the diagnostic harness which compares track-level
 * classifications across runs.
 */
export type { BurnedSubsKind, ClassifiedTrack, TextTrack }
