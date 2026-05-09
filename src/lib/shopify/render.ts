import "server-only"

/**
 * Vars consumed by the 3 landing templates. All values are stringified at
 * substitution time. Numeric fields are pre-formatted by the caller.
 *
 * Hero contract (Phase 2):
 *   - `hero_image_urls_csv`: comma-joined product photo URLs, ordered
 *     best-first. 1 to 3 entries — the scraper guarantees this bound on
 *     `products.imageUrls` for `READY` products. The hero template splits
 *     this CSV in Liquid: index 0 is the main image, indexes 1..2 render as
 *     thumbnails below the main.
 *   - `hero_video_url`: a single MP4 URL chosen by `pickHeroVideo` from the
 *     user's selected creatives, or the empty string when no creative is
 *     selected. The hero template renders the `<video>` tag iff non-empty.
 *
 * Both URL vars are pass-through (no HTML-escape) — escaping `&` would break
 * Liquid string literals, and the upstream values are validated URLs.
 */
export interface TemplateVars {
  title: string
  subtitle: string
  price: string
  bundle_2_price: string
  bundle_3_price: string
  /**
   * Comma-joined product image URLs, ordered best-first. 1..3 entries.
   * The hero section splits this CSV via Liquid; index 0 is the main image,
   * indexes 1..2 render as thumbnails.
   */
  hero_image_urls_csv: string
  /**
   * Single MP4 URL for the hero video tile, picked by the LLM for hero-fit.
   * Empty string when no creative is selected — the template skips rendering
   * the `<video>` tag in that case.
   */
  hero_video_url: string
  whatsapp_number: string
  pixel_id: string
  shopify_page_handle: string
  // ── Body sections (Fix 5) ────────────────────────────────────────────────
  benefit_1_title: string
  benefit_1_body: string
  benefit_2_title: string
  benefit_2_body: string
  benefit_3_title: string
  benefit_3_body: string
  faq_1_q: string
  faq_1_a: string
  faq_2_q: string
  faq_2_a: string
  faq_3_q: string
  faq_3_a: string
  objection_1_text: string
  objection_2_text: string
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/**
 * Tokens whose values come from product/AI text and may contain HTML-special
 * characters. These get HTML-escaped at substitution time so unsafe content
 * cannot break the rendered markup. Tokens NOT in this set are pass-through
 * (URLs, numeric prices, slugs, JS-context literals) — escaping them would
 * either be a no-op or actively break their consumer (e.g. `&` → `&amp;`
 * inside a Liquid string).
 */
const HTML_ESCAPE_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "subtitle",
  "benefit_1_title",
  "benefit_1_body",
  "benefit_2_title",
  "benefit_2_body",
  "benefit_3_title",
  "benefit_3_body",
  "faq_1_q",
  "faq_1_a",
  "faq_2_q",
  "faq_2_a",
  "faq_3_q",
  "faq_3_a",
  "objection_1_text",
  "objection_2_text",
])

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    if (c === "<") return "&lt;"
    if (c === ">") return "&gt;"
    if (c === "&") return "&amp;"
    if (c === '"') return "&quot;"
    if (c === "'") return "&#39;"
    return c
  })
}

function replaceTokens(input: string, vars: Record<string, string>): string {
  return input.replace(TOKEN_RE, (match, key: string) => {
    if (Object.hasOwn(vars, key)) {
      const raw = vars[key] ?? ""
      return HTML_ESCAPE_FIELDS.has(key) ? escapeHtml(raw) : raw
    }
    // Unknown token: leave intact so it surfaces in QA rather than silently
    // emptying. Liquid output tags such as `{{ v | strip }}` use filter pipes
    // that the regex never matches, so they pass through unchanged for
    // Shopify to render server-side.
    return match
  })
}

/**
 * Walks a JSON tree and string-replaces `{{token}}` placeholders against
 * `vars`. Returns a new tree with the same shape; objects and arrays are
 * cloned shallow-by-shallow so the caller's input is not mutated.
 *
 * Deterministic: identical input yields identical output. The result remains
 * valid JSON (only string leaves are rewritten).
 */
export function renderTemplate<T>(template: T, vars: TemplateVars): T {
  const stringVars: Record<string, string> = {
    title: vars.title,
    subtitle: vars.subtitle,
    price: vars.price,
    bundle_2_price: vars.bundle_2_price,
    bundle_3_price: vars.bundle_3_price,
    hero_image_urls_csv: vars.hero_image_urls_csv,
    hero_video_url: vars.hero_video_url,
    whatsapp_number: vars.whatsapp_number,
    pixel_id: vars.pixel_id,
    shopify_page_handle: vars.shopify_page_handle,
    benefit_1_title: vars.benefit_1_title,
    benefit_1_body: vars.benefit_1_body,
    benefit_2_title: vars.benefit_2_title,
    benefit_2_body: vars.benefit_2_body,
    benefit_3_title: vars.benefit_3_title,
    benefit_3_body: vars.benefit_3_body,
    faq_1_q: vars.faq_1_q,
    faq_1_a: vars.faq_1_a,
    faq_2_q: vars.faq_2_q,
    faq_2_a: vars.faq_2_a,
    faq_3_q: vars.faq_3_q,
    faq_3_a: vars.faq_3_a,
    objection_1_text: vars.objection_1_text,
    objection_2_text: vars.objection_2_text,
  }
  return walk(template, stringVars) as T
}

function walk(node: unknown, vars: Record<string, string>): unknown {
  if (typeof node === "string") return replaceTokens(node, vars)
  if (Array.isArray(node)) return node.map((n) => walk(n, vars))
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = walk(v, vars)
    }
    return out
  }
  return node
}
