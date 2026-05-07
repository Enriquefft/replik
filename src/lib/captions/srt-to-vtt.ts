/**
 * Convert SubRip Subtitle (SRT) to Web Video Text Tracks (WebVTT).
 *
 * Differences handled:
 *   - VTT requires a `WEBVTT` header line.
 *   - VTT timestamp decimal separator is `.`, SRT uses `,`.
 *   - VTT cues do not require numeric ids; we strip the SRT cue numbers when
 *     they appear as the line preceding a timestamp, since some players
 *     render them as visible text.
 *
 * Whitespace and cue text are preserved verbatim. Returns a string ready to
 * be served as `text/vtt`.
 */

const TIMESTAMP_LINE = /^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/

export function srtToVtt(srt: string): string {
  const normalized = srt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimStart()
  const lines = normalized.split("\n")
  const out: string[] = ["WEBVTT", ""]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (TIMESTAMP_LINE.test(line)) {
      // Replace decimal `,` with `.` on both timestamps. SRT only uses `,`,
      // VTT only accepts `.`.
      out.push(line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"))
      continue
    }
    // Drop the SRT cue index when it precedes a timestamp (a bare integer on
    // its own line). Anything else is cue text or a blank — keep verbatim.
    if (/^\d+$/.test(line.trim()) && TIMESTAMP_LINE.test(lines[i + 1] ?? "")) {
      continue
    }
    out.push(line)
  }

  return `${out.join("\n").trimEnd()}\n`
}
