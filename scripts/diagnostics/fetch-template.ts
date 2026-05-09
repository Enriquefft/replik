import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client"
import { integrations } from "@/db/schema"
import { EncryptedExtraJson } from "@/db/zod"
import { decrypt } from "@/lib/crypto"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const handle = process.argv[2]
if (!handle) throw new Error("usage: fetch-template.ts <handle>")

const rows = await withUser(userId, async (db) =>
  db
    .select({ token: integrations.encryptedToken, extra: integrations.encryptedExtraJson })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "shopify")))
    .limit(1),
)
if (!rows[0]) throw new Error("no shopify integration")
const access_token = await decrypt(rows[0].token)
const extraDec = await decrypt(rows[0].extra)
const parsed = EncryptedExtraJson.parse(JSON.parse(extraDec))
if (parsed.provider !== "shopify") throw new Error("not shopify")
const { shop_domain } = parsed

const themesResp = await fetch(`https://${shop_domain}/admin/api/2024-10/themes.json`, {
  headers: { "X-Shopify-Access-Token": access_token },
})
const themes = await themesResp.json()
const main = themes.themes.find((t: { role: string }) => t.role === "main")
if (!main) throw new Error("no main theme")

const assetResp = await fetch(
  `https://${shop_domain}/admin/api/2024-10/themes/${main.id}/assets.json?asset[key]=templates/page.${handle}.json`,
  { headers: { "X-Shopify-Access-Token": access_token } },
)
const asset = await assetResp.json()
console.error(`status=${assetResp.status.toString()} themeId=${main.id.toString()}`)
console.log(JSON.stringify(asset, null, 2))
