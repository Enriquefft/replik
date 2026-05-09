/**
 * Dry-run §11 copy generation for a product's selected creatives — same input
 * shape `launchCampaign` builds before the Meta upload phase. Prints the
 * winning candidate as JSON without touching Meta.
 */
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { creatives, products } from "@/db/schema"
import { generateCopy } from "@/lib/ai/copy-gen.ts"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const productId = process.argv[2]
if (!productId) throw new Error("usage: dry-launch-copy.ts <productId>")

const data = await withUser(userId, async (db) => {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1)
  const selected = await db
    .select({
      id: creatives.id,
      angle: creatives.angle,
      transcript: creatives.transcriptText,
      language: creatives.language,
    })
    .from(creatives)
    .where(
      and(
        eq(creatives.productId, productId),
        eq(creatives.userId, userId),
        eq(creatives.selectedBool, true),
      ),
    )
  return { product, selected }
})
if (!data.product) throw new Error("product not found")

const copy = await generateCopy({
  product: data.product,
  creatives: data.selected.map((c) => ({
    id: c.id,
    angle: c.angle,
    transcript: c.transcript ?? "",
    language: c.language ?? "es",
  })),
})
console.log(JSON.stringify(copy, null, 2))
