/**
 * Parse human-readable count strings ("1.2M", "500K", "1.5B", "1234")
 * into integers. Used to coerce TikTok/Apify dataset fields that may
 * arrive either as raw numbers or as compact suffix-formatted strings.
 *
 * Rules:
 *   - Trim whitespace.
 *   - Suffix is case-insensitive: K = 1e3, M = 1e6, B = 1e9.
 *   - Bare numerics ("1234", "1234.5") are accepted.
 *   - Result is floored to an integer.
 *   - Throws `Error` on any unparseable input — callers handle inside Zod.
 */

const SUFFIX_MULTIPLIERS = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
} as const

const HUMAN_INT_RE = /^(\d+(?:\.\d+)?)([kmb])?$/

export function parseHumanInt(s: string): number {
  const trimmed = s.trim().toLowerCase()
  if (trimmed.length === 0) {
    throw new Error(`parseHumanInt: empty input`)
  }
  const match = HUMAN_INT_RE.exec(trimmed)
  if (!match) {
    throw new Error(`parseHumanInt: unparseable input "${s}"`)
  }
  const numericPart = match[1]
  const suffix = match[2]
  if (numericPart === undefined) {
    throw new Error(`parseHumanInt: unparseable input "${s}"`)
  }
  const base = Number.parseFloat(numericPart)
  if (!Number.isFinite(base)) {
    throw new Error(`parseHumanInt: non-finite numeric in "${s}"`)
  }
  if (suffix === undefined) {
    return Math.floor(base)
  }
  if (suffix === "k" || suffix === "m" || suffix === "b") {
    return Math.floor(base * SUFFIX_MULTIPLIERS[suffix])
  }
  throw new Error(`parseHumanInt: unsupported suffix in "${s}"`)
}
