import "server-only"
import { eq } from "drizzle-orm"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getDb } from "@/db/client"
import { orders, products, users } from "@/db/schema"
import { corsHeadersForOrigin, isAllowedShopifyOrigin } from "@/lib/shopify/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OrderInput = z.object({
  shopify_page_handle: z.string().min(1).max(255),
  customer_name: z.string().min(1).max(200),
  phone: z.string().regex(/^\+?\d{8,15}$/),
  address: z.string().min(1).max(500),
  city: z.string().min(1).max(120),
  qty: z.number().int().min(1).max(99),
  total_cents: z.number().int().min(0).max(100_000_00),
})

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers: HeadersInit = { "Content-Type": "application/json" }
  if (origin && isAllowedShopifyOrigin(origin)) {
    Object.assign(headers, corsHeadersForOrigin(origin))
  }
  return new Response(JSON.stringify(body), { status, headers })
}

export function OPTIONS(request: NextRequest): Response {
  const origin = request.headers.get("origin")
  if (!isAllowedShopifyOrigin(origin)) {
    return new Response(null, { status: 403 })
  }
  return new Response(null, {
    status: 204,
    headers: corsHeadersForOrigin(origin),
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("origin")
  if (!isAllowedShopifyOrigin(origin)) {
    return jsonResponse({ ok: false, error: "forbidden" }, 403, origin)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin)
  }
  const parsed = OrderInput.safeParse(raw)
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid_input" }, 400, origin)
  }
  const data = parsed.data

  const db = getDb()
  const productRows = await db
    .select({
      id: products.id,
      userId: products.userId,
      name: products.name,
    })
    .from(products)
    .where(eq(products.shopifyPageHandle, data.shopify_page_handle))
    .limit(1)
  const product = productRows[0]
  if (!product) {
    return jsonResponse({ ok: false, error: "not_found" }, 404, origin)
  }

  const userRows = await db
    .select({ whatsappNumber: users.whatsappNumber })
    .from(users)
    .where(eq(users.id, product.userId))
    .limit(1)
  const user = userRows[0]
  const whatsappNumber = user?.whatsappNumber ?? ""

  await db.insert(orders).values({
    productId: product.id,
    userId: product.userId,
    customerName: data.customer_name,
    phone: data.phone,
    address: data.address,
    city: data.city,
    qty: data.qty,
    totalCents: data.total_cents,
    status: "PENDING",
  })

  return jsonResponse(
    {
      ok: true,
      total_cents: data.total_cents,
      whatsapp_number: whatsappNumber,
      product_name: product.name ?? "",
    },
    200,
    origin,
  )
}
