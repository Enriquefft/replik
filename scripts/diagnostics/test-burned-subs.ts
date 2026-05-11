/**
 * Manual end-to-end test for the burned-subs detection + masking pipeline.
 *
 * Usage:
 *   bun --preload ./scripts/_preload.ts scripts/diagnostics/test-burned-subs.ts <video.mp4> [...]
 *
 * For each input video:
 *   1. probeDimensions
 *   2. detectBurnedSubs (Claude Haiku 4.5 vision)
 *   3. burnSubs with a stub Spanish SRT — applies the mask (when detected)
 *      + viral-styled single band so the visual outcome can be eyeballed in
 *      <input>.replik.mp4 next to the source.
 */

import { writeFile } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"

import { burnSubs } from "@/lib/video/burnSubs.ts"
import { detectBurnedSubs } from "@/lib/video/detect-burned-subs.ts"
import { probeDimensions } from "@/lib/video/probe-dimensions.ts"

const FAKE_CUES = [
  { i: 1, start: 0, end: 1500, text: "ESTE PRODUCTO ES INCREÍBLE" },
  { i: 2, start: 1500, end: 3000, text: "MIRA CÓMO FUNCIONA AHORA" },
  { i: 3, start: 3000, end: 4500, text: "ENVÍO GRATIS A TODO LIMA" },
  { i: 4, start: 4500, end: 6000, text: "OFERTA POR TIEMPO LIMITADO" },
  { i: 5, start: 6000, end: 7500, text: "PIDE EL TUYO HOY MISMO" },
] as const

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const millis = ms % 1000
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`
}

function buildSrt(): string {
  return FAKE_CUES.map(
    (c) => `${c.i.toString()}\n${fmtMs(c.start)} --> ${fmtMs(c.end)}\n${c.text}\n`,
  ).join("\n")
}

async function runOne(inputPath: string): Promise<void> {
  console.log(`\n===== ${basename(inputPath)} =====`)

  const dimensions = await probeDimensions(inputPath)
  console.log(
    `probe: ${dimensions.width.toString()}x${dimensions.height.toString()} dur=${dimensions.durationSec.toFixed(2)}s`,
  )

  const verdict = await detectBurnedSubs({
    inputPath,
    durationSec: dimensions.durationSec,
  })
  console.log(
    `detect: ${verdict.bands.length.toString()} band(s)${verdict.passThrough === true ? " [passThrough]" : ""}`,
  )
  for (const b of verdict.bands) {
    const left = b.leftFraction !== undefined ? b.leftFraction.toFixed(3) : "0.000"
    const width = b.widthFraction !== undefined ? b.widthFraction.toFixed(3) : "1.000"
    const t0 = b.activeStartSec !== undefined ? b.activeStartSec.toFixed(2) : "0.00"
    const t1 = b.activeEndSec !== undefined ? b.activeEndSec.toFixed(2) : "all"
    console.log(
      `  band: kind=${b.kind ?? "?"} top=${b.topFraction.toFixed(3)} h=${b.heightFraction.toFixed(3)} x=${left} w=${width} t=[${t0},${t1}] conf=${b.confidence.toFixed(2)}`,
    )
  }

  const mask = verdict.bands.length > 0 ? { bands: verdict.bands } : null

  const { buffer } = await burnSubs({
    inputPath,
    srt: buildSrt(),
    dimensions: { width: dimensions.width, height: dimensions.height },
    ...(mask !== null ? { mask } : {}),
  })

  const ext = extname(inputPath) || ".mp4"
  const outPath = join(dirname(inputPath), `${basename(inputPath, ext)}.replik${ext}`)
  await writeFile(outPath, buffer)
  console.log(`burn:   ${outPath} (${buffer.byteLength.toString()} bytes)`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error("usage: test-burned-subs.ts <video.mp4> [...]")
    process.exit(1)
  }
  for (const p of args) {
    try {
      await runOne(p)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`FAILED ${p}: ${reason}`)
    }
  }
}

void main()
