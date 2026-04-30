/**
 * Snapshot tests for the canonical transcription pipeline (§9).
 *
 * Mocks both the OpenAI SDK (audio.transcriptions.create) and `child_process.spawn`
 * so the test runs without ffmpeg/ffprobe binaries or network access.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Readable } from "node:stream"

// ─── Mock controls — mutated per test, read by mocks ─────────────────────────

interface OpenAICall {
  model: string
  response_format: string | undefined
  timestamp_granularities: string[] | undefined
}

interface SpawnCall {
  cmd: string
  args: string[]
}

interface FakeTranscriptionVerbose {
  text: string
  language: string
  duration: number
  segments?: Array<{
    id: number
    seek: number
    start: number
    end: number
    text: string
    tokens: number[]
    temperature: number
    avg_logprob: number
    compression_ratio: number
    no_speech_prob: number
  }>
}

interface FakeTranscription {
  text: string
}

interface OpenAIController {
  textResponses: FakeTranscription[]
  verboseResponses: FakeTranscriptionVerbose[]
  calls: OpenAICall[]
}

interface SpawnController {
  /** Per-cmd stdout and stderr to emit. */
  ffprobeStdout: string
  silenceStderr: string
  /** Each call to ffmpeg slice returns a buffer; rotated per call. */
  sliceStdouts: Buffer[]
  calls: SpawnCall[]
}

const openAICtl: OpenAIController = {
  textResponses: [],
  verboseResponses: [],
  calls: [],
}

const spawnCtl: SpawnController = {
  ffprobeStdout: "10\n",
  silenceStderr: "",
  sliceStdouts: [],
  calls: [],
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module("openai", () => {
  class FakeOpenAI {
    audio = {
      transcriptions: {
        create: (params: {
          model: string
          response_format?: string
          timestamp_granularities?: string[]
        }) => {
          openAICtl.calls.push({
            model: params.model,
            response_format: params.response_format,
            timestamp_granularities: params.timestamp_granularities,
          })
          if (params.response_format === "verbose_json") {
            const next = openAICtl.verboseResponses.shift()
            if (!next) throw new Error("test bug: no verbose response queued")
            return next
          }
          const text = openAICtl.textResponses.shift()
          if (!text) throw new Error("test bug: no text response queued")
          return text
        },
      },
    }
  }
  return { default: FakeOpenAI }
})

mock.module("node:child_process", () => {
  return {
    spawn: (cmd: string, args: string[]) => {
      spawnCtl.calls.push({ cmd, args })
      return makeFakeChild(cmd, args)
    },
  }
})

interface FakeChild {
  stdin: { write: (b: Buffer) => void; end: () => void }
  stdout: Readable
  stderr: Readable
  on: (event: "error" | "close", handler: (arg?: unknown) => void) => FakeChild
}

function makeFakeChild(cmd: string, args: string[]): FakeChild {
  let stdoutBuf: Buffer = Buffer.alloc(0)
  let stderrBuf: Buffer = Buffer.alloc(0)

  if (cmd === "ffprobe") {
    stdoutBuf = Buffer.from(spawnCtl.ffprobeStdout, "utf8")
  } else if (cmd === "ffmpeg") {
    // The "silencedetect" call writes to stderr; the "slice" call writes binary stdout.
    if (args.some((a) => a.includes("silencedetect"))) {
      stderrBuf = Buffer.from(spawnCtl.silenceStderr, "utf8")
    } else {
      const next = spawnCtl.sliceStdouts.shift() ?? Buffer.from("audio")
      stdoutBuf = next
    }
  }

  const stdout = Readable.from([stdoutBuf])
  const stderr = Readable.from([stderrBuf])

  let dataAttached = 0
  const closeHandlers: Array<(code: number) => void> = []

  function maybeFireClose(): void {
    // Fire only after both streams have drained. Track via 'end' events.
    if (dataAttached >= 2) {
      for (const h of closeHandlers) h(0)
    }
  }

  stdout.on("end", () => {
    dataAttached += 1
    maybeFireClose()
  })
  stderr.on("end", () => {
    dataAttached += 1
    maybeFireClose()
  })

  const child: FakeChild = {
    stdin: {
      write: () => {},
      end: () => {
        // Streams emit 'end' after data drains; close is fired then.
      },
    },
    stdout,
    stderr,
    on: (event, handler) => {
      if (event === "close") {
        closeHandlers.push(handler as (code: number) => void)
      }
      return child
    },
  }
  return child
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  openAICtl.textResponses = []
  openAICtl.verboseResponses = []
  openAICtl.calls = []
  spawnCtl.ffprobeStdout = "10\n"
  spawnCtl.silenceStderr = ""
  spawnCtl.sliceStdouts = []
  spawnCtl.calls = []
})

afterEach(() => {
  openAICtl.calls = []
  spawnCtl.calls = []
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("transcribe — text mode (gpt-4o-transcribe)", () => {
  test("returns plain transcript with srt: null", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.textResponses.push({ text: "Hola, este producto es genial." })

    const result = await transcribe({ mode: "text", audio: Buffer.from("fake") })

    expect(result.transcriptText).toBe("Hola, este producto es genial.")
    expect(result.srt).toBeNull()
    expect(result.language).toBe("es")
    expect(openAICtl.calls[0]?.model).toBe("gpt-4o-transcribe")
    expect(openAICtl.calls[0]?.response_format).toBe("json")
  })

  test("strips amara.org / 'thanks for watching' boilerplate", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.textResponses.push({
      text: "Producto excelente.\nSubtitulado por la comunidad de Amara.org\nThanks for watching",
    })

    const result = await transcribe({ mode: "text", audio: Buffer.from("fake") })

    expect(result.transcriptText).toBe("Producto excelente.")
  })
})

