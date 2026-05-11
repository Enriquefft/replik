import "server-only"

import { z } from "zod"

import type { OcrFrame, OcrWord } from "@/lib/video/ocr-detect.ts"

/**
 * Y-axis IoU threshold for grouping OCR words on the same row inside
 * a single frame. PaddleOCR already does line-grouping but splits when
 * two words on the same row have a big horizontal gap (e.g. left-aligned
 * "THE LAUGH" + right-aligned game-show overlay). Re-clustering by Y
 * recovers the visual row.
 */
const SAME_LINE_Y_IOU_THRESHOLD = 0.45

/**
 * Vertical IoU threshold for stitching frame-local lines into a
 * cross-frame temporal track. Lower than per-frame because the same
 * caption can drift a few pixels frame-to-frame (anti-aliasing,
 * rendering jitter).
 */
const CROSS_FRAME_Y_IOU_THRESHOLD = 0.25

/**
 * Horizontal IoU threshold required to stitch lines into a track when
 * widths are close. Two separate captions at the same Y but different
 * X bands (rare but possible on split-screen ads) stay separate.
 */
const CROSS_FRAME_X_IOU_THRESHOLD = 0.2

const FrameLineSchema = z.object({
  tSec: z.number().nonnegative(),
  frameWidth: z.number().positive(),
  frameHeight: z.number().positive(),
  /** Concatenated text (left-to-right) for this single-frame line. */
  text: z.string(),
  /** Top edge in source-frame pixels. */
  yTop: z.number(),
  /** Bottom edge in source-frame pixels. */
  yBottom: z.number(),
  /** Left edge in source-frame pixels. */
  xLeft: z.number(),
  /** Right edge in source-frame pixels. */
  xRight: z.number(),
  /** Mean recognition confidence across constituent words (0..1). */
  confidence: z.number(),
})
export type FrameLine = z.infer<typeof FrameLineSchema>

export const TextTrackSchema = z.object({
  /** First second the track appears. */
  activeStartSec: z.number().nonnegative(),
  /** Last second the track appears. Inclusive. */
  activeEndSec: z.number().nonnegative(),
  /** Top edge as a fraction of frame height (0..1). */
  topFraction: z.number(),
  /** Height as a fraction of frame height (0..1). */
  heightFraction: z.number(),
  /** Left edge as a fraction of frame width (0..1). */
  leftFraction: z.number(),
  /** Width as a fraction of frame width (0..1). */
  widthFraction: z.number(),
  /** Mean recognition confidence across all member frames (0..1). */
  confidence: z.number(),
  /** Number of frames the track appeared in. */
  frameCount: z.number(),
  /**
   * Distinct text samples (capped) — used downstream for chrome
   * filtering and Haiku classification. Order preserved (first
   * appearance first). Captures enough variety to flag karaoke
   * (high distinct count, low frameCount per text) and dialog
   * (different text every few seconds, stable Y).
   */
  textSamples: z.array(z.string()),
})
export type TextTrack = z.infer<typeof TextTrackSchema>

/** Cap on `textSamples` per track to keep payloads bounded. */
const MAX_TEXT_SAMPLES = 8

/**
 * Two-stage grouping:
 *   1. Per frame: cluster OCR words into FrameLine[] by Y-IoU. Recovers
 *      the visual row when PaddleOCR's gap-based line split is too
 *      aggressive.
 *   2. Across frames: stitch FrameLines into TextTrack[] by overlapping
 *      Y bands AND overlapping X bands (loose threshold). The X check
 *      prevents merging a top hook into a top-but-different
 *      pseudo-caption that happens to share Y.
 *
 * Pure function — easy to unit test, no I/O.
 */
export function groupIntoTracks(frames: readonly OcrFrame[]): TextTrack[] {
  const allFrameLines: FrameLine[] = []
  for (const frame of frames) {
    const lines = groupFrameWordsIntoLines(frame)
    allFrameLines.push(...lines)
  }
  return stitchTracks(allFrameLines)
}

