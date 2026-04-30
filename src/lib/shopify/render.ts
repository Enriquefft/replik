import "server-only"

/**
 * Vars consumed by the 3 landing templates. All values are stringified at
 * substitution time. Numeric fields are pre-formatted by the caller.
 */
export interface TemplateVars {
  title: string
  price: string
  bundle_2_price: string
  bundle_3_price: string
  /** Comma-separated MP4 URLs for the hero/video slot. */
  video_urls_csv: string
  product_image_url: string
  whatsapp_number: string
  pixel_id: string
  shopify_page_handle: string
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function replaceTokens(input: string, vars: Record<string, string>): string {
  return input.replace(TOKEN_RE, (match, key: string) => {
    if (Object.hasOwn(vars, key)) {
      return vars[key] ?? ""
    }
    // Unknown token: leave intact so it surfaces in QA rather than silently
    // emptying. Shopify won't render it as Liquid because the asset is JSON.
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
    price: vars.price,
    bundle_2_price: vars.bundle_2_price,
    bundle_3_price: vars.bundle_3_price,
    video_urls_csv: vars.video_urls_csv,
    product_image_url: vars.product_image_url,
    whatsapp_number: vars.whatsapp_number,
    pixel_id: vars.pixel_id,
    shopify_page_handle: vars.shopify_page_handle,
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
