import "server-only"

import { spawn } from "node:child_process"
import OpenAI from "openai"
import { z } from "zod"

import { MODELS } from "@/lib/ai/models.ts"
import { type TranscribeResult, TranscribeResultSchema } from "@/lib/ai/schemas.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"

/**
 * Whisper / transcription pipeline (§9).
 *
 * Single canonical entrypoint. Discriminated by `mode`:
 *   - "text": scrape pass, model `gpt-4o-transcribe`. No timestamps.
 *   - "srt":  subtitle pass, model `whisper-1`, `verbose_json` with
 *             segment timestamps. Used by translateAndBurnSubs.
 *
 * Pipeline:
 *   1. ffprobe   → duration
 *   2. ffmpeg    → 16 kHz mono Opus extraction; >20 min auto-chunked at
 *                  silence boundaries (§9 step 2).
 *   3. OpenAI    → transcription per chunk. Segment timestamps offset by
 *                  chunk start so the synthesized SRT is monotonic.
 *   4. Filter    → drop segments with `no_speech_prob > 0.6` (whisper-1
 *                  only — gpt-4o-transcribe does not return that field).
 *   5. Boilerplate strip — Amara / "Thanks for watching" lines.
 *   6. SRT synth (deterministic, 1-indexed, HH:MM:SS,mmm, LF).
 *
 * Trigger.dev images already ship `ffmpeg`/`ffprobe` via the `ffmpeg()`
 * build extension (see trigger.config.ts). Local dev requires the
 * binaries on PATH.
 */

// ─── Input schema ────────────────────────────────────────────────────────────

export const TranscribeInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("text"),
    audio: z.instanceof(Buffer),
    language: z.string().optional(),
  }),
  z.object({
    mode: z.literal("srt"),
    audio: z.instanceof(Buffer),
    language: z.string().optional(),
  }),
])

export type TranscribeInput = z.infer<typeof TranscribeInputSchema>

// ─── Constants (§9) ──────────────────────────────────────────────────────────

const CHUNK_THRESHOLD_SECONDS = 20 * 60 // 20 min — §9 step 2
const NO_SPEECH_PROB_DROP = 0.6 // §9 step 4

/**
 * Boilerplate phrases stripped after transcription (§9 step 4).
 * Match is line-trimmed + case-insensitive `includes` against the
 * stripped form.
 */
const BOILERPLATE_NEEDLES: readonly string[] = [
  "subtítulos por la comunidad de amara.org",
  "subtitulado por la comunidad de amara.org",
  "subtítulos realizados por la comunidad de amara.org",
  "subtítulos por",
  "subtitulado por",
  "amara.org",
  "thanks for watching",
  "thank you for watching",
] as const

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Top-level transcription entrypoint.
 * Always returns a parsed `TranscribeResult`; never throws on empty audio.
 */
