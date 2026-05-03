import { tasks } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { products } from "@/db/schema"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"

const productId = process.argv[2]
const userId = process.argv[3]
if (!productId || !userId) {
  throw new Error("usage: retry-scrape <productId> <userId>")
}

const row = await withUser(userId, async (db) => {
  return await db
    .select({ sourceUrl: products.sourceUrl })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1)
})
const product = row[0]
if (!product) throw new Error("product not found")

await withUser(userId, async (db) => {
  await db
    .update(products)
    .set({ status: "SCRAPING", scrapeReason: null })
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
})

const handle = await tasks.trigger<typeof scrapeProduct>("scrape-product", {
  productId,
  userId,
  competitorUrl: product.sourceUrl,
  attempt: Math.floor(Date.now() / 1000),
})
console.log(`run=${handle.id}`)
