/**
 * Static advertiser blocklist for the scrape pipeline.
 *
 * Mass-spender pages whose creatives consistently surface for unrelated
 * Spanish-language keyword searches on Meta Ad Library / Apify (DramaBox
 * tagging "regalo" or "amor", marketplace ads tagging every category, etc).
 * Filtered out before the LLM relevance gate to spare a Sonnet call on
 * obvious noise.
 *
 * Match is case-insensitive and structurally exact on the entire `page_name`
 * — short fragment matching ("Box", "Short") would false-positive legitimate
 * brand names.
 */

const BLOCKED_PAGE_NAMES: ReadonlySet<string> = new Set([
  "DramaBox",
  "ReelShort",
  "GoodShort",
  "ShortMax",
  "MoboReels",
  "Temu",
  "Shein",
  "AliExpress",
])

const NORMALIZED_BLOCKLIST: ReadonlySet<string> = new Set(
  Array.from(BLOCKED_PAGE_NAMES, (name) => name.toLowerCase()),
)

export function isBlocked(pageName: string | undefined): boolean {
  if (pageName === undefined) return false
  return NORMALIZED_BLOCKLIST.has(pageName.trim().toLowerCase())
}
