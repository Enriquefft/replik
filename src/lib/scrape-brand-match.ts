/**
 * Brand-match bypass for the relevance gate (Phase P2.1).
 *
 * Customer's manual FB Ad Library workflow: when an ad's advertiser
 * (page_name) IS the brand we're querying, the ad is by definition relevant
 * — no second-guessing needed. The LLM gate doesn't reliably honor that
 * (drops on-brand ads when ad_text is sparse or category cues are absent),
 * so we short-circuit pre-LLM with a deterministic match.
 *
 * Match is case- and diacritic-insensitive after stripping common corporate
 * suffixes ("Inc.", "S.A.", "Co.") and punctuation. Whole-substring containment
 * on the normalized page_name — covers "JoySpring", "JoySpring Inc.",
 * "JoySpring - Official Store", and "JoySpring (Tienda Oficial)".
 */

const BRAND_SUFFIX_TOKENS: ReadonlySet<string> = new Set([
  "inc",
  "incorporated",
  "co",
  "corp",
  "corporation",
  "company",
  "compania",
  "llc",
  "ltd",
  "ltda",
  "limited",
  "sa",
  "sas",
  "spa",
  "srl",
  "sl",
  "slu",
  "bv",
  "nv",
  "plc",
  "pty",
  "gmbh",
  "ag",
  "kg",
  "official",
  "oficial",
  "store",
  "tienda",
  "shop",
])

/**
 * Minimum length for a normalized brand key. Shorter keys ("co", "sa", "sb")
 * collide with too many real advertisers; reject them rather than partial-match
 * millions of pages.
 */
const MIN_KEY_LENGTH = 3

function stripDiacritics(s: string): string {
  // Combining-mark range U+0300–U+036F. Use the escape form so editor tools
  // that normalize source bytes don't silently mangle the literal.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
}

/**
 * Normalize a brand string for substring comparison.
 *
 * - NFD-strip diacritics
 * - lowercase
 * - replace any non-alphanumeric run with a single space
 * - drop trailing corporate-suffix tokens
 * - collapse internal whitespace
 *
 * Returns the normalized form, or `""` if nothing usable remains.
 */
export function normalizeBrandKey(raw: string): string {
  // Strip periods first so "S.A." → "sa" rather than tokenizing into ["s", "a"];
  // then collapse remaining non-alphanumeric runs into single spaces.
  const stripped = stripDiacritics(raw).toLowerCase().replace(/\./g, "")
  const tokens = stripped
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]
    if (last !== undefined && BRAND_SUFFIX_TOKENS.has(last)) {
      tokens.pop()
      continue
    }
    break
  }
  return tokens.join(" ")
}

/**
 * Build a deduped set of normalized brand keys from raw brand strings.
 * Keys shorter than `MIN_KEY_LENGTH` are dropped to avoid noise matches.
 */
export function buildBrandKeySet(
  brands: ReadonlyArray<string | null | undefined>,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const b of brands) {
    if (b === null || b === undefined) continue
    const key = normalizeBrandKey(b)
    if (key.length < MIN_KEY_LENGTH) continue
    out.add(key)
  }
  return out
}

/**
 * Match an advertiser `page_name` against the brand key set.
 *
 * Token-aligned containment: a key matches if every token of the key appears
 * as a contiguous run of whole tokens inside the normalized page_name. This
 * rejects substring false-positives like brand "Bee" matching advertiser
 * "BeeKeeper Honey", while still catching "JoySpring Inc.", "JoySpring -
 * Official Store", and "Inca Glow Perú".
 *
 * Returns the matched key (caller logs as the bypass reason), or `null` if
 * no key matched.
 */
export function matchBrandKey(
  pageName: string | null | undefined,
  keys: ReadonlySet<string>,
): string | null {
  if (pageName === null || pageName === undefined) return null
  if (keys.size === 0) return null
  const normalized = normalizeBrandKey(pageName)
  if (normalized.length === 0) return null
  const pageTokens = normalized.split(" ")
  for (const key of keys) {
    if (containsTokenRun(pageTokens, key.split(" "))) return key
  }
  return null
}

function containsTokenRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false
  if (needle.length > haystack.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}
