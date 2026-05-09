/**
 * One-off repair: aligns a Shopify Page's `template_suffix` with the asset
 * key derived from the Replik productId. Safe to re-run; re-PUT with the
 * same suffix is a no-op.
 *
 * Usage:
 *   ONBOARD_USER_ID=<uid> bun --preload ./scripts/_preload.ts \
 *     scripts/diagnostics/repair-page-suffix.ts <productId>
 */
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { integrations, products } from "@/db/schema"
import { EncryptedExtraJson } from "@/db/zod"
import { decrypt } from "@/lib/crypto"
import { templateSuffixFor } from "@/lib/shopify"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const productId = process.argv[2]
if (!productId) throw new Error("usage: repair-page-suffix.ts <productId>")

const [product] = await withUser(userId, async (db) =>
  db
    .select({
      shopifyPageHandle: products.shopifyPageHandle,
    })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1),
)
if (!product?.shopifyPageHandle) throw new Error("product has no shopifyPageHandle")

const [creds] = await withUser(userId, async (db) =>
  db
    .select({ token: integrations.encryptedToken, extra: integrations.encryptedExtraJson })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "shopify")))
    .limit(1),
)
if (!creds) throw new Error("no shopify integration")
const accessToken = await decrypt(creds.token)
const parsed = EncryptedExtraJson.parse(JSON.parse(await decrypt(creds.extra)))
if (parsed.provider !== "shopify") throw new Error("not shopify")
const shop = parsed.shop_domain

const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" }

const findResp = await fetch(
  `https://${shop}/admin/api/2024-10/pages.json?handle=${encodeURIComponent(product.shopifyPageHandle)}`,
  { headers },
)
const findJson = (await findResp.json()) as {
  pages?: { id: number; handle: string; template_suffix: string | null }[]
}
const page = findJson.pages?.[0]
if (!page) throw new Error(`page not found by handle ${product.shopifyPageHandle}`)

const desiredSuffix = templateSuffixFor(productId)
if (page.template_suffix === desiredSuffix) {
  console.log(`already aligned: page ${page.id.toString()} template_suffix=${desiredSuffix}`)
  process.exit(0)
}

console.log(
  `updating page ${page.id.toString()} template_suffix: ${page.template_suffix ?? "<null>"} -> ${desiredSuffix}`,
)
const updateResp = await fetch(
  `https://${shop}/admin/api/2024-10/pages/${page.id.toString()}.json`,
  {
    method: "PUT",
    headers,
    body: JSON.stringify({ page: { id: page.id, template_suffix: desiredSuffix } }),
  },
)
if (!updateResp.ok) {
  console.error(`update failed: ${updateResp.status.toString()} ${await updateResp.text()}`)
  process.exit(1)
}
console.log("done")
