import "server-only"

import crypto from "node:crypto"
import { z } from "zod"

const SHOP_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/

export class ShopifyOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShopifyOAuthError"
  }
}

/**
 * Coerces user-pasted input into a canonical `*.myshopify.com` domain.
 * Strips protocol/path so `https://mistore.myshopify.com/admin` reduces to
 * `mistore.myshopify.com`. Throws `ShopifyOAuthError` on any other shape.
 */
export function normalizeShopDomain(input: string): string {
  const stripped = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
  if (!SHOP_DOMAIN_RE.test(stripped)) {
    throw new ShopifyOAuthError("Dominio inválido. Usa <tienda>.myshopify.com")
  }
  return stripped
}

export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex")
}

export function buildAuthorizeUrl(params: {
  shop: string
  clientId: string
  scopes: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(`https://${params.shop}/admin/oauth/authorize`)
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("scope", params.scopes)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("state", params.state)
  return url.toString()
}

/**
 * Verifies the `hmac` query parameter that Shopify appends to OAuth
 * callbacks. Per Shopify spec: drop `hmac` and `signature`, sort the
 * remaining keys alphabetically, join as `k=v&k=v` using URL-decoded values
 * (which is what `URLSearchParams` returns), then HMAC-SHA256 with the app
 * secret. Compare hex digests using `timingSafeEqual`.
 */
export function verifyHmac(searchParams: URLSearchParams, secret: string): boolean {
  const received = searchParams.get("hmac")
  if (!received) return false
  const entries: [string, string][] = []
  for (const [k, v] of searchParams) {
    if (k === "hmac" || k === "signature") continue
    entries.push([k, v])
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&")
  const computed = crypto.createHmac("sha256", secret).update(message).digest("hex")
  const a = Buffer.from(computed, "utf8")
  const b = Buffer.from(received, "utf8")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const TokenExchangeResponse = z.object({
  access_token: z.string().min(1),
  scope: z.string(),
})

export interface ExchangedToken {
  token: string
  /** Comma-separated list of granted scopes as Shopify returned them. */
  scope: string
}

export async function exchangeCode(params: {
  shop: string
  code: string
  clientId: string
  clientSecret: string
}): Promise<ExchangedToken> {
  const url = `https://${params.shop}/admin/oauth/access_token`
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
      }),
      cache: "no-store",
    })
  } catch (err) {
    throw new ShopifyOAuthError(
      `Token exchange request failed: ${err instanceof Error ? err.message : "unknown"}`,
    )
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new ShopifyOAuthError(
      `Token exchange failed (${response.status.toString()}): ${body || "unknown"}`,
    )
  }
  const parsed = TokenExchangeResponse.parse(await response.json())
  return { token: parsed.access_token, scope: parsed.scope }
}
