import "server-only"

import { logger, metadata, task } from "@trigger.dev/sdk"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { withUser } from "@/db/client"
import { ads, campaigns, metrics, products } from "@/db/schema"
import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import { insightsGet, type MetaCreds } from "@/lib/meta"
import { MetaError } from "@/lib/meta/types"
import { requireIntegration } from "@/server/integrations"
import { syncInsightsError } from "./errors.ts"
import type { SyncInsightsErrorCode, SyncInsightsPhase } from "./metadata.ts"

/**
 * Map a thrown `MetaError` to one of our `SyncInsightsErrorCode` values.
 * Mirrors the launch-side mapping: code 190 = token expired, 4/17/32/613
 * = rate / throttling, everything else surfaces as `meta_api_failure`.
 */
function metaErrorToSyncCode(err: MetaError): SyncInsightsErrorCode {
  if (err.code === 190) return "meta_token_expired"
  if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) {
    return "meta_quota"
  }
  return "meta_api_failure"
}

export interface SyncInsightsPayload {
  userId: string
}

export interface SyncInsightsResult {
  adsRefreshed: number
  metricsUpserted: number
}

/**
 * Replace existing metric row for `(adId, date)` with the freshly fetched
 * insight values. Neon HTTP does not support multi-statement transactions,
 * so we run a sequential `DELETE` then `INSERT` inside `withUser`. Each
 * `(adId, date)` pair is independently authored and never concurrently
 * mutated, so the lack of atomicity is acceptable.
 */
async function upsertMetric(
  userId: string,
  values: {
    adId: string
    date: Date
    spendCents: number
    results: number
    cpaCents: number | null
    impressions: number
    ctr: string | null
    roas: string | null
  },
): Promise<void> {
  await withUser(userId, async (db) => {
    await db
      .delete(metrics)
      .where(
        and(
          eq(metrics.userId, userId),
          eq(metrics.adId, values.adId),
          eq(metrics.date, values.date),
        ),
      )
    await db.insert(metrics).values({
      userId,
      adId: values.adId,
      date: values.date,
      spendCents: values.spendCents,
      results: values.results,
      cpaCents: values.cpaCents,
      impressions: values.impressions,
      ctr: values.ctr,
      roas: values.roas,
    })
  })
}

