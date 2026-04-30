import "server-only";

import { logger, task } from "@trigger.dev/sdk";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withUser } from "@/db/client";
import { ads, campaigns, metrics } from "@/db/schema";
import { insightsGet, type MetaCreds } from "@/lib/meta";
import { requireIntegration } from "@/server/integrations";

export interface SyncInsightsPayload {
  userId: string;
}

export interface SyncInsightsResult {
  adsRefreshed: number;
  metricsUpserted: number;
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
    adId: string;
    date: Date;
    spendCents: number;
    results: number;
    cpaCents: number | null;
    impressions: number;
    ctr: string | null;
    roas: string | null;
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
      );
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
    });
  });
}

export const syncInsights = task({
  id: "sync-insights",
  machine: { preset: "small-1x" },
  maxDuration: 300,
  run: async (payload: SyncInsightsPayload): Promise<SyncInsightsResult> => {
    const { userId } = payload;

    // 1. Active campaigns with a Meta ID.
    const activeCampaigns = await withUser(userId, async (db) =>
      db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.userId, userId),
            inArray(campaigns.status, ["PAUSED", "ACTIVE"] as const),
            isNotNull(campaigns.metaCampaignId),
          ),
        ),
    );
    logger.info("load_campaigns", { count: activeCampaigns.length });
    if (activeCampaigns.length === 0) {
      return { adsRefreshed: 0, metricsUpserted: 0 };
    }
    const campaignIds = activeCampaigns.map((c) => c.id);

    // 2. Meta credentials.
    const integration = await requireIntegration(userId, "meta");
    if (integration.extra.provider !== "meta") {
      throw new Error("syncInsights: integration extra is not meta");
    }
    const creds: MetaCreds = {
      token: integration.token,
      ad_account_id: integration.extra.ad_account_id,
      page_id: integration.extra.page_id,
      pixel_id: integration.extra.pixel_id,
    };

    // 3. Ads under those campaigns with a Meta ID.
    const adRows = await withUser(userId, async (db) =>
      db
        .select({ id: ads.id, metaAdId: ads.metaAdId })
        .from(ads)
        .where(
          and(
            eq(ads.userId, userId),
            inArray(ads.campaignId, campaignIds),
            isNotNull(ads.metaAdId),
          ),
        ),
    );
    logger.info("load_ads", { count: adRows.length });
    if (adRows.length === 0) {
      return { adsRefreshed: 0, metricsUpserted: 0 };
    }

    // narrow to non-null metaAdId
    const adsWithMetaId = adRows.flatMap((a) =>
      a.metaAdId ? [{ id: a.id, metaAdId: a.metaAdId }] : [],
    );
    const metaAdIds = adsWithMetaId.map((a) => a.metaAdId);

    // 4. Fetch insights for last 7 days.
    logger.info("meta_call_started", { ids: metaAdIds.length });
    const insights = await insightsGet(creds, {
      level: "ad",
      ids: metaAdIds,
      date_preset: "last_7d",
    });
    logger.info("meta_call_done", { received: insights.length });

    // 5. Upsert one metric row per (adId, date_start).
    const adByMetaId = new Map(adsWithMetaId.map((a) => [a.metaAdId, a.id]));
    let metricsUpserted = 0;
    for (const insight of insights) {
      const adId = adByMetaId.get(insight.object_id);
      if (!adId) continue;
      const date = new Date(`${insight.date_start}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      await upsertMetric(userId, {
        adId,
        date,
        spendCents: insight.spend_cents,
        results: insight.results,
        cpaCents: insight.cpa_cents ?? null,
        impressions: insight.impressions,
        ctr: typeof insight.ctr === "number" ? insight.ctr.toString() : null,
        roas: typeof insight.roas === "number" ? insight.roas.toString() : null,
      });
      metricsUpserted += 1;
    }
    logger.info("upsert_done", { metricsUpserted });

    const result: SyncInsightsResult = {
      adsRefreshed: adsWithMetaId.length,
      metricsUpserted,
    };
    logger.info("complete", { ...result });
    return result;
  },
});
