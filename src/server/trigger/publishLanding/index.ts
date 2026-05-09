import { logger, metadata, task } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys, integrations, products, users } from "@/db/schema"
import { EncryptedExtraJson } from "@/db/zod"
import type { HeroVideoCandidate } from "@/lib/ai/hero-video-pick.ts"
import { pickHeroVideo } from "@/lib/ai/hero-video-pick.ts"
import { generateLandingBody } from "@/lib/ai/landing-body.ts"
import { TemplatePickInputSchema } from "@/lib/ai/schemas.ts"
import { pickTemplate } from "@/lib/ai/template-pick.ts"
import { decrypt } from "@/lib/crypto"
import { logError, markProductFailed, withTiming } from "@/lib/observability/log.ts"
import type { ShopifyCreds } from "@/lib/shopify"
import {
  applyTemplate,
  getActiveThemeId,
  loadTemplate,
  publishProduct,
  renderTemplate,
  templateAssetKeyFor,
} from "@/lib/shopify"
import { requireIntegration } from "@/server/integrations"
import type { PublishPhase } from "./metadata.ts"

interface PublishLandingPayload {
  productId: string
  userId: string
  /**
   * Template chosen by the user via the picker. Optional — when omitted the
   * task falls back to the LLM-driven `pickTemplate` heuristic.
   */
  templateId?: 1 | 2 | 3
  /**
   * Optional copy overrides set by the user from the chat panel. Substituted
   * into the rendered template's `{{title}}` / `{{subtitle}}` variables when
   * present.
   */
  overrides?: {
    headline?: string
    subheadline?: string
  }
}

interface PublishLandingResult {
  shopify_product_id: string
  shopify_page_handle: string
  template_id: 1 | 2 | 3
}

function priceCentsToString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "0.00"
  const whole = Math.floor(cents / 100)
  const frac = (cents % 100).toString().padStart(2, "0")
  return `${whole.toString()}.${frac}`
}

const DEFAULT_SUBTITLES: Record<1 | 2 | 3, string> = {
  1: "Calidad garantizada. Entrega contra reembolso.",
  2: "Stock limitado — solo hoy con descuento exclusivo. Pago contra entrega.",
  3: "Hecho para tu estilo de vida. Disfrútalo desde el primer día.",
}