/**
 * Cluster a single frame's OCR words into visual rows. PaddleOCR's
 * own line-index is the seed (already mostly correct), then merge any
 * two lines whose vertical bands have IoU above
 * SAME_LINE_Y_IOU_THRESHOLD — captures rows split by large horizontal
 * gaps. Exported for unit testing.
 */
export function groupFrameWordsIntoLines(frame: OcrFrame): FrameLine[] {
  if (frame.words.length === 0) return []
  const byIndex = new Map<number, OcrWord[]>()
  for (const word of frame.words) {
    const bucket = byIndex.get(word.lineIndex)
    if (bucket === undefined) {
      byIndex.set(word.lineIndex, [word])
    } else {
      bucket.push(word)
    }
  }
  const seeds = [...byIndex.values()].map((words) => wordsToLine(words, frame))
  return mergeLinesByYIoU(seeds, frame)
}

function wordsToLine(words: readonly OcrWord[], frame: OcrFrame): FrameLine {
  const sorted = [...words].sort((a, b) => a.x - b.x)
  let yTop = Infinity
  let yBottom = -Infinity
  let xLeft = Infinity
  let xRight = -Infinity
  let confSum = 0
  for (const w of sorted) {
    if (w.y < yTop) yTop = w.y
    if (w.y + w.height > yBottom) yBottom = w.y + w.height
    if (w.x < xLeft) xLeft = w.x
    if (w.x + w.width > xRight) xRight = w.x + w.width
    confSum += w.confidence
  }
  return {
    tSec: frame.tSec,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    text: sorted.map((w) => w.text).join(" "),
    yTop,
    yBottom,
    xLeft,
    xRight,
    confidence: confSum / sorted.length,
  }
}

function mergeLinesByYIoU(lines: readonly FrameLine[], frame: OcrFrame): FrameLine[] {
  const buckets: FrameLine[][] = []
  for (const line of lines) {
    let placed = false
    for (const bucket of buckets) {
      const rep = bucket[0]
      if (rep === undefined) continue
      if (yIoU(line, rep) >= SAME_LINE_Y_IOU_THRESHOLD) {
        bucket.push(line)
        placed = true
        break
      }
    }
    if (!placed) buckets.push([line])
  }
  return buckets.map((bucket) => mergeBucket(bucket, frame))
}

function mergeBucket(bucket: readonly FrameLine[], frame: OcrFrame): FrameLine {
  if (bucket.length === 1) {
    const only = bucket[0]
    if (only === undefined) throw new Error("mergeBucket: empty bucket")
    return only
  }
  const sortedByX = [...bucket].sort((a, b) => a.xLeft - b.xLeft)
  let yTop = Infinity
  let yBottom = -Infinity
  let xLeft = Infinity
  let xRight = -Infinity
  let confSum = 0
  for (const line of sortedByX) {
    if (line.yTop < yTop) yTop = line.yTop
    if (line.yBottom > yBottom) yBottom = line.yBottom
    if (line.xLeft < xLeft) xLeft = line.xLeft
    if (line.xRight > xRight) xRight = line.xRight
    confSum += line.confidence
  }
  return {
    tSec: frame.tSec,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    text: sortedByX.map((line) => line.text).join(" "),
    yTop,
    yBottom,
    xLeft,
    xRight,
    confidence: confSum / bucket.length,
  }
}

interface TrackAccumulator {
  members: FrameLine[]
  /** Running consensus bbox in NORMALISED frame coords. */
  topFraction: number
  bottomFraction: number
  leftFraction: number
  rightFraction: number
}

