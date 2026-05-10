/**
 * Engagement-metric display helpers used on creative cards.
 *
 * Both functions are pure (no I/O, no globals) so they can be unit-tested in
 * isolation and re-used inside the lightbox or any future surface that shows
 * the same TikTok metrics.
 */

/**
 * Humanize a non-negative integer count for compact display.
 *
 * Rules:
 *   - `count >= 1_000_000` -> "X.YM" (one decimal, trimmed if .0)
 *   - `count >= 1_000`     -> "X.YK" (one decimal, trimmed if .0)
 *   - else                 -> the integer as-is ("0", "742")
 *
 * Negative or non-finite inputs collapse to "0" — defensive against
 * malformed upstream payloads (the schema itself never produces negatives).
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0"
  if (count >= 1_000_000) return `${stripTrailingZero(count / 1_000_000)}M`
  if (count >= 1_000) return `${stripTrailingZero(count / 1_000)}K`
  return Math.floor(count).toString()
}

function stripTrailingZero(value: number): string {
  // Truncate (don't round) at one decimal so "1,999" -> "1.9K" not "2.0K";
  // keeps the displayed number from over-promising versus the source.
  const truncated = Math.floor(value * 10) / 10
  const formatted = truncated.toFixed(1)
  return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted
}

/**
 * Spanish relative-time string for a posted-at timestamp. Hand-rolled units
 * (rather than `Intl.RelativeTimeFormat`'s "short" style) because the ICU
 * output collides for months/minutes ("hace 3 m" for both) and uses single
 * letters that read poorly in a dense card row. The buckets and copy match
 * the Phase-2 spec exactly.
 *
 * Bucket thresholds (from `now`):
 *   - <60s        -> "ahora"
 *   - <60m        -> "hace Nm"
 *   - <24h        -> "hace Nh"
 *   - <7d         -> "hace Nd"
 *   - <30d        -> "hace N sem"
 *   - <365d       -> "hace N mes"
 *   - else        -> "hace N año"
 *
 * Future timestamps (clock skew or bad data) collapse to "hoy" instead of
 * leaking a negative interval into the UI.
 */
export function formatRelativeTimeEs(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) return "hoy"

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return "ahora"

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days}d`

  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `hace ${weeks} sem`
  }

  if (days < 365) {
    const months = Math.floor(days / 30)
    return `hace ${months} mes`
  }

  const years = Math.floor(days / 365)
  return `hace ${years} año`
}
