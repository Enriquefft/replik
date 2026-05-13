import "server-only"

/**
 * Owner: Lane L4b (Launch).
 *
 * Durable orchestration for one campaign launch. Called from the
 * `launchCampaign` Server Action with `{productId, userId, attempt}`. The
 * pipeline below mirrors Meta's required ordering (uploads → creative →
 * campaign → adset → ads) and is end-to-end idempotent on
 * `launch_${userId}_${productId}_${attempt}`:
 *
 *  - First action is a single-row insert into `idempotency_keys`. On unique
 *    violation (re-run with the same attempt) we short-circuit and re-read
 *    the existing `campaigns` + `ads` rows, returning the same shape.
 *  - All Meta calls live inside try/catch wrappers that surface a friendly
 *    Spanish message; `MetaError(code=190)` is already turned into a flag on
 *    `integrations.expires_at` by the wrapper layer.
 *  - Final status everywhere is `PAUSED` — the dashboard owns "go live".
 */

import { logger, metadata, schemaTask } from "@trigger.dev/sdk"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { withUser } from "@/db/client"
import { ads, assets, campaigns, creatives, idempotencyKeys, products } from "@/db/schema"
import { generateCopy } from "@/lib/ai/copy-gen.ts"
import { InterestCategory } from "@/lib/ai/taxonomies.ts"
import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import {
  adCreate,
  adsetCreate,
  campaignCreate,
  creativeCreate,
  imageUpload,
  type MetaCreds,
  videoUploadResumable,
} from "@/lib/meta"
import { interestsFor } from "@/lib/meta/interests"
import { MetaError } from "@/lib/meta/types"
import { logError, markProductFailed, withTiming } from "@/lib/observability/log.ts"
import { getIntegration, requireIntegration } from "@/server/integrations"
import { launchError } from "./errors.ts"
import type { LaunchErrorCode, LaunchPhase } from "./metadata.ts"

/**
 * Map a thrown `MetaError` to one of our `LaunchErrorCode` values. Meta's
 * numeric error codes are the canonical reference: 190 = OAuth token
 * expired, 4/17/32/613 = rate / throttling, 1487* family = ad policy.
 * Anything else falls through to the caller's contextual code (e.g.
 * `meta_video_upload`).
 */
function metaErrorToLaunchCode(err: MetaError, contextual: LaunchErrorCode): LaunchErrorCode {
  if (err.code === 190) return "meta_token_expired"
  if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) {
    return "meta_quota"
  }
  if (err.code >= 1487000 && err.code < 1488000) return "meta_policy"
  return contextual
}

const Payload = z.object({
  productId: z.string().min(1),
  userId: z.string().min(1),
  attempt: z.number().int().positive(),
  budgetDailyCents: z.number().int().positive(),
})

export interface LaunchResult {
  campaignId: string
  metaCampaignId: string
  adCount: number
}

function asInterestCategory(category: string | null): InterestCategory | null {
  if (!category) return null
  const parsed = InterestCategory.safeParse(category)
  return parsed.success ? parsed.data : null
}

/**
 * Wrap any `unknown` thrown by a Meta call into a structured `taskError`.
 * `MetaError` instances route through `metaErrorToLaunchCode` so token /
 * quota / policy failures hit the deterministic translator path; non-Meta
 * exceptions surface as `contextual` (e.g. `meta_video_upload`) with the
 * raw message preserved for the LLM fallback when the contextual code is
 * itself `generic_fallback`.
 */
function throwLaunchError(err: unknown, contextual: LaunchErrorCode, fallback: string): never {
  if (err instanceof MetaError) {
    const code = metaErrorToLaunchCode(err, contextual)
    launchError(code, err.friendly.length > 0 ? err.friendly : err.message)
  }
  const message = err instanceof Error && err.message.length > 0 ? err.message : fallback
  launchError(contextual, message)
}

