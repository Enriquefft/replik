import "server-only"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSrt } from "@/lib/ai/srt-translate.ts"
import type { BurnedSubsBand } from "@/lib/ai/taxonomies.ts"
import { resolveFontsDir, VIRAL_FONT_NAME } from "@/lib/video/fonts.ts"
import { type MaskAction, type MaskPlan, resolveMaskPlan } from "@/lib/video/mask-strategy.ts"
import { logProgressMs, runFfmpeg } from "@/lib/video/run-ffmpeg.ts"

export interface VideoDimensionsInput {
  width: number
  height: number
}

export interface BurnSubsMask {
  /** Bands of the source frame to blur or drawbox over. */
  bands: readonly BurnedSubsBand[]
}

export interface BurnSubsInput {
  /** Absolute path to the source video already downloaded locally. */
  inputPath: string
  srt: string
  /** Source frame dimensions from ffprobe — informs the blur sigma. */
  dimensions: VideoDimensionsInput
  /** Empty bands array is equivalent to omitting `mask`. */
  mask?: BurnSubsMask
}

export interface BurnSubsResult {
  buffer: Buffer
  mime: "video/mp4"
}

/**
 * Output canvas — every burn renders to a 1080×1920 9:16 frame so downstream
 * platforms (TikTok, Instagram Reels, Facebook Reels, YouTube Shorts) all
 * see a native vertical ad with no transcoding penalty.
 */
const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920

/**
 * Caption styling — fractions of the OUTPUT canvas dimensions. These
 * are stamped directly into the .ass `[V4+ Styles]` block (NOT into
 * libavfilter's `subtitles=force_style`) so libass renders against
 * `PlayResX/Y = 1080×1920`, not its default 288×288. The previous
 * implementation used `subtitles=...:original_size=` which only
 * affects libavfilter's output sizing, not libass's coordinate space —
 * that mismatch is why FontSize=134 rendered ~7× too big and
 * MarginV=307 landed off-canvas.
 */
const FONT_SIZE_FRACTION = 0.07
const MARGIN_V_FRACTION = 0.16
const OUTLINE_FRACTION = 0.13
const BLUR_SIGMA_FRACTION = 0.025

const MIN_FONT_SIZE = 32
const MIN_OUTLINE = 3
const MIN_MARGIN_V = 60
const MIN_BLUR_SIGMA = 6

function resolveFontSize(): number {
  return Math.max(MIN_FONT_SIZE, Math.round(OUTPUT_HEIGHT * FONT_SIZE_FRACTION))
}

/**
 * When the mask plan resolves to exactly one band whose center sits
 * in the lower portion of the frame (between these fractions), the
 * caption is re-anchored to land INSIDE that band — collapsing the
 * "blurred strip + caption strip" two-rectangle look into one. Above
 * the upper bound we keep the default bottom anchor (the band is a
 * hook overlay; forcing the caption into the top reads worse than
 * the default).
 */
const ANCHOR_BAND_CENTER_MIN_FRACTION = 0.4
const ANCHOR_BAND_CENTER_MAX_FRACTION = 0.95

/**
 * Lane L3b — burn translated SRT into a single-band, viral-tuned overlay.
 *
 * Pipeline (assembled into one `-filter_complex` graph):
 *   MASK      → time-gated boxblur or drawbox over each detected
 *               band, in SOURCE-FRAME coords. No crop — masks are
 *               only active during the band's `activeStartSec..End`
 *               window, so cropping (permanent) wouldn't preserve
 *               the original frame outside the band's time window.
 *   NORMALIZE → scale+pad to 1080×1920 9:16, always centered.
 *   STYLE     → libass `subtitles=` against an emitted .ass file
 *               whose [Script Info] declares PlayResX=1080,
 *               PlayResY=1920 so font/outline/marginV land in the
 *               correct pixel space.
 *   AUDIO     → `loudnorm=I=-16:TP=-1.5:LRA=11` to TikTok target.
 */