export const syncInsights = task({
  id: "sync-insights",
  machine: { preset: "small-1x" },
  maxDuration: 300,
  run: async (payload: SyncInsightsPayload): Promise<SyncInsightsResult> => {
    const { userId } = payload

    try {
      // 1. Active campaigns with a Meta ID.
      metadata.set("phase", "loading" satisfies SyncInsightsPhase)
      const activeCampaigns = await withUser(userId, async (db) =>
        db
          .select({ id: campaigns.id, productId: campaigns.productId })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.userId, userId),
              inArray(campaigns.status, ["PAUSED", "ACTIVE"] as const),
              isNotNull(campaigns.metaCampaignId),
            ),
          ),
      )
      logger.info("load_campaigns", { count: activeCampaigns.length })
      if (activeCampaigns.length === 0) {
        return { adsRefreshed: 0, metricsUpserted: 0 }
      }
      const campaignIds = activeCampaigns.map((c) => c.id)

      // 2. Meta credentials.
      const integration = await requireIntegration(userId, "meta")
      if (integration.extra.provider !== "meta") {
        syncInsightsError("generic_fallback", "syncInsights: integration extra is not meta")
      }
      const creds: MetaCreds = {
        token: integration.token,
        ad_account_id: integration.extra.ad_account_id,
        page_id: integration.extra.page_id,
        pixel_id: integration.extra.pixel_id,
      }

      // 3. Ads under those campaigns with their owning product.
      const adRows = await withUser(userId, async (db) =>
        db
          .select({
            id: ads.id,
            metaAdId: ads.metaAdId,
            campaignId: ads.campaignId,
          })
          .from(ads)
          .where(
            and(
              eq(ads.userId, userId),
              inArray(ads.campaignId, campaignIds),
              isNotNull(ads.metaAdId),
            ),
          ),
      )
      logger.info("load_ads", { count: adRows.length })
      if (adRows.length === 0) {
        return { adsRefreshed: 0, metricsUpserted: 0 }
      }

      // 4. Resolve product names for the active campaigns so the UI can show
      // "Sincronizando 3 de 7 productos · Nike Pegasus" in detailSlot.
      const productIds = [...new Set(activeCampaigns.map((c) => c.productId))]
      const productRows = await withUser(userId, async (db) =>
        db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.userId, userId), inArray(products.id, productIds))),
      )
      const productNameById = new Map(productRows.map((p) => [p.id, p.name ?? "Producto"]))
      const productIdByCampaignId = new Map(activeCampaigns.map((c) => [c.id, c.productId]))

      // narrow to non-null metaAdId and group by product
      const adsWithMetaId = adRows.flatMap((a) =>
        a.metaAdId
          ? [
              {
                id: a.id,
                metaAdId: a.metaAdId,
                productId: productIdByCampaignId.get(a.campaignId) ?? null,
              },
            ]
          : [],
      )
      const metaAdIds = adsWithMetaId.map((a) => a.metaAdId)

      // 5. Fetch insights for last 7 days.
      metadata.set("phase", "fetching" satisfies SyncInsightsPhase)
      logger.info("meta_call_started", { ids: metaAdIds.length })
      const insights = await insightsGet(creds, {
        level: "ad",
        ids: metaAdIds,
        date_preset: "last_7d",
      })
      logger.info("meta_call_done", { received: insights.length })

      // 6. Upsert metric rows, grouped per product so the UI can emit
      //    "Sincronizando X de Y · NAME" progress as we step through.
      metadata.set("phase", "upserting" satisfies SyncInsightsPhase)
      const orderedProductIds = productIds
      const totalProducts = orderedProductIds.length
      metadata.set("product", { done: 0, total: totalProducts })

      const adsByProduct = new Map<string, typeof adsWithMetaId>()
      for (const a of adsWithMetaId) {
        if (a.productId === null) continue
        const bucket = adsByProduct.get(a.productId) ?? []
        bucket.push(a)
        adsByProduct.set(a.productId, bucket)
      }
      const adByMetaId = new Map(adsWithMetaId.map((a) => [a.metaAdId, a.id]))

      let metricsUpserted = 0
      let productsDone = 0
      for (const productId of orderedProductIds) {
        const productName = productNameById.get(productId) ?? "Producto"
        // Emit "currently working on item N" semantics — `done` is the count
        // of products being acted on inclusively (1-based). This matches the
        // UI string "Sincronizando N de M productos · NAME". The
        // post-iteration emit below resets `done` to the completed count
        // (`productsDone + 1` after the increment), which equals N after
        // the last item lands.
        metadata.set("product", {
          current: productId,
          currentName: productName,
          done: productsDone + 1,
          total: totalProducts,
        })

        const productAds = adsByProduct.get(productId) ?? []
        const productMetaAdIdSet = new Set(productAds.map((a) => a.metaAdId))
        for (const insight of insights) {
          if (!productMetaAdIdSet.has(insight.object_id)) continue
          const adId = adByMetaId.get(insight.object_id)
          if (!adId) continue
          const date = new Date(`${insight.date_start}T00:00:00Z`)
          if (Number.isNaN(date.getTime())) continue
          await upsertMetric(userId, {
            adId,
            date,
            spendCents: insight.spend_cents,
            results: insight.results,
            cpaCents: insight.cpa_cents ?? null,
            impressions: insight.impressions,
            ctr: typeof insight.ctr === "number" ? insight.ctr.toString() : null,
            roas: typeof insight.roas === "number" ? insight.roas.toString() : null,
          })
          metricsUpserted += 1
        }
        productsDone += 1
        metadata.set("product", {
          current: productId,
          currentName: productName,
          done: productsDone,
          total: totalProducts,
        })
      }
      logger.info("upsert_done", { metricsUpserted })

      const result: SyncInsightsResult = {
        adsRefreshed: adsWithMetaId.length,
        metricsUpserted,
      }
      logger.info("complete", { ...result })
      return result
    } catch (err) {
      if (err instanceof Error && parseTaskErrorPayload(err.message) !== null) {
        throw err
      }
      if (err instanceof MetaError) {
        const code = metaErrorToSyncCode(err)
        syncInsightsError(code, err.friendly.length > 0 ? err.friendly : err.message)
      }
      const reason = err instanceof Error ? err.message : String(err)
      syncInsightsError("generic_fallback", reason)
    }
  },
})
