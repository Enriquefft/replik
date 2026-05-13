import "server-only"
import { type AdminRestApiClient, createAdminRestApiClient } from "@shopify/admin-api-client"
import { z } from "zod"
import { ShopifyAuthError } from "./errors"

export interface ShopifyCreds {
  /** Token shpat_… */
  token: string
  /** Canonical `myshopify_domain`, e.g. `mystore.myshopify.com`. */
  shop_domain: string
}

const API_VERSION = "2024-10"

export class ShopifyApiError extends Error {
  readonly status: number
  readonly body: string | undefined

  constructor(status: number, message: string, body?: string) {
    super(message)
    this.name = "ShopifyApiError"
    this.status = status
    if (body !== undefined) this.body = body
  }
}

function buildClient(creds: ShopifyCreds): AdminRestApiClient {
  return createAdminRestApiClient({
    storeDomain: creds.shop_domain,
    apiVersion: API_VERSION,
    accessToken: creds.token,
  })
}

interface JsonInit {
  body?: Record<string, unknown>
  searchParams?: Record<string, string | number>
}

/**
 * Single internal helper centralizing headers + JSON parse + error mapping.
 * Using `@shopify/admin-api-client`'s REST client gives us retries + correct
 * `X-Shopify-Access-Token` injection while letting us stay path-driven.
 *
 * Callers pass a `z.ZodType<T>` to get Zod-validated output instead of an
 * unsafe cast.
 */
async function shopifyFetch<T>(
  creds: ShopifyCreds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  schema: z.ZodType<T>,
  init: JsonInit = {},
): Promise<T> {
  const client = buildClient(creds)
  const opts: {
    data?: Record<string, unknown>
    searchParams?: Record<string, string | number>
  } = {}
  if (init.body !== undefined) {
    opts.data = init.body
  }
  if (init.searchParams) {
    opts.searchParams = init.searchParams
  }
  let response: Response
  try {
    if (method === "GET") {
      response = await client.get(path, opts)
    } else if (method === "POST") {
      response = await client.post(path, {
        data: opts.data ?? {},
        ...(opts.searchParams ? { searchParams: opts.searchParams } : {}),
      })
    } else if (method === "PUT") {
      response = await client.put(path, {
        data: opts.data ?? {},
        ...(opts.searchParams ? { searchParams: opts.searchParams } : {}),
      })
    } else {
      response = await client.delete(path, opts)
    }
  } catch (err) {
    throw new ShopifyApiError(
      0,
      `Shopify request failed: ${err instanceof Error ? err.message : "unknown"}`,
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new ShopifyAuthError()
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new ShopifyApiError(
      response.status,
      `Shopify ${method} ${path} → HTTP ${response.status.toString()}`,
      text,
    )
  }
  return schema.parse(await response.json())
}

// ---------- Domain types ----------

export interface ShopifyProductInput {
  productId: string
  name: string
  category: string | null
  description?: string | null
  /**
   * 1–3 product image URLs ordered best-first (matches the scraper bound
   * on `products.imageUrls` for `READY` rows). All entries are forwarded to
   * Shopify so the product gallery shows the same set as the landing hero.
   */
  imageUrls: string[]
  pricingCents: number
  bundle2PricingCents: number
  bundle3PricingCents: number
  templateId: 1 | 2 | 3
}

/**
 * Derives the per-product page-template suffix from the Replik product id.
 *
 * Why per-product (not per-template-id): each product has unique copy, prices,
 * and AI-generated body content baked into the JSON template at upload time.
 * Sharing `templates/page.replik-1.json` across every product on a shop using
 * Template 1 would have all those products render with the most-recently-
 * published product's copy.
 *
 * The suffix is deterministic so `publishLanding` (writes the asset),
 * `publishProduct` (sets `template_suffix` on the page), and any rerender
 * tooling all derive the same key without persisting it separately.
 */
export function templateSuffixFor(productId: string): string {
  return `replik-${productId}`
}

/**
 * The Shopify asset path that stores a product's rendered page-template JSON.
 * Mirror of `templateSuffixFor` so the suffix and asset key cannot drift.
 */
export function templateAssetKeyFor(productId: string): string {
  return `templates/page.${templateSuffixFor(productId)}.json`
}

export interface PublishProductResult {
  shopify_product_id: string
  shopify_page_handle: string
}

const ProductCreateResponseSchema = z.object({
  product: z.object({ id: z.number(), handle: z.string() }),
})

const PageCreateResponseSchema = z.object({
  page: z.object({ id: z.number(), handle: z.string(), template_suffix: z.string().optional() }),
})

const ThemeListResponseSchema = z.object({
  themes: z.array(z.object({ id: z.number(), role: z.string(), name: z.string() })),
})

const ShopInfoResponseSchema = z.object({
  shop: z.object({
    primary_domain: z.object({
      host: z.string().min(1),
    }),
  }),
})

export interface ShopInfo {
  /** Primary storefront host (custom domain when set, else `*.myshopify.com`). */
  primary_domain: string
}

/**
 * Returns the shop's `primary_domain.host` — the canonical hostname for the
 * merchant's live storefront. May equal `shop_domain` (no custom domain) or
 * a custom domain like `mitienda.com`. Used to build the public landing URL
 * post-publish.
 */
export async function fetchShopInfo(creds: ShopifyCreds): Promise<ShopInfo> {
  const resp = await shopifyFetch(creds, "GET", "shop.json", ShopInfoResponseSchema)
  return { primary_domain: resp.shop.primary_domain.host }
}

function centsToPriceString(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error(`Invalid price (cents): ${cents.toString()}`)
  }
  const whole = Math.floor(cents / 100)
  const frac = (cents % 100).toString().padStart(2, "0")
  return `${whole.toString()}.${frac}`
}

