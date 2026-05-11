import "server-only"

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PaddleOcrService } from "ppu-paddle-ocr"
import { z } from "zod"

import { logEvent, withTiming } from "@/lib/observability/log.ts"
import { runFfmpeg } from "@/lib/video/run-ffmpeg.ts"

/**
 * Width to which sampled frames are downscaled before OCR. PP-OCRv5
 * mobile already resizes to maxSideLength=640 internally, so feeding
 * higher resolutions wastes ffmpeg time and disk for no recall gain.
 * 720 leaves headroom for fine print without paying for full HD.
 */
const FRAME_SCALE_WIDTH = 720

const OcrWordSchema = z.object({
  text: z.string(),
  /** Bbox left edge in source-frame pixels. */
  x: z.number(),
  /** Bbox top edge in source-frame pixels. */
  y: z.number(),
  /** Bbox width in source-frame pixels. */
  width: z.number(),
  /** Bbox height in source-frame pixels. */
  height: z.number(),
  confidence: z.number(),
  /**
   * Index of the line the word was grouped into by PaddleOCR within
   * THIS frame. Words on the same horizontal row share a lineIndex.
   * Useful to reconstruct multi-word captions without re-running
   * geometric clustering.
   */
  lineIndex: z.number(),
})
export type OcrWord = z.infer<typeof OcrWordSchema>

export const OcrFrameSchema = z.object({
  /** Timestamp in seconds where the frame was sampled. */
  tSec: z.number().nonnegative(),
  /** Source-frame width in pixels (after scale, equals FRAME_SCALE_WIDTH). */
  frameWidth: z.number().positive(),
  /** Source-frame height in pixels (after scale, preserves aspect). */
  frameHeight: z.number().positive(),
  words: z.array(OcrWordSchema),
})
export type OcrFrame = z.infer<typeof OcrFrameSchema>

export interface RunOcrOptions {
  inputPath: string
  durationSec: number
  /**
   * Time between sampled frames in seconds. Lower = better temporal
   * resolution for short captions; higher = cheaper. Default 1.0s
   * tracks dialog cadence (avg utterance ≈ 2-3s) without missing
   * single-second hook flashes.
   */
  samplePeriodSec?: number
  /**
   * Hard cap on number of frames sampled. Protects long videos from
   * runaway OCR cost. Default 60.
   */
  maxFrames?: number
}

let serviceInstance: Promise<PaddleOcrService> | null = null

function getService(): Promise<PaddleOcrService> {
  if (serviceInstance === null) {
    const svc = new PaddleOcrService({ debugging: { debug: false, verbose: false } })
    serviceInstance = svc.initialize().then(() => svc)
  }
  return serviceInstance
}

/**
 * Sample frames from `inputPath` at `samplePeriodSec` intervals and run
 * PP-OCRv5 mobile detection + recognition on each. Returns a flat array
 * of `OcrFrame`s, each with the timestamp and the per-word boxes
 * detected on that frame. Word boxes are in source-frame pixel
 * coordinates relative to the downscaled frame (frameWidth /
 * frameHeight on each `OcrFrame`).
 *
 * The PaddleOCR service is lazy-initialised once per process — ONNX
 * model load takes ~500ms and we want to amortise it across runs.
 *
 * Fail-modes:
 *   - ffmpeg failure → throws (caller fail-opens to empty bands).
 *   - PaddleOCR failure on a single frame → that frame contributes
 *     zero words; we keep going. Per-frame failures don't poison the
 *     whole detection.
 */
export async function runOcrOnVideo(options: RunOcrOptions): Promise<OcrFrame[]> {
  const maxFrames = options.maxFrames ?? 60
  const minPeriod = options.samplePeriodSec ?? 1
  if (options.durationSec <= 0) {
    logEvent("ocr_detect.skipped_zero_duration", { inputPath: options.inputPath })
    return []
  }
  // Adaptive period: never sample below `minPeriod` (so short videos
  // keep 1Hz temporal resolution), but stretch the period so
  // `maxFrames` covers the full duration on longer videos. Without
  // this stretch the OCR window truncates at minPeriod * maxFrames
  // (≈60s) and any caption appearing past that point goes unmasked.
  const samplePeriodSec = Math.max(minPeriod, options.durationSec / maxFrames)

  return withTiming(
    "ocr_detect",
    async () => {
      const workdir = await mkdtemp(join(tmpdir(), "replik-ocr-"))
      try {
        const frames = await extractFrames({
          inputPath: options.inputPath,
          durationSec: options.durationSec,
          samplePeriodSec,
          maxFrames,
          workdir,
        })
        if (frames.length === 0) return []
        const service = await getService()
        const ocrFrames: OcrFrame[] = []
        for (const frame of frames) {
          const result = await ocrFrame(service, frame)
          if (result !== null) ocrFrames.push(result)
        }
        logEvent("ocr_detect.summary", {
          framesSampled: frames.length,
          totalWords: ocrFrames.reduce((s, f) => s + f.words.length, 0),
        })
        return ocrFrames
      } finally {
        await rm(workdir, { recursive: true, force: true })
      }
    },
    { inputPath: options.inputPath, samplePeriodSec },
  )
}

