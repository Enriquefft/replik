import "server-only"

/**
 * CORS strategy for `/api/orders`: fail closed, whitelist `*.myshopify.com`.
 * The endpoint is public (no Clerk session) but only Shopify storefronts on
 * the `myshopify.com` apex are allowed to POST. Any other Origin is rejected
 * with 403 — the response carries no Access-Control-Allow-Origin header so
 * browsers will block the response.
 */

const SHOPIFY_ORIGIN_RE = /^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

export function isAllowedShopifyOrigin(origin: string | null): origin is string {
  if (!origin) return false
  return SHOPIFY_ORIGIN_RE.test(origin)
}

export function corsHeadersForOrigin(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}