export async function burnSubs(input: BurnSubsInput): Promise<BurnSubsResult> {
  const workdir = await mkdtemp(join(tmpdir(), "replik-burn-"))
  const assPath = join(workdir, "input.ass")
  const outputPath = join(workdir, "output.mp4")

  try {
    const marginVOverridePx = resolveMarginVOverridePx(input.mask?.bands ?? [], resolveFontSize())
    await writeFile(
      assPath,
      srtToAss(input.srt, marginVOverridePx === null ? {} : { marginVOverridePx }),
      "utf8",
    )

    const filter = buildFilterChain({
      assPath,
      bands: input.mask?.bands ?? [],
      dimensions: input.dimensions,
      fontsDir: resolveFontsDir(),
    })

    const args = [
      "-y",
      "-progress",
      "pipe:2",
      "-nostats",
      "-i",
      input.inputPath,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-crf",
      "23",
      "-preset",
      "medium",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath,
    ]

    await runFfmpeg(args, { onProgressMs: logProgressMs("burn_progress") })

    const buffer = await readFile(outputPath)
    return { buffer, mime: "video/mp4" }
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

interface BuildFilterChainInput {
  assPath: string
  bands: readonly BurnedSubsBand[]
  dimensions: VideoDimensionsInput
  fontsDir: string
}

/**
 * Pure helper exported for snapshot tests — assembles the `-filter_complex`
 * graph from the inputs without spawning ffmpeg. Output graph terminates at
 * labels `[v]` (video) and `[a]` (audio), which the caller `-map`s.
 */
export function buildFilterChain(input: BuildFilterChainInput): string {
  const plan = resolveMaskPlan(input.bands)
  const videoChain: string[] = []
  let label = "0:v"

  const sigma = blurSigma(input.dimensions)
  label = appendMaskStages(videoChain, label, plan, sigma)

  videoChain.push(`[${label}]${normalizeFilter()}[norm]`)
  videoChain.push(`[norm]${subtitlesFilter(input.assPath, input.fontsDir)}[v]`)

  const audioChain = `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]`

  return [...videoChain, audioChain].join(";")
}

/**
 * Emit one mask stage per band action. Blur uses split/crop/gblur/
 * overlay because gblur applied to the full frame would blur
 * everything; the split lets us blur the band crop only and overlay
 * back. gblur is used over boxblur because boxblur caps chroma radius
 * at 8 (breaks on tall portrait sources at sigma≥9). Drawbox is
 * single-shot — no overlay needed because the opaque box covers the
 * underlying pixels directly. Both filters accept an `enable=` clause
 * so they only apply during the band's active window.
 */
function appendMaskStages(chain: string[], inLabel: string, plan: MaskPlan, sigma: number): string {
  let label = inLabel
  for (let i = 0; i < plan.actions.length; i += 1) {
    const action = plan.actions[i]
    if (action === undefined) continue
    const enableClause = enableClauseFor(action)
    if (action.kind === "blur") {
      label = appendBlurStage(chain, label, action, sigma, i, enableClause)
    } else {
      label = appendBlackBoxStage(chain, label, action, i, enableClause)
    }
  }
  return label
}

function appendBlurStage(
  chain: string[],
  inLabel: string,
  action: MaskAction,
  sigma: number,
  index: number,
  enableClause: string,
): string {
  const bgLabel = `bg${index.toString()}`
  const srcLabel = `src${index.toString()}`
  const blurLabel = `blur${index.toString()}`
  const stageLabel = `stage${index.toString()}`
  const cropX = `iw*${formatFraction(action.leftFraction)}`
  const cropY = `ih*${formatFraction(action.topFraction)}`
  const cropW = `iw*${formatFraction(action.widthFraction)}`
  const cropH = `ih*${formatFraction(action.heightFraction)}`
  const overlayX = `W*${formatFraction(action.leftFraction)}`
  const overlayY = `H*${formatFraction(action.topFraction)}`
  chain.push(`[${inLabel}]split=2[${bgLabel}][${srcLabel}]`)
  chain.push(
    `[${srcLabel}]crop=${cropW}:${cropH}:${cropX}:${cropY},gblur=sigma=${sigma.toString()}[${blurLabel}]`,
  )
  chain.push(
    `[${bgLabel}][${blurLabel}]overlay=${overlayX}:${overlayY}${enableClause}[${stageLabel}]`,
  )
  return stageLabel
}

function appendBlackBoxStage(
  chain: string[],
  inLabel: string,
  action: MaskAction,
  index: number,
  enableClause: string,
): string {
  const stageLabel = `box${index.toString()}`
  const drawX = `iw*${formatFraction(action.leftFraction)}`
  const drawY = `ih*${formatFraction(action.topFraction)}`
  const drawW = `iw*${formatFraction(action.widthFraction)}`
  const drawH = `ih*${formatFraction(action.heightFraction)}`
  chain.push(
    `[${inLabel}]drawbox=x=${drawX}:y=${drawY}:w=${drawW}:h=${drawH}:color=black:t=fill${enableClause}[${stageLabel}]`,
  )
  return stageLabel
}

function enableClauseFor(action: MaskAction): string {
  if (action.activeStartSec === null || action.activeEndSec === null) return ""
  if (action.activeEndSec <= action.activeStartSec) return ""
  return `:enable='between(t,${action.activeStartSec.toFixed(3)},${action.activeEndSec.toFixed(3)})'`
}

/**
 * Scale-then-pad to 1080×1920 with a centered letterbox. Always
 * centered now that the mask pipeline doesn't crop the source frame.
 */
function normalizeFilter(): string {
  const scale = `scale=w='if(gt(a,${OUTPUT_WIDTH.toString()}/${OUTPUT_HEIGHT.toString()}),${OUTPUT_WIDTH.toString()},-2)':h='if(gt(a,${OUTPUT_WIDTH.toString()}/${OUTPUT_HEIGHT.toString()}),-2,${OUTPUT_HEIGHT.toString()})':flags=lanczos`
  const padX = `(${OUTPUT_WIDTH.toString()}-iw)/2`
  const padY = `(${OUTPUT_HEIGHT.toString()}-ih)/2`
  const pad = `pad=${OUTPUT_WIDTH.toString()}:${OUTPUT_HEIGHT.toString()}:${padX}:${padY}:black`
  return `${scale},${pad},setsar=1`
}

function subtitlesFilter(assPath: string, fontsDir: string): string {
  return `subtitles=${escapeFilterArg(assPath)}:fontsdir=${escapeFilterArg(fontsDir)}`
}

function blurSigma(dimensions: VideoDimensionsInput): number {
  const minDim = Math.min(dimensions.width, dimensions.height)
  return Math.max(MIN_BLUR_SIGMA, Math.round(minDim * BLUR_SIGMA_FRACTION))
}

/**
 * Decide whether the caption should be re-anchored to land inside a
 * masked band, and if so return the pixel-space `MarginV` value.
 * Returns `null` for the default bottom anchor.
 *
 * Conditions:
 *   - Exactly one band exists (multiple bands → ambiguous which one
 *     hosts the caption).
 *   - The band's vertical center sits in the lower 40%–95% of the
 *     frame (above 40% it's a hook overlay; below 95% there's no
 *     room for the caption baseline above the bottom edge).
 *
 * Anchoring rule: align the caption's TOP edge with the band's TOP
 * edge under the 2-line common case. ASS `Alignment=2` (bottom-center)
 * anchors `MarginV` to the bottom of the BOTTOM line and the caption
 * extends UPWARD from there, so we offset by `2 × fontSize` to land
 * a 2-line block with its top at the band top. A 1-line cue then
 * sits ~1 line below the band top (still inside the band), and a
 * 3-line cue ascends ~1 line above the band top — both are graceful
 * degradations. The defensive clamp in `srtToAss` floors at
 * `MIN_MARGIN_V` so very low bands still leave room below the
 * caption.
 *
 * Assumption: bands are in source-frame fractional coords and the
 * source is approximately 9:16, so source-fraction maps 1:1 onto the
 * 1920px output canvas. Non-9:16 sources letterbox in
 * `normalizeFilter`; the band positions on the OUTPUT canvas drift
 * from the source-fraction by the letterbox amount. The dominant
 * TikTok/Reels/Shorts case is 9:16 and the existing pipeline already
 * feeds source-fraction coords into the mask filter the same way.
 *
 * Exported for unit testing.
 */
export function resolveMarginVOverridePx(
  bands: readonly BurnedSubsBand[],
  fontSize: number,
): number | null {
  if (bands.length !== 1) return null
  const band = bands[0]
  if (band === undefined) return null
  const center = band.topFraction + band.heightFraction / 2
  if (center < ANCHOR_BAND_CENTER_MIN_FRACTION) return null
  if (center > ANCHOR_BAND_CENTER_MAX_FRACTION) return null
  const bandTopPx = Math.round(OUTPUT_HEIGHT * band.topFraction)
  return OUTPUT_HEIGHT - bandTopPx - 2 * fontSize
}

function formatFraction(n: number): string {
  return n.toFixed(4)
}

/**
 * Escape an absolute path for a `subtitles=` / `fontsdir=` filter argument.
 * libavfilter parses on `:` and `,`; on POSIX paths the colon never appears
 * in real paths, but commas in directory names would corrupt the graph.
 */
function escapeFilterArg(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,")
}

/**
 * Convert SRT to a self-contained ASS script with PlayResX=1080,
 * PlayResY=1920 so libass renders the viral preset's pixel-space
 * style at the correct scale. Exported for unit tests.
 *
 * Style values mirror the prior `force_style` block; the difference
 * is where they live — embedded in the .ass `[V4+ Styles]` block,
 * which libass anchors to PlayRes, instead of `force_style=` which
 * libavfilter applies after libass has already laid out at the
 * default 288×288 PlayRes.
 */
export interface SrtToAssOptions {
  /**
   * Pixel-space override for the ASS `MarginV` field. When supplied,
   * the caption is anchored so its baseline sits at this distance
   * from the bottom of the 1080×1920 output canvas instead of the
   * default `MARGIN_V_FRACTION`-derived value. Caller is responsible
   * for clamping; we still floor to `MIN_MARGIN_V` defensively.
   */
  marginVOverridePx?: number
}

export function srtToAss(srt: string, options: SrtToAssOptions = {}): string {
  const cues = parseSrt(srt)
  const fontSize = resolveFontSize()
  const outline = Math.max(MIN_OUTLINE, Math.round(fontSize * OUTLINE_FRACTION))
  const defaultMarginV = Math.round(OUTPUT_HEIGHT * MARGIN_V_FRACTION)
  const marginVCandidate = options.marginVOverridePx ?? defaultMarginV
  const marginV = Math.max(MIN_MARGIN_V, Math.min(OUTPUT_HEIGHT - fontSize, marginVCandidate))
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUTPUT_WIDTH.toString()}`,
    `PlayResY: ${OUTPUT_HEIGHT.toString()}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${VIRAL_FONT_NAME},${fontSize.toString()},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${outline.toString()},0,2,40,40,${marginV.toString()},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n")
  const events = cues.map(cueToEvent).join("\n")
  return `${header}\n${events}\n`
}

function cueToEvent(cue: { startMs: number; endMs: number; text: string }): string {
  const start = formatAssTime(cue.startMs)
  const end = formatAssTime(cue.endMs)
  const text = cue.text.replace(/\r/g, "").replace(/\n/g, "\\N")
  return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`
}

function formatAssTime(ms: number): string {
  const totalCs = Math.round(ms / 10)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hr = Math.floor(totalMin / 60)
  return `${hr.toString()}:${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`
}
