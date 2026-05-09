/**
 * Deep-audit a single product: scrape result, creatives (with transcripts +
 * angles), assets (incl. landing HTML/copy), campaigns. Prints JSON for piping.
 */
import { and, eq, inArray } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, campaigns, creatives, products } from "@/db/schema"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const productId = process.argv[2]
if (!productId) throw new Error("usage: inspect-product.ts <productId>")

const out = await withUser(userId, async (db) => {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1)
  const creativeRows = await db
    .select()
    .from(creatives)
    .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
  const creativeIds = creativeRows.map((c) => c.id)
  const creativeAssets =
    creativeIds.length === 0
      ? []
      : await db
          .select()
          .from(assets)
          .where(and(eq(assets.ownerType, "creative"), inArray(assets.ownerId, creativeIds)))
  const productAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.ownerType, "product"), eq(assets.ownerId, productId)))
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.productId, productId), eq(campaigns.userId, userId)))
  return {
    product,
    creatives: creativeRows,
    creativeAssets,
    productAssets,
    campaigns: campaignRows,
  }
})
console.log(JSON.stringify(out, null, 2))
