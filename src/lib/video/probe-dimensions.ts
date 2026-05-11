import "server-only"

import { z } from "zod"
import { runFfmpeg } from "@/lib/video/run-ffmpeg.ts"

export const VideoDimensionsSchema = z.object({
  width: z.int().positive(),
  height: z.int().positive(),
  durationSec: z.number().nonnegative(),
})

export type VideoDimensions = z.infer<typeof VideoDimensionsSchema>

const FFPROBE_OUTPUT_SHAPE = z.object({
  streams: z
    .array(
      z.object({
        width: z.int().positive(),
        height: z.int().positive(),
      }),
    )
    .min(1),
  format: z.object({
    duration: z.string().optional(),
  }),
})

/**
 * Run `ffprobe` against an absolute file path and return the first video
 * stream's `{ width, height, durationSec }`. Throws when the binary errors,
 * the output is unparseable, or no video stream is present.
 *
 * `durationSec` falls back to 0 when `format.duration` is absent (some
 * containers don't expose it). Callers that depend on a positive duration
 * should validate post-call.
 */
export async function probeDimensions(inputPath: string): Promise<VideoDimensions> {
  const { stdout } = await runFfmpeg(
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      inputPath,
    ],
    { binary: "ffprobe", captureStdout: true },
  )

  const parsed = FFPROBE_OUTPUT_SHAPE.parse(JSON.parse(stdout.toString("utf8")))
  const stream = parsed.streams[0]
  if (stream === undefined) {
    throw new Error(`probeDimensions: no video stream in ${inputPath}`)
  }
  const durationSec = parsed.format.duration ? Number.parseFloat(parsed.format.duration) : 0
  return VideoDimensionsSchema.parse({
    width: stream.width,
    height: stream.height,
    durationSec: Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0,
  })
}
