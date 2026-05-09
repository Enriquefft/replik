/**
 * Normalize a video URL down to a stable identity key for dedup.
 *
 * Returns the lowercased basename of the URL pathname, which on fbcdn (and
 * most CDN-served videos) is the asset hash. This identity survives:
 *   - Auth-token churn in the query string (`oh`, `oe`, `_nc_ohc`, …).
 *   - CDN shard rotation in the path (`/m69/` vs `/m366/`).
 *   - Same advertiser running the same video across multiple ad placements
 *     (each placement gets a new `ad_id` but the same uploaded asset).
 *
 * Falls back to the lowercased input string for unparseable URLs so callers
 * never throw — dedup is best-effort and a missed merge is preferable to a
 * crash in the scrape pipeline.
 */
export function normalizeVideoUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop()
    return (last ?? url).toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}