export async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
  const parsed = TranscribeInputSchema.parse(input)
  const language = parsed.language ?? "es"
  const startedAt = Date.now()

  const duration = await ffprobeDuration(parsed.audio)
  if (duration <= 0) {
    logEvent("ai.transcribe.summary", {
      mode: parsed.mode,
      chunks: 0,
      durationSeconds: 0,
      ms: Date.now() - startedAt,
      language,
    })
    return TranscribeResultSchema.parse({
      transcriptText: "",
      srt: parsed.mode === "srt" ? "" : null,
      language,
    })
  }
  const chunks =
    duration > CHUNK_THRESHOLD_SECONDS
      ? await chunkBySilence(parsed.audio, duration)
      : [{ audio: await sliceAudio(parsed.audio, 0, duration), offsetSeconds: 0 }]

  const segments: TranscribedSegment[] = []
  let detectedLanguage = language
  const textParts: string[] = []

  for (const chunk of chunks) {
    if (parsed.mode === "text") {
      const result = await withTiming(
        "ai.transcribe",
        () => transcribeText(chunk.audio, language),
        { mode: "text", chunkBytes: chunk.audio.byteLength },
      )
      detectedLanguage = result.language || detectedLanguage
      textParts.push(result.text)
    } else {
      const result = await withTiming("ai.transcribe", () => transcribeSrt(chunk.audio, language), {
        mode: "srt",
        chunkBytes: chunk.audio.byteLength,
      })
      detectedLanguage = result.language || detectedLanguage
      for (const seg of result.segments) {
        segments.push({
          start: seg.start + chunk.offsetSeconds,
          end: seg.end + chunk.offsetSeconds,
          text: seg.text,
          noSpeechProb: seg.noSpeechProb,
        })
      }
      textParts.push(result.text)
    }
  }

  if (parsed.mode === "text") {
    const transcriptText = stripBoilerplate(textParts.join(" ").trim())
    logEvent("ai.transcribe.summary", {
      mode: "text",
      chunks: chunks.length,
      durationSeconds: duration,
      ms: Date.now() - startedAt,
      language: detectedLanguage,
    })
    return TranscribeResultSchema.parse({
      transcriptText,
      srt: null,
      language: detectedLanguage,
    })
  }

  // ── SRT mode ──────────────────────────────────────────────────────────────
  const filtered = segments.filter((s) => s.noSpeechProb <= NO_SPEECH_PROB_DROP)
  const cleaned = filtered
    .map((s) => ({ ...s, text: stripBoilerplate(s.text) }))
    .filter((s) => s.text.trim().length > 0)

  const transcriptText = cleaned
    .map((s) => s.text.trim())
    .join(" ")
    .trim()

  logEvent("ai.transcribe.summary", {
    mode: "srt",
    chunks: chunks.length,
    durationSeconds: duration,
    segments: cleaned.length,
    ms: Date.now() - startedAt,
    language: detectedLanguage,
  })

  if (cleaned.length === 0) {
    return TranscribeResultSchema.parse({
      transcriptText: "",
      srt: "",
      language: detectedLanguage,
    })
  }

  return TranscribeResultSchema.parse({
    transcriptText,
    srt: buildSrt(cleaned),
    language: detectedLanguage,
  })
}

// ─── OpenAI client ───────────────────────────────────────────────────────────

let cachedClient: OpenAI | undefined

function client(): OpenAI {
  cachedClient ??= new OpenAI()
  return cachedClient
}

interface TranscribedSegment {
  start: number
  end: number
  text: string
  noSpeechProb: number
}

interface TextResult {
  text: string
  language: string
}

interface SrtResult {
  text: string
  language: string
  segments: TranscribedSegment[]
}

async function transcribeText(audio: Buffer, language: string): Promise<TextResult> {
  // gpt-4o-transcribe does not return verbose_json — it returns plain JSON
  // with `text`. Language detection is implicit; we echo the input locale.
  const file = bufferToFile(audio, "audio.ogg", "audio/ogg")
  const response = await client().audio.transcriptions.create({
    file,
    model: MODELS.WHISPER_TEXT,
    language,
    response_format: "json",
  })
  return { text: response.text, language }
}

async function transcribeSrt(audio: Buffer, language: string): Promise<SrtResult> {
  const file = bufferToFile(audio, "audio.ogg", "audio/ogg")
  const verbose = await client().audio.transcriptions.create({
    file,
    model: MODELS.WHISPER_SRT,
    language,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  })
  const segments: TranscribedSegment[] = []
  for (const seg of verbose.segments ?? []) {
    segments.push({
      start: seg.start,
      end: seg.end,
      text: seg.text,
      noSpeechProb: seg.no_speech_prob,
    })
  }
  return {
    text: verbose.text,
    language: verbose.language || language,
    segments,
  }
}

function bufferToFile(buffer: Buffer, name: string, mime: string): File {
  return new File([new Uint8Array(buffer)], name, { type: mime })
}

// ─── Boilerplate strip (§9 step 4) ───────────────────────────────────────────

function stripBoilerplate(text: string): string {
  const lines = text.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (isBoilerplate(trimmed)) continue
    kept.push(trimmed)
  }
  return kept.join("\n").trim()
}

function isBoilerplate(line: string): boolean {
  const lower = line.toLowerCase()
  for (const needle of BOILERPLATE_NEEDLES) {
    if (lower.includes(needle)) return true
  }
  return false
}

// ─── ffprobe / ffmpeg shell-outs ─────────────────────────────────────────────

/**
 * Run ffprobe against a buffer (stdin) and return duration in seconds.
 * Falls back to `0` on parse failure — the chunker treats that as "no
 * chunking required" which preserves the single-call code path.
 */
