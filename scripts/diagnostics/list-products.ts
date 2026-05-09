import { desc, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { products } from "@/db/schema"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const rows = await withUser(userId, async (db) =>
  db
    .select({
      id: products.id,
      name: products.name,
      sourceUrl: products.sourceUrl,
      category: products.category,
      status: products.status,
      scrapeReason: products.scrapeReason,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(eq(products.userId, userId))
    .orderBy(desc(products.createdAt))
    .limit(20),
)
for (const r of rows) console.log(JSON.stringify(r))