describe("transcribe — srt mode (whisper-1)", () => {
  test("synthesizes proper SRT with segment timestamps", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.verboseResponses.push({
      text: "Hola mundo. Compra ahora.",
      language: "es",
      duration: 5,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 1.5,
          text: "Hola mundo.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.01,
        },
        {
          id: 1,
          seek: 0,
          start: 1.5,
          end: 3.0,
          text: "Compra ahora.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.05,
        },
      ],
    })

    const result = await transcribe({ mode: "srt", audio: Buffer.from("fake") })

    expect(result.srt).not.toBeNull()
    expect(result.srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHola mundo.")
    expect(result.srt).toContain("2\n00:00:01,500 --> 00:00:03,000\nCompra ahora.")
    expect(result.transcriptText).toBe("Hola mundo. Compra ahora.")
    expect(result.language).toBe("es")
    expect(openAICtl.calls[0]?.model).toBe("whisper-1")
    expect(openAICtl.calls[0]?.response_format).toBe("verbose_json")
    expect(openAICtl.calls[0]?.timestamp_granularities).toEqual(["segment"])
  })

  test("drops segments with no_speech_prob > 0.6 (whisper-1 only)", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.verboseResponses.push({
      text: "Hola mundo. RUIDO. Compra ahora.",
      language: "es",
      duration: 5,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 1,
          text: "Hola mundo.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.05,
        },
        {
          id: 1,
          seek: 0,
          start: 1,
          end: 2,
          text: "RUIDO INAUDIBLE.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.85,
        },
        {
          id: 2,
          seek: 0,
          start: 2,
          end: 3,
          text: "Compra ahora.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.1,
        },
      ],
    })

    const result = await transcribe({ mode: "srt", audio: Buffer.from("fake") })

    expect(result.transcriptText).toBe("Hola mundo. Compra ahora.")
    expect(result.srt ?? "").not.toContain("RUIDO INAUDIBLE")
    expect(result.srt ?? "").toContain("Hola mundo.")
    expect(result.srt ?? "").toContain("Compra ahora.")
  })

  test("strips boilerplate segments and re-indexes SRT cues", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.verboseResponses.push({
      text: "Hola. Subtitulado por la comunidad de Amara.org. Compra.",
      language: "es",
      duration: 5,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 1,
          text: "Hola.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.01,
        },
        {
          id: 1,
          seek: 0,
          start: 1,
          end: 2,
          text: "Subtitulado por la comunidad de Amara.org",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.05,
        },
        {
          id: 2,
          seek: 0,
          start: 2,
          end: 3,
          text: "Compra.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.05,
        },
      ],
    })

    const result = await transcribe({ mode: "srt", audio: Buffer.from("fake") })

    expect(result.srt ?? "").not.toContain("Amara.org")
    expect(result.srt ?? "").toContain("1\n00:00:00,000 --> 00:00:01,000\nHola.")
    expect(result.srt ?? "").toContain("2\n00:00:02,000 --> 00:00:03,000\nCompra.")
  })

  test("returns empty SRT when all segments are filtered out", async () => {
    const { transcribe } = await import("../transcribe.ts")
    openAICtl.verboseResponses.push({
      text: "ruido",
      language: "es",
      duration: 1,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 1,
          text: "ruido",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.95,
        },
      ],
    })

    const result = await transcribe({ mode: "srt", audio: Buffer.from("fake") })

    expect(result.transcriptText).toBe("")
    expect(result.srt).toBe("")
  })
})

describe("transcribe — chunking (>20 min)", () => {
  test("invokes ffmpeg silence-detect when duration exceeds 20 min", async () => {
    const { transcribe } = await import("../transcribe.ts")
    spawnCtl.ffprobeStdout = "1500\n" // 25 min
    spawnCtl.silenceStderr = "[silencedetect @ 0x1] silence_end: 1100.5 | silence_duration: 0.7\n"
    // Slice calls: one per chunk. We expect 2 chunks for a 1500s file (> 1200s).
    spawnCtl.sliceStdouts = [Buffer.from("chunk1"), Buffer.from("chunk2")]

    openAICtl.verboseResponses.push({
      text: "Primera parte.",
      language: "es",
      duration: 1100,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 1,
          text: "Primera parte.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.01,
        },
      ],
    })
    openAICtl.verboseResponses.push({
      text: "Segunda parte.",
      language: "es",
      duration: 400,
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 2,
          text: "Segunda parte.",
          tokens: [],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0.01,
        },
      ],
    })

    const result = await transcribe({ mode: "srt", audio: Buffer.from("fake") })

    const cmds = spawnCtl.calls.map((c) => c.cmd)
    expect(cmds).toContain("ffprobe")
    expect(cmds).toContain("ffmpeg")
    const silenceInvoked = spawnCtl.calls.some(
      (c) => c.cmd === "ffmpeg" && c.args.some((a) => a.includes("silencedetect")),
    )
    expect(silenceInvoked).toBe(true)
    // Two transcribe calls expected — one per chunk.
    expect(openAICtl.calls.length).toBe(2)
    // Second-chunk segment timestamps offset by silence boundary 1100.5.
    expect(result.srt ?? "").toContain("00:18:20,500 --> 00:18:22,500\nSegunda parte.")
  })
})