function stitchTracks(frameLines: readonly FrameLine[]): TextTrack[] {
  if (frameLines.length === 0) return []
  const sorted = [...frameLines].sort((a, b) => a.tSec - b.tSec)
  const tracks: TrackAccumulator[] = []
  for (const line of sorted) {
    const norm = normalise(line)
    let placed = false
    for (const track of tracks) {
      if (
        verticalIoU(track, norm) >= CROSS_FRAME_Y_IOU_THRESHOLD &&
        horizontalIoU(track, norm) >= CROSS_FRAME_X_IOU_THRESHOLD
      ) {
        track.members.push(line)
        track.topFraction = Math.min(track.topFraction, norm.topFraction)
        track.bottomFraction = Math.max(track.bottomFraction, norm.bottomFraction)
        track.leftFraction = Math.min(track.leftFraction, norm.leftFraction)
        track.rightFraction = Math.max(track.rightFraction, norm.rightFraction)
        placed = true
        break
      }
    }
    if (!placed) {
      tracks.push({
        members: [line],
        topFraction: norm.topFraction,
        bottomFraction: norm.bottomFraction,
        leftFraction: norm.leftFraction,
        rightFraction: norm.rightFraction,
      })
    }
  }
  return tracks.map(toTextTrack)
}

interface NormalisedBox {
  topFraction: number
  bottomFraction: number
  leftFraction: number
  rightFraction: number
}

function normalise(line: FrameLine): NormalisedBox {
  return {
    topFraction: line.yTop / line.frameHeight,
    bottomFraction: line.yBottom / line.frameHeight,
    leftFraction: line.xLeft / line.frameWidth,
    rightFraction: line.xRight / line.frameWidth,
  }
}

function verticalIoU(a: { topFraction: number; bottomFraction: number }, b: NormalisedBox): number {
  const intersection = Math.max(
    0,
    Math.min(a.bottomFraction, b.bottomFraction) - Math.max(a.topFraction, b.topFraction),
  )
  const union =
    Math.max(a.bottomFraction, b.bottomFraction) - Math.min(a.topFraction, b.topFraction)
  if (union <= 0) return 0
  return intersection / union
}

function horizontalIoU(
  a: { leftFraction: number; rightFraction: number },
  b: NormalisedBox,
): number {
  const intersection = Math.max(
    0,
    Math.min(a.rightFraction, b.rightFraction) - Math.max(a.leftFraction, b.leftFraction),
  )
  const union =
    Math.max(a.rightFraction, b.rightFraction) - Math.min(a.leftFraction, b.leftFraction)
  if (union <= 0) return 0
  return intersection / union
}

function yIoU(a: FrameLine, b: FrameLine): number {
  const intersection = Math.max(0, Math.min(a.yBottom, b.yBottom) - Math.max(a.yTop, b.yTop))
  const union = Math.max(a.yBottom, b.yBottom) - Math.min(a.yTop, b.yTop)
  if (union <= 0) return 0
  return intersection / union
}

function toTextTrack(track: TrackAccumulator): TextTrack {
  const sortedByT = [...track.members].sort((a, b) => a.tSec - b.tSec)
  const first = sortedByT[0]
  const last = sortedByT.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error("toTextTrack: empty track")
  }
  const samples = collectSamples(sortedByT)
  const meanConf =
    sortedByT.reduce((s, line) => s + line.confidence, 0) / Math.max(1, sortedByT.length)
  return {
    activeStartSec: first.tSec,
    activeEndSec: last.tSec,
    topFraction: clamp01(track.topFraction),
    heightFraction: clamp01(track.bottomFraction - track.topFraction),
    leftFraction: clamp01(track.leftFraction),
    widthFraction: clamp01(track.rightFraction - track.leftFraction),
    confidence: meanConf,
    frameCount: sortedByT.length,
    textSamples: samples,
  }
}

function collectSamples(members: readonly FrameLine[]): string[] {
  const seen = new Set<string>()
  const samples: string[] = []
  for (const line of members) {
    const trimmed = line.text.trim()
    if (trimmed.length === 0) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    samples.push(trimmed)
    if (samples.length >= MAX_TEXT_SAMPLES) break
  }
  return samples
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