interface ExtractedFrame {
  tSec: number
  path: string
}

interface ExtractFramesArgs {
  inputPath: string
  durationSec: number
  samplePeriodSec: number
  maxFrames: number
  workdir: string
}

/**
 * Pull frames from `inputPath` in a single ffmpeg invocation using
 * `fps=1/samplePeriodSec`. Batching avoids the per-spawn overhead of
 * extracting frames one-by-one with separate `-ss` calls.
 *
 * Frames are written as `frame-00001.png`, `frame-00002.png`, … and
 * mapped back to source timestamps by `(frameOrdinal - 1) *
 * samplePeriodSec`.
 */
async function extractFrames(args: ExtractFramesArgs): Promise<ExtractedFrame[]> {
  const desiredCount = Math.max(1, Math.ceil(args.durationSec / args.samplePeriodSec))
  const willTruncate = desiredCount > args.maxFrames
  if (willTruncate) {
    logEvent("ocr_detect.frame_count_capped", {
      desired: desiredCount,
      capped: args.maxFrames,
    })
  }
  const fps = 1 / args.samplePeriodSec
  await runFfmpeg([
    "-y",
    "-i",
    args.inputPath,
    "-vf",
    `fps=${fps.toString()},scale=${FRAME_SCALE_WIDTH.toString()}:-2`,
    "-frames:v",
    Math.min(desiredCount, args.maxFrames).toString(),
    "-q:v",
    "3",
    join(args.workdir, "frame-%05d.png"),
  ])
  const entries = await readdir(args.workdir)
  const sorted = entries.filter((name) => name.startsWith("frame-") && name.endsWith(".png")).sort()
  const frames: ExtractedFrame[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const name = sorted[i]
    if (name === undefined) continue
    frames.push({
      tSec: i * args.samplePeriodSec,
      path: join(args.workdir, name),
    })
  }
  return frames
}

/**
 * Wrap recognize() with a try/catch that logs the per-frame failure
 * and returns null. Lives in its own helper so the parent function
 * can keep `result` const-typed (Awaited<recognize>) without the
 * implicit-any that a `let result; try { result = ... }` would
 * produce.
 */
async function recognizeSafe(
  service: PaddleOcrService,
  arrayBuf: ArrayBuffer,
  tSec: number,
): Promise<Awaited<ReturnType<PaddleOcrService["recognize"]>> | null> {
  try {
    return await service.recognize(arrayBuf)
  } catch (err) {
    logEvent("ocr_detect.frame_failed", {
      tSec,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function ocrFrame(
  service: PaddleOcrService,
  frame: ExtractedFrame,
): Promise<OcrFrame | null> {
  const buf = await readFile(frame.path)
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const result = await recognizeSafe(service, arrayBuf, frame.tSec)
  if (result === null) return null
  if (!("lines" in result)) return null
  const dims = await readPngDimensions(buf)
  if (dims === null) return null
  const words: OcrWord[] = []
  for (let lineIdx = 0; lineIdx < result.lines.length; lineIdx += 1) {
    const line = result.lines[lineIdx]
    if (line === undefined) continue
    for (const item of line) {
      words.push({
        text: item.text,
        x: item.box.x,
        y: item.box.y,
        width: item.box.width,
        height: item.box.height,
        confidence: item.confidence,
        lineIndex: lineIdx,
      })
    }
  }
  return {
    tSec: frame.tSec,
    frameWidth: dims.width,
    frameHeight: dims.height,
    words,
  }
}

/**
 * Read PNG IHDR chunk to recover width/height without round-tripping
 * through a canvas. PNG format guarantees IHDR is the first chunk
 * after the 8-byte signature. We need the post-downscale dimensions
 * to normalise OCR box coordinates against later in the pipeline.
 */
function readPngDimensions(buf: Buffer): Promise<{ width: number; height: number } | null> {
  if (buf.length < 24) return Promise.resolve(null)
  // PNG signature is 8 bytes, then 4-byte IHDR length, 4-byte type,
  // then width/height as big-endian uint32s at offsets 16 and 20.
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width <= 0 || height <= 0) return Promise.resolve(null)
  return Promise.resolve({ width, height })
}