export async function ffprobeDuration(audio: Buffer): Promise<number> {
  const { stdout } = await runBinary(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "-i",
      "pipe:0",
    ],
    audio,
  )
  const stdoutText = typeof stdout === "string" ? stdout : stdout.toString("utf8")
  const value = Number.parseFloat(stdoutText.trim())
  return Number.isFinite(value) && value >= 0 ? value : 0
}

interface AudioChunk {
  audio: Buffer
  offsetSeconds: number
}

/**
 * Split `audio` at silence boundaries detected by ffmpeg's `silencedetect`
 * filter. Returns one `AudioChunk` per slice, each ≤ CHUNK_THRESHOLD_SECONDS
 * long. Slice boundaries snap to detected silences; if no silences are
 * found, splits at every CHUNK_THRESHOLD_SECONDS exactly.
 */
async function chunkBySilence(audio: Buffer, duration: number): Promise<AudioChunk[]> {
  const silences = await detectSilences(audio)
  const boundaries: number[] = [0]
  let cursor = 0
  while (cursor + CHUNK_THRESHOLD_SECONDS < duration) {
    const target = cursor + CHUNK_THRESHOLD_SECONDS
    const candidate = nearestSilenceBefore(silences, target, cursor)
    const next = candidate ?? target
    boundaries.push(next)
    cursor = next
  }
  boundaries.push(duration)

  const chunks: AudioChunk[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]
    const end = boundaries[i + 1]
    if (start === undefined || end === undefined || end <= start) continue
    const sliced = await sliceAudio(audio, start, end - start)
    chunks.push({ audio: sliced, offsetSeconds: start })
  }
  return chunks
}

function nearestSilenceBefore(
  silences: number[],
  target: number,
  floor: number,
): number | undefined {
  let best: number | undefined
  for (const s of silences) {
    if (s <= floor) continue
    if (s > target) break
    best = s
  }
  return best
}

/**
 * Parse `silence_end` markers from `ffmpeg -af silencedetect`.
 * Stderr lines: `[silencedetect @ ...] silence_end: 12.345 | silence_duration: ...`
 */
async function detectSilences(audio: Buffer): Promise<number[]> {
  const { stderr } = await runBinary(
    "ffmpeg",
    ["-i", "pipe:0", "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-"],
    audio,
  )
  const out: number[] = []
  for (const match of stderr.matchAll(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
    const captured = match[1]
    if (captured === undefined) continue
    const value = Number.parseFloat(captured)
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

/**
 * Slice `[start, start+duration)` of `audio` into a new Opus 16 kHz mono
 * buffer (§9 step 2 normalization).
 */
async function sliceAudio(audio: Buffer, start: number, duration: number): Promise<Buffer> {
  const { stdout } = await runBinary(
    "ffmpeg",
    [
      "-ss",
      start.toFixed(3),
      "-i",
      "pipe:0",
      "-t",
      duration.toFixed(3),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libopus",
      "-f",
      "ogg",
      "pipe:1",
    ],
    audio,
    { binaryStdout: true },
  )
  return stdout instanceof Buffer ? stdout : Buffer.from(stdout)
}

interface RunOptions {
  binaryStdout?: boolean
}

interface RunResult {
  stdout: Buffer | string
  stderr: string
}

function runBinary(
  cmd: string,
  args: string[],
  stdin: Buffer,
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      const stdoutBuffer = Buffer.concat(stdoutChunks)
      // ffmpeg silencedetect / null output exits non-zero on EOF in some
      // builds; we still want the stderr we already captured.
      if (code !== 0 && cmd !== "ffmpeg") {
        reject(new Error(`${cmd} exited with code ${String(code)}: ${stderr}`))
        return
      }
      resolve({
        stdout: options.binaryStdout === true ? stdoutBuffer : stdoutBuffer.toString("utf8"),
        stderr,
      })
    })

    child.stdin.write(stdin)
    child.stdin.end()
  })
}

// ─── SRT synthesis (§9 step 5) ───────────────────────────────────────────────

function buildSrt(segments: TranscribedSegment[]): string {
  const lines: string[] = []
  segments.forEach((segment, index) => {
    const cueIndex = index + 1
    lines.push(
      cueIndex.toString(),
      `${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}`,
      segment.text.trim(),
      "",
    )
  })
  return lines.join("\n")
}

function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const totalMs = Math.round(clamped * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0")
}
