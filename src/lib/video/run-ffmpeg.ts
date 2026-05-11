import "server-only"

import { spawn } from "node:child_process"
import { logger } from "@trigger.dev/sdk"

export interface RunFfmpegOptions {
  binary?: "ffmpeg" | "ffprobe"
  /**
   * Receive monotonically-increasing `out_time_ms` values parsed from
   * ffmpeg's `-progress pipe:2` stream. Caller is responsible for adding
   * `-progress pipe:2 -nostats` to `args` when this is set.
   */
  onProgressMs?: (outTimeMs: number) => void
  /**
   * When true, captures stdout into the returned buffer. Defaults to false
   * (stdout is discarded; ffmpeg writes to its own output path).
   */
  captureStdout?: boolean
}

export interface RunFfmpegResult {
  stdout: Buffer
  stderr: string
}

const PROGRESS_RE = /out_time_ms=(\d+)/

/**
 * Spawn ffmpeg/ffprobe with no stdin. Captures stderr, optionally captures
 * stdout, optionally streams `out_time_ms` progress markers. Throws when the
 * process exits non-zero — the error message includes the last 2 KB of
 * stderr so call sites get actionable failure context.
 *
 * Binary path resolution: respects `FFMPEG_PATH` / `FFPROBE_PATH` env vars
 * for local dev, falls back to PATH lookup otherwise. Trigger.dev workers
 * install both via the `ffmpeg()` build extension.
 */
export function runFfmpeg(
  args: readonly string[],
  options: RunFfmpegOptions = {},
): Promise<RunFfmpegResult> {
  return new Promise((resolve, reject) => {
    const binary = options.binary ?? "ffmpeg"
    const path = resolveBinaryPath(binary)
    const captureStdout = options.captureStdout === true
    const child = spawn(path, [...args], {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ""

    if (captureStdout && child.stdout !== null) {
      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    }

    if (child.stderr !== null) {
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk
        if (options.onProgressMs !== undefined) {
          const match = PROGRESS_RE.exec(chunk)
          if (match?.[1]) {
            const ms = Number.parseInt(match[1], 10)
            if (Number.isFinite(ms)) options.onProgressMs(ms)
          }
        }
      })
    }

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr })
        return
      }
      reject(
        new Error(`${binary} exited with code ${(code ?? -1).toString()}: ${stderr.slice(-2000)}`),
      )
    })
  })
}

function resolveBinaryPath(binary: "ffmpeg" | "ffprobe"): string {
  if (binary === "ffprobe") return process.env.FFPROBE_PATH ?? "ffprobe"
  return process.env.FFMPEG_PATH ?? "ffmpeg"
}

/**
 * Default progress handler — emits a `burn_progress` log line with
 * `outTimeMs`. Lifted out of `burnSubs` so other long-running ffmpeg jobs
 * can opt in without re-implementing the formatter.
 */
export function logProgressMs(event: string): (outTimeMs: number) => void {
  return (outTimeMs) => {
    logger.info(event, { outTimeMs })
  }
}
