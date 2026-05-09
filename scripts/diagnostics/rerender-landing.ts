/**
 * Re-renders the landing template for an existing product and re-uploads
 * the asset to the active Shopify theme — without re-creating the Shopify
 * product/page. Useful after editing `templates/blocks.ts` to verify the
 * new render shape on a known-good product.
 *
 * Reads the persisted landing body if present (from a previous publish),
 * otherwise generates a fresh one. Builds the same `vars` shape as
 * `publishLanding/index.ts` so the rendered output matches production.
 */
import { and, eq, inArray } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, creatives, integrations, products, users } from "@/db/schema"
import { EncryptedExtraJson } from "@/db/zod"
import { generateLandingBody } from "@/lib/ai/landing-body.ts"
import { decrypt } from "@/lib/crypto"
import { applyTemplate, getActiveThemeId, templateAssetKeyFor } from "@/lib/shopify"
import { renderTemplate } from "@/lib/shopify/render"
import { loadTemplate } from "@/lib/shopify/templates"

const userId = process.env.ONBOARD_USER_ID
if (!userId) throw new Error("set ONBOARD_USER_ID")
const productId = process.argv[2]
if (!productId) throw new Error("usage: rerender-landing.ts <productId>")

function priceCentsToString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "0.00"
  const whole = Math.floor(cents / 100)
  const frac = (cents % 100).toString().padStart(2, "0")
  return `${whole.toString()}.${frac}`
}

const data = await withUser(userId, async (db) => {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1)
  const [user] = await db
    .select({ whatsappNumber: users.whatsappNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const selectedCreatives = await db
    .select({
      id: creatives.id,
      angle: creatives.angle,
      transcriptText: creatives.transcriptText,
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
  return { product, user, selectedCreatives }
})

if (!data.product) throw new Error("product not found")
if (!data.user) throw new Error("user not found")
if (!data.product.shopifyPageHandle)
  throw new Error("product has no shopify_page_handle — run publish first")
if (!data.product.shopifyTemplateId) throw new Error("product has no shopify_template_id")

const tid = data.product.shopifyTemplateId
if (tid !== 1 && tid !== 2 && tid !== 3) throw new Error(`invalid templateId: ${tid.toString()}`)

const creativeIds = data.selectedCreatives.map((c) => c.id)
const editedAssets =
  creativeIds.length === 0
    ? []
    : await withUser(userId, async (db) =>
        db
          .select({ url: assets.url })
          .from(assets)
          .where(
            and(
              eq(assets.ownerType, "creative"),
              eq(assets.kind, "edited_video"),
              inArray(assets.ownerId, creativeIds),
            ),
          ),
      )

const integration = await withUser(userId, async (db) =>
  db
    .select({ token: integrations.encryptedToken, extra: integrations.encryptedExtraJson })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "shopify")))
    .limit(1),
)
if (!integration[0]) throw new Error("no shopify integration")
const accessToken = await decrypt(integration[0].token)
const parsed = EncryptedExtraJson.parse(JSON.parse(await decrypt(integration[0].extra)))
if (parsed.provider !== "shopify") throw new Error("not shopify")

console.log(`generating landing body for ${data.selectedCreatives.length.toString()} creatives...`)
const landingBody = await generateLandingBody({
  product: data.product,
  creatives: data.selectedCreatives.map((c) => ({
    id: c.id,
    angle: c.angle,
    transcript: c.transcriptText ?? "",
    language: c.language ?? "es",
  })),
})

const [b1, b2, b3] = landingBody.benefits
const [f1, f2, f3] = landingBody.faq
const [o1, o2] = landingBody.objections
if (!b1 || !b2 || !b3 || !f1 || !f2 || !f3 || !o1 || !o2) {
  throw new Error("landing body shape invariant violated")
}

const DEFAULT_SUBTITLES: Record<1 | 2 | 3, string> = {
  1: "Calidad garantizada. Entrega contra reembolso.",
  2: "Stock limitado — solo hoy con descuento exclusivo. Pago contra entrega.",
  3: "Hecho para tu estilo de vida. Disfrútalo desde el primer día.",
}

const vars = {
  title: data.product.name ?? "Producto",
  subtitle: DEFAULT_SUBTITLES[tid],
  price: priceCentsToString(data.product.pricingCents),
  bundle_2_price: priceCentsToString(data.product.bundle2PricingCents),
  bundle_3_price: priceCentsToString(data.product.bundle3PricingCents),
  hero_image_urls_csv: data.product.imageUrls.slice(0, 3).join(","),
  hero_video_url: editedAssets[0]?.url ?? "",
  whatsapp_number: data.user.whatsappNumber ?? "",
  pixel_id: "",
  shopify_page_handle: data.product.shopifyPageHandle,
  benefit_1_title: b1.title,
  benefit_1_body: b1.body,
  benefit_2_title: b2.title,
  benefit_2_body: b2.body,
  benefit_3_title: b3.title,
  benefit_3_body: b3.body,
  faq_1_q: f1.q,
  faq_1_a: f1.a,
  faq_2_q: f2.q,
  faq_2_a: f2.a,
  faq_3_q: f3.q,
  faq_3_a: f3.a,
  objection_1_text: o1,
  objection_2_text: o2,
}

const tpl = loadTemplate(tid)
const rendered = renderTemplate(tpl, vars)
const creds = { token: accessToken, shop_domain: parsed.shop_domain }
const themeId = await getActiveThemeId(creds)
const assetKey = templateAssetKeyFor(productId)

console.log(`uploading to theme ${themeId.toString()} key=${assetKey}`)
await applyTemplate(creds, themeId, assetKey, rendered)
console.log("done")
console.log(`https://${parsed.shop_domain}/pages/${data.product.shopifyPageHandle}`)
