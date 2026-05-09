import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { integrations } from "@/db/schema"
import { EncryptedExtraJson } from "@/db/zod"
import { decrypt } from "@/lib/crypto"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const rows = await withUser(userId, async (db) =>
  db
    .select({ enc: integrations.encryptedExtraJson })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "shopify")))
    .limit(1),
)
if (rows[0]?.enc) {
  const dec = await decrypt(rows[0].enc)
  const parsed = EncryptedExtraJson.parse(JSON.parse(dec))
  console.log(JSON.stringify(parsed))
}
