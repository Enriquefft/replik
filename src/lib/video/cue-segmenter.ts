import type { Cue } from "@/lib/ai/schemas.ts"

export interface ReSegmentOptions {
  /** Maximum words allowed per output cue. Defaults to 4 (viral-style). */
  maxWords?: number
  /** Uppercase the output text. Defaults to true. */
  uppercase?: boolean
}

const DEFAULT_MAX_WORDS = 4

/**
 * Re-segment SRT cues for viral, single-band burn-in.
 *
 * Splits each input cue into one or more output cues so no cue exceeds
 * `maxWords` words (default 4). Output timings are split proportionally to
 * the character count of each word group so reading speed stays roughly
 * uniform. Indices are renumbered 1..N across the whole result.
 *
 * Pure — no I/O. Words are token-split on whitespace. Newlines inside an
 * input cue are normalised to a single space because the burn step now uses
 * a single-band layout (the `\n` rule from §10 only matters when ≤2 lines
 * per cue is rendered).
 */
export function reSegmentCues(cues: readonly Cue[], options: ReSegmentOptions = {}): Cue[] {
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS
  if (maxWords < 1) {
    throw new Error(`reSegmentCues: maxWords must be >= 1, got ${maxWords.toString()}`)
  }
  const uppercase = options.uppercase ?? true

  const out: Cue[] = []
  let nextIndex = 1
  for (const cue of cues) {
    const words = cue.text
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 0)
    if (words.length === 0) continue

    const groups = chunkWords(words, maxWords)
    const totalChars = groups.reduce((acc, g) => acc + groupChars(g), 0)
    if (totalChars === 0) continue

    const totalDuration = cue.endMs - cue.startMs
    let cursorMs = cue.startMs

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]
      if (group === undefined) continue
      const isLast = i === groups.length - 1
      const groupDuration = isLast
        ? cue.endMs - cursorMs
        : Math.round((groupChars(group) / totalChars) * totalDuration)
      const startMs = cursorMs
      const endMs = isLast ? cue.endMs : Math.max(startMs + 1, cursorMs + groupDuration)
      cursorMs = endMs

      const text = group.join(" ")
      out.push({
        index: nextIndex,
        startMs,
        endMs,
        text: uppercase ? text.toUpperCase() : text,
      })
      nextIndex += 1
    }
  }
  return out
}

function chunkWords(words: readonly string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size))
  }
  return chunks
}

function groupChars(group: readonly string[]): number {
  return group.reduce((acc, w) => acc + w.length, 0) + Math.max(0, group.length - 1)
}