/**
 * Creates the product (3 variants: 1u / 2-pack / 3-pack) plus the published
 * page that holds the rendered landing template.
 *
 * The `template_suffix` follows Shopify's `templates/page.<suffix>.json`
 * convention; we use `replik-1`, `replik-2`, `replik-3` so the asset key
 * matches the template id picked by the LLM.
 */
export async function publishProduct(
  creds: ShopifyCreds,
  p: ShopifyProductInput,
): Promise<PublishProductResult> {
  const variants = [
    { option1: "1 unidad", price: centsToPriceString(p.pricingCents) },
    { option1: "2 pack", price: centsToPriceString(p.bundle2PricingCents) },
    { option1: "3 pack", price: centsToPriceString(p.bundle3PricingCents) },
  ]
  const productPayload: Record<string, unknown> = {
    product: {
      title: p.name,
      body_html: p.description ?? "",
      vendor: "Replik",
      product_type: p.category ?? "",
      status: "active",
      images: p.imageUrls.map((src) => ({ src })),
      options: [{ name: "Pack" }],
      variants,
    },
  }
  const productResp = await shopifyFetch(
    creds,
    "POST",
    "products.json",
    ProductCreateResponseSchema,
    {
      body: productPayload,
    },
  )

  const templateSuffix = templateSuffixFor(p.productId)
  const pagePayload = {
    page: {
      title: p.name,
      body_html: "",
      published: true,
      template_suffix: templateSuffix,
    },
  }
  const pageResp = await shopifyFetch(creds, "POST", "pages.json", PageCreateResponseSchema, {
    body: pagePayload,
  })

  return {
    shopify_product_id: productResp.product.id.toString(),
    shopify_page_handle: pageResp.page.handle,
  }
}

/**
 * Returns the active (`role: 'main'`) theme id. Required to address the
 * `templates/page.<handle>.json` asset against the right theme.
 */
export async function getActiveThemeId(creds: ShopifyCreds): Promise<number> {
  const resp = await shopifyFetch(creds, "GET", "themes.json", ThemeListResponseSchema, {
    searchParams: { role: "main" },
  })
  const main = resp.themes.find((t) => t.role === "main") ?? resp.themes[0]
  if (!main) {
    throw new ShopifyApiError(404, "No main theme found")
  }
  return main.id
}

/**
 * Uploads a JSON template asset (online-store-2.0 page template) to the given
 * theme. The `key` is `templates/page.<suffix>.json`. Shopify expects the
 * `value` to be a JSON-stringified template document.
 */
export async function applyTemplate(
  creds: ShopifyCreds,
  themeId: number,
  key: string,
  content: unknown,
): Promise<void> {
  await shopifyFetch(creds, "PUT", `themes/${themeId.toString()}/assets.json`, z.unknown(), {
    body: {
      asset: {
        key,
        value: JSON.stringify(content),
      },
    },
  })
}
