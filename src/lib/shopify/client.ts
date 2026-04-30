import "server-only"
import { type AdminRestApiClient, createAdminRestApiClient } from "@shopify/admin-api-client"
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
  body?: unknown
  searchParams?: Record<string, string | number>
}

/**
 * Single internal helper centralizing headers + JSON parse + error mapping.
 * Using `@shopify/admin-api-client`'s REST client gives us retries + correct
 * `X-Shopify-Access-Token` injection while letting us stay path-driven.
 */
async function shopifyFetch<T>(
  creds: ShopifyCreds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  init: JsonInit = {},
): Promise<T> {
  const client = buildClient(creds)
  const opts: {
    data?: Record<string, unknown>
    searchParams?: Record<string, string | number>
  } = {}
  if (init.body !== undefined) {
    opts.data = init.body as Record<string, unknown>
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
  return (await response.json()) as T
}

// ---------- Domain types ----------

export interface ShopifyProductInput {
  name: string
  category: string | null
  description?: string | null
  imageUrl?: string | null
  pricingCents: number
  bundle2PricingCents: number
  bundle3PricingCents: number
  templateId: 1 | 2 | 3
}

export interface PublishProductResult {
  shopify_product_id: string
  shopify_page_handle: string
}

interface ProductCreateResponse {
  product: { id: number; handle: string }
}

interface PageCreateResponse {
  page: { id: number; handle: string; template_suffix?: string }
}

interface ThemeListResponse {
  themes: { id: number; role: string; name: string }[]
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
      images: p.imageUrl ? [{ src: p.imageUrl }] : [],
      options: [{ name: "Pack" }],
      variants,
    },
  }
  const productResp = await shopifyFetch<ProductCreateResponse>(creds, "POST", "products.json", {
    body: productPayload,
  })

  const templateSuffix = `replik-${p.templateId.toString()}`
  const pagePayload = {
    page: {
      title: p.name,
      body_html: "",
      published: true,
      template_suffix: templateSuffix,
    },
  }
  const pageResp = await shopifyFetch<PageCreateResponse>(creds, "POST", "pages.json", {
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
  const resp = await shopifyFetch<ThemeListResponse>(creds, "GET", "themes.json", {
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
  await shopifyFetch<unknown>(creds, "PUT", `themes/${themeId.toString()}/assets.json`, {
    body: {
      asset: {
        key,
        value: JSON.stringify(content),
      },
    },
  })
}