export const publishLandingTask = task({
  id: "publishLanding",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  machine: "small-1x",
  run: async (payload: PublishLandingPayload, { ctx }): Promise<PublishLandingResult> => {
    const { productId, userId } = payload
    const overrides = payload.overrides
    logger.info("publishLanding:start", {
      productId,
      userId,
      hasOverride: overrides !== undefined,
      explicitTemplate: payload.templateId,
    })

    try {
      // 1. Load product + user inside tenant scope.
      const loaded = await withUser(userId, async (db) => {
        const productRow = await db
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        const userRow = await db
          .select({ whatsappNumber: users.whatsappNumber })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        return { product: productRow[0], user: userRow[0] }
      })
      const product = loaded.product
      const user = loaded.user
      if (!product) throw new Error(`product not found: ${productId}`)
      if (!user) throw new Error(`user not found: ${userId}`)

      // 2. Idempotency key. `attempt` is the Trigger.dev attempt number for the
      // current run — re-runs of the same attempt short-circuit to the persisted
      // state read from the products row.
      const attempt = ctx.attempt.number
      const idemKey = `publish_${productId}_${attempt.toString()}`
      const existing = await withUser(userId, async (db) => {
        const inserted = await db
          .insert(idempotencyKeys)
          .values({
            key: idemKey,
            userId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key })
        return inserted.length === 0
      })
      if (existing) {
        logger.info("publishLanding:idempotent-replay", { idemKey })
        const persisted = await withUser(userId, async (db) => {
          const rows = await db
            .select({
              shopifyProductId: products.shopifyProductId,
              shopifyPageHandle: products.shopifyPageHandle,
              shopifyTemplateId: products.shopifyTemplateId,
            })
            .from(products)
            .where(eq(products.id, productId))
            .limit(1)
          return rows[0]
        })
        if (
          persisted?.shopifyProductId &&
          persisted.shopifyPageHandle &&
          persisted.shopifyTemplateId
        ) {
          const tid = persisted.shopifyTemplateId
          if (tid !== 1 && tid !== 2 && tid !== 3) {
            throw new Error(`invalid persisted template_id: ${tid.toString()}`)
          }
          return {
            shopify_product_id: persisted.shopifyProductId,
            shopify_page_handle: persisted.shopifyPageHandle,
            template_id: tid,
          }
        }
        // Idempotency row exists but persisted columns absent → previous attempt
        // crashed mid-pipeline. Fall through and run the pipeline again.
      }

      // 3. Resolve template — explicit user choice wins; otherwise LLM picks.
      metadata.set("phase", "picking_template" satisfies PublishPhase)
      let templateId: 1 | 2 | 3
      const heroImageUrl = product.imageUrls[0] ?? null
      if (payload.templateId !== undefined) {
        templateId = payload.templateId
      } else if (heroImageUrl === null || product.category === null) {
        // Cannot call vision-based pickTemplate without both imageUrl and category.
        logger.warn("publishLanding:template-pick-skipped", {
          missingImageUrl: heroImageUrl === null,
          missingCategory: product.category === null,
        })
        templateId = 1
      } else {
        const priceText = `$${priceCentsToString(product.pricingCents)}`
        const templatePickInput = TemplatePickInputSchema.safeParse({
          name: product.name ?? "Producto",
          category: product.category,
          description: product.description ?? "",
          priceText,
          heroImageUrl,
        })
        if (!templatePickInput.success) {
          logger.warn("publishLanding:template-pick-input-invalid", {
            error: templatePickInput.error.message,
          })
          templateId = 1
        } else {
          templateId = await withTiming(
            "task.publish.template_pick",
            () => pickTemplate(templatePickInput.data),
            { productId },
          )
        }
      }
      metadata.set("templateId", templateId)
      logger.info("publishLanding:template-picked", {
        templateId,
        source: payload.templateId !== undefined ? "user" : "llm",
      })

      // 4. Resolve Shopify integration.
      const shopifyCreds = await requireIntegration(userId, "shopify")
      if (shopifyCreds.extra.provider !== "shopify") {
        throw new Error("integration extra provider mismatch")
      }
      const creds: ShopifyCreds = {
        token: shopifyCreds.token,
        shop_domain: shopifyCreds.extra.shop_domain,
      }

      // 5. Create product + page on Shopify. We forward ALL imageUrls so the
      // Shopify product gallery mirrors the landing hero gallery (1–3 photos
      // ordered best-first per the scraper contract).
      const productInput: Parameters<typeof publishProduct>[1] = {
        productId,
        name: product.name ?? "Producto",
        category: product.category,
        description: product.description,
        imageUrls: product.imageUrls,
        pricingCents: product.pricingCents ?? 0,
        bundle2PricingCents: product.bundle2PricingCents ?? 0,
        bundle3PricingCents: product.bundle3PricingCents ?? 0,
        templateId,
      }
      metadata.set("phase", "shopify_publish" satisfies PublishPhase)
      const published = await withTiming(
        "task.publish.shopify_publish",
        () => publishProduct(creds, productInput),
        { productId, templateId },
      )
      logger.info("publishLanding:product-published", {
        shopify_product_id: published.shopify_product_id,
        shopify_page_handle: published.shopify_page_handle,
      })

      // 6. Build template vars. Pixel id sourced from Meta integration if
      // present (best-effort; landing publishes without Meta).
      const selectedCreatives = await withUser(userId, async (db) => {
        return db
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
      })
      const creativeIds = selectedCreatives.map((c) => c.id)
      const editedAssets =
        creativeIds.length === 0
          ? []
          : await withUser(userId, async (db) =>
              db
                .select({ ownerId: assets.ownerId, url: assets.url })
                .from(assets)
                .where(
                  and(
                    eq(assets.ownerType, "creative"),
                    eq(assets.kind, "edited_video"),
                    inArray(assets.ownerId, creativeIds),
                  ),
                ),
            )
      // Defense in depth — the publish action gates on this same condition,
      // but if the task is invoked directly (worker tests, manual replay,
      // payload smuggled past the action) we refuse to render with a missing
      // edited video instead of silently shipping an empty landing.
      if (editedAssets.length !== creativeIds.length) {
        throw new Error(
          `burn_incomplete: ${editedAssets.length.toString()}/${creativeIds.length.toString()} edited_video assets present`,
        )
      }

      // 6b. Generate the landing body (benefits/faq/objections). Anchored to
      // selected creatives' transcripts so claims trace back to real product
      // signal — fallback throws and the publish task surfaces via
      // `markProductFailed` rather than rendering an empty body.
      if (selectedCreatives.length === 0) {
        throw new Error("publishLanding: no selected creatives — cannot generate landing body")
      }
      metadata.set("phase", "generating_body" satisfies PublishPhase)
      const landingBody = await withTiming(
        "task.publish.landing_body",
        () =>
          generateLandingBody({
            product,
            creatives: selectedCreatives.map((c) => ({
              id: c.id,
              angle: c.angle,
              transcript: c.transcriptText ?? "",
              language: c.language ?? "es",
            })),
          }),
        { productId, creativeCount: selectedCreatives.length },
      )

      // 6c. Pick the single best video for the hero. The hero gets ONE video
      // tile (mobile-first stacked layout); the LLM ranks the user's selected
      // creatives by hero-fit (hook strength, mute-friendliness, angle clarity).
      // The publish-side throw on `selectedCreatives.length === 0` above
      // guarantees the candidate list is non-empty here.
      metadata.set("phase", "picking_hero_video" satisfies PublishPhase)
      const editedUrlByCreativeId = new Map(editedAssets.map((a) => [a.ownerId, a.url] as const))
      const heroVideoCandidates: HeroVideoCandidate[] = []
      for (const c of selectedCreatives) {
        const url = editedUrlByCreativeId.get(c.id)
        if (url === undefined) continue
        heroVideoCandidates.push({
          creativeId: c.id,
          editedVideoUrl: url,
          transcriptText: c.transcriptText ?? "",
          angle: c.angle,
        })
      }
      // Mirrors the burn_incomplete guard above — the count check there
      // already enforces a 1:1 between selected creatives and edited assets,
      // so this is defense-in-depth narrowing.
      const fallbackCandidate = heroVideoCandidates[0]
      if (!fallbackCandidate) {
        throw new Error("publishLanding: no edited videos available for hero pick")
      }
      const productCategoryForHero = product.category
      let heroPicked: { pickedCreativeId: string; url: string }
      if (productCategoryForHero === null) {
        // The picker only needs name + category; for a category-less product
        // we degrade to the first selected creative without an LLM call.
        logger.warn("publishLanding:hero-video-pick-skipped-no-category")
        heroPicked = {
          pickedCreativeId: fallbackCandidate.creativeId,
          url: fallbackCandidate.editedVideoUrl,
        }
      } else {
        heroPicked = await withTiming(
          "task.publish.hero_video_pick",
          () =>
            pickHeroVideo({
              candidates: heroVideoCandidates,
              product: {
                name: product.name ?? "Producto",
                category: productCategoryForHero,
              },
            }),
          { productId, candidateCount: heroVideoCandidates.length },
        )
      }
      const heroVideoUrl = heroPicked.url
      logger.info("publishLanding:hero-video-picked", {
        creativeId: heroPicked.pickedCreativeId,
      })

      let pixelId = ""
      const metaRow = await withUser(userId, async (db) => {
        return db
          .select({
            encryptedExtraJson: integrations.encryptedExtraJson,
          })
          .from(integrations)
          .where(and(eq(integrations.userId, userId), eq(integrations.provider, "meta")))
          .limit(1)
      })
      const metaExtraEncrypted = metaRow[0]?.encryptedExtraJson
      if (metaExtraEncrypted) {
        try {
          const decrypted = await decrypt(metaExtraEncrypted)
          const parsed = EncryptedExtraJson.parse(JSON.parse(decrypted))
          if (parsed.provider === "meta") {
            pixelId = parsed.pixel_id
          }
        } catch (err) {
          logger.warn("publishLanding:pixel-decrypt-failed", {
            message: err instanceof Error ? err.message : "unknown",
          })
        }
      }

      const [b1, b2, b3] = landingBody.benefits
      const [f1, f2, f3] = landingBody.faq
      const [o1, o2] = landingBody.objections
      if (!b1 || !b2 || !b3 || !f1 || !f2 || !f3 || !o1 || !o2) {
        // LandingBodySchema enforces length(3)/length(3)/length(2), so this
        // is unreachable in practice — kept as a typed narrowing.
        throw new Error("publishLanding: landing body shape invariant violated")
      }
      const vars = {
        title: overrides?.headline ?? product.name ?? "Producto",
        subtitle: overrides?.subheadline ?? DEFAULT_SUBTITLES[templateId],
        price: priceCentsToString(product.pricingCents),
        bundle_2_price: priceCentsToString(product.bundle2PricingCents),
        bundle_3_price: priceCentsToString(product.bundle3PricingCents),
        // Hero contract (Phase 2): up to 3 product photos, comma-joined,
        // ordered best-first per the scraper. The hero template renders the
        // first as the main image and the remaining 0–2 as thumbnails.
        hero_image_urls_csv: product.imageUrls.slice(0, 3).join(","),
        // Single LLM-picked video URL. Empty string suppresses the <video>
        // tag at template render time — but in practice the publish path
        // throws above when no creative is selected, so this is non-empty.
        hero_video_url: heroVideoUrl,
        whatsapp_number: user.whatsappNumber ?? "",
        pixel_id: pixelId,
        shopify_page_handle: published.shopify_page_handle,
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

      // 7. Render template + push to active theme.
      metadata.set("phase", "render" satisfies PublishPhase)
      const tpl = loadTemplate(templateId)
      const rendered = renderTemplate(tpl, vars)
      const themeId = await getActiveThemeId(creds)
      const assetKey = templateAssetKeyFor(productId)
      metadata.set("phase", "apply_theme" satisfies PublishPhase)
      await withTiming(
        "task.publish.apply_theme",
        () => applyTemplate(creds, themeId, assetKey, rendered),
        { productId, themeId, assetKey },
      )
      logger.info("publishLanding:template-applied", {
        themeId,
        assetKey,
      })

      // 8. Persist final state.
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({
            status: "LANDING_PUBLISHED",
            shopifyProductId: published.shopify_product_id,
            shopifyPageHandle: published.shopify_page_handle,
            shopifyTemplateId: templateId,
          })
          .where(eq(products.id, productId))
      })

      return {
        shopify_product_id: published.shopify_product_id,
        shopify_page_handle: published.shopify_page_handle,
        template_id: templateId,
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logError("task.publish.fatal", { productId, userId, reason })
      await markProductFailed(userId, productId, reason, "publish-crashed")
      throw err
    }
  },
})