export const launchCampaign = schemaTask({
  id: "launchCampaign",
  schema: Payload,
  machine: { preset: "medium-1x" },
  maxDuration: 900,
  run: async (payload): Promise<LaunchResult> => {
    const { productId, userId, attempt, budgetDailyCents } = payload
    const idempotencyKey = `launch_${userId}_${productId}_${attempt.toString()}`

    try {
      // 1. Idempotency: claim the key. On conflict, replay the existing result.
      const claimed = await withUser(userId, async (db) => {
        const inserted = await db
          .insert(idempotencyKeys)
          .values({
            key: idempotencyKey,
            userId,
            expiresAt: sql`now() + interval '7 days'`,
          })
          .onConflictDoNothing({ target: idempotencyKeys.key })
          .returning({ key: idempotencyKeys.key })
        return inserted.length > 0
      })
      logger.info("idempotency_check", { idempotencyKey, claimed })
      if (!claimed) {
        const existing = await withUser(userId, async (db) => {
          const campRows = await db
            .select({
              id: campaigns.id,
              metaCampaignId: campaigns.metaCampaignId,
            })
            .from(campaigns)
            .where(and(eq(campaigns.userId, userId), eq(campaigns.idempotencyKey, idempotencyKey)))
            .limit(1)
          const camp = campRows[0]
          if (!camp?.metaCampaignId) return null
          const adRows = await db
            .select({ id: ads.id })
            .from(ads)
            .where(eq(ads.campaignId, camp.id))
          return {
            campaignId: camp.id,
            metaCampaignId: camp.metaCampaignId,
            adCount: adRows.length,
          }
        })
        if (existing) {
          logger.info("complete", { ...existing, replayed: true })
          return existing
        }
        // Idempotency row exists but the campaign row doesn't yet — a previous
        // attempt crashed mid-flight. Surface a friendly error: a fresh attempt
        // (incremented `attempt`) is the safe path forward.
        launchError(
          "generic_fallback",
          "Lanzamiento previo quedó incompleto. Reintenta para crear un nuevo intento.",
        )
      }

      // 2. Load product, selected creatives + their edited_video assets.
      const loaded = await withUser(userId, async (db) => {
        const prodRows = await db
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        const product = prodRows[0]
        if (!product) return null
        const creativeRows = await db
          .select({
            id: creatives.id,
            angle: creatives.angle,
            transcript: creatives.transcriptText,
            language: creatives.language,
            assetUrl: assets.url,
            assetBytes: assets.bytes,
          })
          .from(creatives)
          .innerJoin(
            assets,
            and(
              eq(assets.ownerId, creatives.id),
              eq(assets.ownerType, "creative"),
              eq(assets.kind, "edited_video"),
            ),
          )
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
              eq(creatives.selectedBool, true),
            ),
          )
        return { product, creatives: creativeRows }
      })
      if (!loaded) {
        launchError("generic_fallback", "Producto no encontrado.")
      }
      const { product, creatives: selected } = loaded
      if (selected.length === 0) {
        launchError("missing_creatives", "No hay creativos editados listos.")
      }
      const productImageUrl = product.imageUrls[0]
      if (!productImageUrl) {
        launchError("missing_creatives", "El producto no tiene imagen para el thumbnail.")
      }
      const productName = product.name ?? "Producto"

      // 3. Build creds (Meta required, Shopify optional but expected).
      const metaIntegration = await requireIntegration(userId, "meta")
      if (metaIntegration.extra.provider !== "meta" || !metaIntegration.extra.pixel_id) {
        launchError("integration_incomplete", "Integración Meta incompleta (falta pixel).")
      }
      const creds: MetaCreds = {
        token: metaIntegration.token,
        ad_account_id: metaIntegration.extra.ad_account_id,
        page_id: metaIntegration.extra.page_id,
        pixel_id: metaIntegration.extra.pixel_id,
        userId,
      }
      const pageId = metaIntegration.extra.page_id
      const pixelId = metaIntegration.extra.pixel_id

      // Resolve landing URL — `storefrontUrl` is the SSOT written by the
      // publish task at the same UPDATE that sets `shopifyPageHandle`, so it
      // already uses the merchant's custom `primary_domain` when present.
      // Fall back to deriving from `shop_domain` only if publish ran before
      // this column existed (NULL row pre-0022 migration).
      const pageHandle = product.shopifyPageHandle
      if (!pageHandle) {
        launchError("landing_not_published", "Publica la landing antes de lanzar la campaña.")
      }
      let landingUrl: string
      if (product.storefrontUrl !== null) {
        landingUrl = product.storefrontUrl
      } else {
        const shopifyIntegration = await getIntegration(userId, "shopify")
        const shopDomain =
          shopifyIntegration?.extra.provider === "shopify"
            ? shopifyIntegration.extra.shop_domain
            : null
        landingUrl = shopDomain
          ? `https://${shopDomain}/pages/${pageHandle}`
          : `https://example.com/${pageHandle}`
      }

      // 4. Copy generation — §11 best-of-5 + Opus judge + post-check.
      // One copy unit per distinct angle so A/B variants run differentiated
      // text. Creatives without a classified angle group into the "default"
      // bucket. Cost scales linearly with the number of distinct angles
      // (typical selections yield 2-4).
      metadata.set("phase", "copy" satisfies LaunchPhase)
      const angleKeys = [...new Set(selected.map((c) => c.angle ?? "default"))]
      const copyEntries = await withTiming(
        "task.launch.copy",
        () =>
          Promise.all(
            angleKeys.map(async (angleKey) => {
              const bucket = selected.filter((c) => (c.angle ?? "default") === angleKey)
              const copy = await generateCopy({
                product,
                creatives: bucket.map((c) => ({
                  id: c.id,
                  angle: c.angle,
                  transcript: c.transcript ?? "",
                  language: c.language ?? "es",
                })),
              })
              return [angleKey, copy] as const
            }),
          ),
        { productId, creativeCount: selected.length, angleCount: angleKeys.length },
      )
      const copyByAngle = new Map(copyEntries)
      logger.info("copy_generation_done", {
        adCount: selected.length,
        angleCount: angleKeys.length,
        angles: angleKeys,
      })

      // 5. Sequential video uploads (Meta requires per-video resumable flow).
      metadata.set("phase", "upload_videos" satisfies LaunchPhase)
      metadata.set("videosTotal", selected.length)
      metadata.set("videosUploaded", 0)
      const videoIds = new Map<string, string>()
      for (const c of selected) {
        try {
          const result = await withTiming(
            "task.launch.upload_video",
            () =>
              videoUploadResumable(creds, {
                url: c.assetUrl,
                sizeBytes: c.assetBytes ?? 0,
                filename: `${c.id}.mp4`,
              }),
            { creativeId: c.id },
          )
          videoIds.set(c.id, result.video_id)
          metadata.increment("videosUploaded", 1)
          logger.info("video_upload_progress", {
            creativeId: c.id,
            videoId: result.video_id,
            uploaded: videoIds.size,
            total: selected.length,
          })
        } catch (err) {
          throwLaunchError(err, "meta_video_upload", "Falló la subida de video a Meta.")
        }
      }

      // 6. Image upload (thumbnail).
      metadata.set("phase", "upload_image" satisfies LaunchPhase)
      let imageHash: string
      try {
        const result = await withTiming(
          "task.launch.upload_image",
          () => imageUpload(creds, { url: productImageUrl, filename: "thumb.jpg" }),
          { productId },
        )
        imageHash = result.image_hash
        logger.info("image_upload_done", { imageHash })
      } catch (err) {
        throwLaunchError(err, "meta_image_upload", "Falló la subida del thumbnail a Meta.")
      }

      // 7. Campaign create + persist row.
      metadata.set("phase", "campaign" satisfies LaunchPhase)
      let metaCampaignId: string
      try {
        const result = await withTiming(
          "task.launch.campaign_create",
          () =>
            campaignCreate(creds, {
              name: `Replik — ${productName}`,
              objective: "OUTCOME_SALES",
              status: "PAUSED",
              daily_budget_cents: budgetDailyCents,
              special_ad_categories: [],
            }),
          { productId },
        )
        metaCampaignId = result.id
      } catch (err) {
        throwLaunchError(err, "generic_fallback", "Falló la creación de la campaña en Meta.")
      }
      const campaignRow = await withUser(userId, async (db) => {
        const inserted = await db
          .insert(campaigns)
          .values({
            productId,
            userId,
            metaCampaignId,
            structure: "CBO",
            budgetDailyCents,
            status: "PAUSED",
            idempotencyKey,
            launchedAt: sql`now()`,
          })
          .returning({ id: campaigns.id })
        const row = inserted[0]
        if (!row) {
          launchError("generic_fallback", "No se pudo persistir la campaña.")
        }
        return row
      })
      logger.info("campaign_created", {
        campaignId: campaignRow.id,
        metaCampaignId,
      })

      // 8. AdSets — broad always, interest-targeted optionally.
      metadata.set("phase", "adsets" satisfies LaunchPhase)
      const adsetIds: string[] = []
      try {
        const broad = await withTiming(
          "task.launch.adset_create",
          () =>
            adsetCreate(creds, {
              campaign_id: metaCampaignId,
              name: "Broad PE",
              optimization_goal: "OFFSITE_CONVERSIONS",
              billing_event: "IMPRESSIONS",
              promoted_object: { pixel_id: pixelId, custom_event_type: "PURCHASE" },
              targeting: {
                geo_locations: { countries: ["PE"] },
                age_min: 18,
                age_max: 65,
                advantage_audience: 1,
              },
              status: "PAUSED",
            }),
          { kind: "broad" },
        )
        adsetIds.push(broad.id)
        logger.info("adset_created", { adsetId: broad.id, kind: "broad" })

        const interestCategory = asInterestCategory(product.category)
        if (interestCategory) {
          const interests = interestsFor(interestCategory)
          const detailed = await withTiming(
            "task.launch.adset_create",
            () =>
              adsetCreate(creds, {
                campaign_id: metaCampaignId,
                name: `Detailed ${interestCategory}`,
                optimization_goal: "OFFSITE_CONVERSIONS",
                billing_event: "IMPRESSIONS",
                promoted_object: {
                  pixel_id: pixelId,
                  custom_event_type: "PURCHASE",
                },
                targeting: {
                  geo_locations: { countries: ["PE"] },
                  age_min: 18,
                  age_max: 65,
                  advantage_audience: 1,
                  flexible_spec: [{ interests }],
                },
                status: "PAUSED",
              }),
            { kind: "detailed", category: interestCategory },
          )
          adsetIds.push(detailed.id)
          logger.info("adset_created", {
            adsetId: detailed.id,
            kind: "detailed",
            category: interestCategory,
          })
        }
      } catch (err) {
        throwLaunchError(err, "generic_fallback", "Falló la creación del ad set en Meta.")
      }
      const broadAdsetId = adsetIds[0]
      if (!broadAdsetId) {
        launchError("generic_fallback", "No se creó ningún ad set.")
      }

      // 9. Per creative: creative + ad + persist `ads` row.
      metadata.set("phase", "ads" satisfies LaunchPhase)
      metadata.set("adsCreated", 0)
      let adCount = 0
      for (let i = 0; i < selected.length; i++) {
        const c = selected[i]
        if (!c) continue
        const videoId = videoIds.get(c.id)
        if (!videoId) {
          launchError("generic_fallback", `Estado interno inconsistente para creativo ${c.id}.`)
        }
        const angle = c.angle ?? "default"
        const copy = copyByAngle.get(angle)
        if (!copy) {
          launchError("generic_fallback", `Falta copy para el ángulo ${angle}.`)
        }

        let metaCreativeId: string
        try {
          const result = await withTiming(
            "task.launch.creative_create",
            () =>
              creativeCreate(creds, {
                name: `C-${c.id}-${angle}`,
                object_story_spec: {
                  page_id: pageId,
                  video_data: {
                    video_id: videoId,
                    image_hash: imageHash,
                    message: copy.primaryText,
                    title: copy.headline,
                    call_to_action: {
                      type: "SHOP_NOW",
                      value: { link: landingUrl },
                    },
                  },
                },
              }),
            { creativeId: c.id, angle },
          )
          metaCreativeId = result.id
          logger.info(`creative_${i.toString()}_done`, {
            creativeId: c.id,
            metaCreativeId,
          })
        } catch (err) {
          throwLaunchError(err, "generic_fallback", "Falló la creación del creative en Meta.")
        }

        let metaAdId: string
        try {
          const result = await withTiming(
            "task.launch.ad_create",
            () =>
              adCreate(creds, {
                adset_id: broadAdsetId,
                creative_id: metaCreativeId,
                name: `A-${angle}`,
                status: "PAUSED",
              }),
            { creativeId: c.id, angle },
          )
          metaAdId = result.id
          logger.info(`ad_${i.toString()}_done`, {
            creativeId: c.id,
            metaAdId,
          })
        } catch (err) {
          throwLaunchError(err, "generic_fallback", "Falló la creación del ad en Meta.")
        }

        await withUser(userId, async (db) => {
          await db.insert(ads).values({
            campaignId: campaignRow.id,
            userId,
            creativeId: c.id,
            metaAdId,
            primaryText: copy.primaryText,
            headline: copy.headline,
            description: copy.description,
            ctaType: "SHOP_NOW",
            copyJson: copy,
          })
        })
        metadata.increment("adsCreated", 1)
        adCount += 1
      }

      // 10. Mark product as launched.
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "CAMPAIGN_LAUNCHED" })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })

      // 11. Surface the Ads Manager deep-link in metadata so the UI can render
      // a CTA on completion. We always have `metaCampaignId`; `act={…}` is
      // included whenever the integration carries an `ad_account_id`. Without
      // it, Meta resolves the campaign against the user's currently active
      // business — still a valid (just less specific) deep link.
      const adAccountId = creds.ad_account_id
      const adsManagerUrl =
        adAccountId.length > 0
          ? `https://business.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(adAccountId)}&selected_campaign_ids=${encodeURIComponent(metaCampaignId)}`
          : `https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${encodeURIComponent(metaCampaignId)}`
      metadata.set("adsManagerUrl", adsManagerUrl)

      const result: LaunchResult = {
        campaignId: campaignRow.id,
        metaCampaignId,
        adCount,
      }
      logger.info("complete", { ...result })
      return result
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logError("task.launch.fatal", { productId, userId, attempt, reason })
      await markProductFailed(userId, productId, reason, "launch-crashed")
      if (err instanceof Error && parseTaskErrorPayload(err.message) !== null) {
        throw err
      }
      launchError("generic_fallback", reason)
    }
  },
})
