import "server-only";

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

import { schemaTask, logger } from "@trigger.dev/sdk";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import {
  ads,
  assets,
  campaigns,
  creatives,
  idempotencyKeys,
  products,
} from "@/db/schema";
import { generateCopies } from "@/lib/copy/generate";
import {
  type MetaCreds,
  adCreate,
  adsetCreate,
  campaignCreate,
  creativeCreate,
  imageUpload,
  videoUploadResumable,
} from "@/lib/meta";
import { interestsFor, type InterestCategory } from "@/lib/meta/interests";
import { getIntegration, requireIntegration } from "@/server/integrations";

const Payload = z.object({
  productId: z.string().min(1),
  userId: z.string().min(1),
  attempt: z.number().int().positive(),
});

export interface LaunchResult {
  campaignId: string;
  metaCampaignId: string;
  adCount: number;
}

const KNOWN_INTEREST_CATEGORIES: ReadonlySet<InterestCategory> = new Set([
  "home_garden",
  "beauty",
  "fitness",
  "kitchen",
  "pets",
] as const);

function asInterestCategory(category: string | null): InterestCategory | null {
  if (!category) return null;
  return KNOWN_INTEREST_CATEGORIES.has(category as InterestCategory)
    ? (category as InterestCategory)
    : null;
}

interface FriendlyError {
  friendly: string;
  cause: unknown;
}

function toFriendly(err: unknown, fallback: string): FriendlyError {
  if (err && typeof err === "object" && "friendly" in err) {
    const f = (err as { friendly?: unknown }).friendly;
    if (typeof f === "string" && f.length > 0) {
      return { friendly: f, cause: err };
    }
  }
  if (err instanceof Error && err.message) {
    return { friendly: err.message, cause: err };
  }
  return { friendly: fallback, cause: err };
}

class LaunchError extends Error {
  constructor(friendly: string, cause?: unknown) {
    super(friendly);
    this.name = "LaunchError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export const launchCampaign = schemaTask({
  id: "launchCampaign",
  schema: Payload,
  machine: { preset: "medium-1x" },
  maxDuration: 900,
  run: async (payload): Promise<LaunchResult> => {
    const { productId, userId, attempt } = payload;
    const idempotencyKey = `launch_${userId}_${productId}_${attempt.toString()}`;

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
        .returning({ key: idempotencyKeys.key });
      return inserted.length > 0;
    });
    logger.info("idempotency_check", { idempotencyKey, claimed });
    if (!claimed) {
      const existing = await withUser(userId, async (db) => {
        const campRows = await db
          .select({
            id: campaigns.id,
            metaCampaignId: campaigns.metaCampaignId,
          })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.userId, userId),
              eq(campaigns.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        const camp = campRows[0];
        if (!camp?.metaCampaignId) return null;
        const adRows = await db
          .select({ id: ads.id })
          .from(ads)
          .where(eq(ads.campaignId, camp.id));
        return {
          campaignId: camp.id,
          metaCampaignId: camp.metaCampaignId,
          adCount: adRows.length,
        };
      });
      if (existing) {
        logger.info("complete", { ...existing, replayed: true });
        return existing;
      }
      // Idempotency row exists but the campaign row doesn't yet — a previous
      // attempt crashed mid-flight. Surface a friendly error: a fresh attempt
      // (incremented `attempt`) is the safe path forward.
      throw new LaunchError(
        "Lanzamiento previo quedó incompleto. Reintenta para crear un nuevo intento.",
      );
    }

    // 2. Load product, selected creatives + their edited_video assets.
    const loaded = await withUser(userId, async (db) => {
      const prodRows = await db
        .select({
          id: products.id,
          name: products.name,
          imageUrl: products.imageUrl,
          category: products.category,
          shopifyPageHandle: products.shopifyPageHandle,
        })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.userId, userId)))
        .limit(1);
      const product = prodRows[0];
      if (!product) return null;
      const creativeRows = await db
        .select({
          id: creatives.id,
          angle: creatives.angle,
          transcript: creatives.transcriptText,
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
        );
      return { product, creatives: creativeRows };
    });
    if (!loaded) {
      throw new LaunchError("Producto no encontrado.");
    }
    const { product, creatives: selected } = loaded;
    if (selected.length === 0) {
      throw new LaunchError("No hay creativos editados listos.");
    }
    if (!product.imageUrl) {
      throw new LaunchError("El producto no tiene imagen para el thumbnail.");
    }
    const productName = product.name ?? "Producto";

    // 3. Build creds (Meta required, Shopify optional but expected).
    const metaIntegration = await requireIntegration(userId, "meta");
    if (
      metaIntegration.extra.provider !== "meta" ||
      !metaIntegration.extra.pixel_id
    ) {
      throw new LaunchError("Integración Meta incompleta (falta pixel).");
    }
    const creds: MetaCreds = {
      token: metaIntegration.token,
      ad_account_id: metaIntegration.extra.ad_account_id,
      page_id: metaIntegration.extra.page_id,
      pixel_id: metaIntegration.extra.pixel_id,
      userId,
    };
    const pageId = metaIntegration.extra.page_id;
    const pixelId = metaIntegration.extra.pixel_id;

    // Resolve landing URL — Shopify integration should already exist (publish
    // precedes launch in the user flow). If absent, fall back to example.com
    // so the wrapper still has a valid CTA link, then fail loudly when there
    // is also no shopifyPageHandle to point at.
    const shopifyIntegration = await getIntegration(userId, "shopify");
    const shopDomain =
      shopifyIntegration?.extra.provider === "shopify"
        ? shopifyIntegration.extra.shop_domain
        : null;
    const pageHandle = product.shopifyPageHandle;
    if (!pageHandle) {
      throw new LaunchError(
        "Publica la landing antes de lanzar la campaña.",
      );
    }
    const landingUrl = shopDomain
      ? `https://${shopDomain}/pages/${pageHandle}`
      : `https://example.com/${pageHandle}`;

    // 4. Copy generation — single batched LLM call.
    const copies = await generateCopies({
      productName,
      category: product.category,
      creatives: selected.map((c) => ({
        id: c.id,
        angle: c.angle,
        transcript: c.transcript,
      })),
    });
    logger.info("copy_generation_done", { count: copies.size });

    // 5. Sequential video uploads (Meta requires per-video resumable flow).
    const videoIds = new Map<string, string>();
    for (const c of selected) {
      try {
        const result = await videoUploadResumable(creds, {
          url: c.assetUrl,
          sizeBytes: c.assetBytes ?? 0,
          filename: `${c.id}.mp4`,
        });
        videoIds.set(c.id, result.video_id);
        logger.info("video_upload_progress", {
          creativeId: c.id,
          videoId: result.video_id,
          uploaded: videoIds.size,
          total: selected.length,
        });
      } catch (err) {
        const f = toFriendly(err, "Falló la subida de video a Meta.");
        throw new LaunchError(f.friendly, f.cause);
      }
    }

    // 6. Image upload (thumbnail).
    let imageHash: string;
    try {
      const result = await imageUpload(creds, {
        url: product.imageUrl,
        filename: "thumb.jpg",
      });
      imageHash = result.image_hash;
      logger.info("image_upload_done", { imageHash });
    } catch (err) {
      const f = toFriendly(err, "Falló la subida del thumbnail a Meta.");
      throw new LaunchError(f.friendly, f.cause);
    }

    // 7. Campaign create + persist row.
    let metaCampaignId: string;
    try {
      const result = await campaignCreate(creds, {
        name: `Replik — ${productName}`,
        objective: "OUTCOME_SALES",
        status: "PAUSED",
        daily_budget_cents: 5000,
        special_ad_categories: [],
      });
      metaCampaignId = result.id;
    } catch (err) {
      const f = toFriendly(err, "Falló la creación de la campaña en Meta.");
      throw new LaunchError(f.friendly, f.cause);
    }
    const campaignRow = await withUser(userId, async (db) => {
      const inserted = await db
        .insert(campaigns)
        .values({
          productId,
          userId,
          metaCampaignId,
          structure: "CBO",
          budgetDailyCents: 5000,
          status: "PAUSED",
          idempotencyKey,
          launchedAt: sql`now()`,
        })
        .returning({ id: campaigns.id });
      const row = inserted[0];
      if (!row) {
        throw new LaunchError("No se pudo persistir la campaña.");
      }
      return row;
    });
    logger.info("campaign_created", {
      campaignId: campaignRow.id,
      metaCampaignId,
    });

    // 8. AdSets — broad always, interest-targeted optionally.
    const adsetIds: string[] = [];
    try {
      const broad = await adsetCreate(creds, {
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
      });
      adsetIds.push(broad.id);
      logger.info("adset_created", { adsetId: broad.id, kind: "broad" });

      const interestCategory = asInterestCategory(product.category);
      if (interestCategory) {
        const interests = interestsFor(interestCategory);
        const detailed = await adsetCreate(creds, {
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
        });
        adsetIds.push(detailed.id);
        logger.info("adset_created", {
          adsetId: detailed.id,
          kind: "detailed",
          category: interestCategory,
        });
      }
    } catch (err) {
      const f = toFriendly(err, "Falló la creación del ad set en Meta.");
      throw new LaunchError(f.friendly, f.cause);
    }
    const broadAdsetId = adsetIds[0];
    if (!broadAdsetId) {
      throw new LaunchError("No se creó ningún ad set.");
    }

    // 9. Per creative: creative + ad + persist `ads` row.
    let adCount = 0;
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      if (!c) continue;
      const copy = copies.get(c.id);
      const videoId = videoIds.get(c.id);
      if (!copy || !videoId) {
        throw new LaunchError(
          `Estado interno inconsistente para creativo ${c.id}.`,
        );
      }
      const angle = c.angle ?? "default";

      let metaCreativeId: string;
      try {
        const result = await creativeCreate(creds, {
          name: `C-${c.id}-${angle}`,
          object_story_spec: {
            page_id: pageId,
            video_data: {
              video_id: videoId,
              image_hash: imageHash,
              message: copy.primary_text,
              title: copy.headline,
              call_to_action: {
                type: "SHOP_NOW",
                value: { link: landingUrl },
              },
            },
          },
        });
        metaCreativeId = result.id;
        logger.info(`creative_${i.toString()}_done`, {
          creativeId: c.id,
          metaCreativeId,
        });
      } catch (err) {
        const f = toFriendly(err, "Falló la creación del creative en Meta.");
        throw new LaunchError(f.friendly, f.cause);
      }

      let metaAdId: string;
      try {
        const result = await adCreate(creds, {
          adset_id: broadAdsetId,
          creative_id: metaCreativeId,
          name: `A-${angle}`,
          status: "PAUSED",
        });
        metaAdId = result.id;
        logger.info(`ad_${i.toString()}_done`, {
          creativeId: c.id,
          metaAdId,
        });
      } catch (err) {
        const f = toFriendly(err, "Falló la creación del ad en Meta.");
        throw new LaunchError(f.friendly, f.cause);
      }

      await withUser(userId, async (db) => {
        await db.insert(ads).values({
          campaignId: campaignRow.id,
          userId,
          creativeId: c.id,
          metaAdId,
          primaryText: copy.primary_text,
          headline: copy.headline,
          description: copy.description,
          ctaType: "SHOP_NOW",
          copyJson: copy,
        });
      });
      adCount += 1;
    }

    // 10. Mark product as launched.
    await withUser(userId, async (db) => {
      await db
        .update(products)
        .set({ status: "CAMPAIGN_LAUNCHED" })
        .where(and(eq(products.id, productId), eq(products.userId, userId)));
    });

    const result: LaunchResult = {
      campaignId: campaignRow.id,
      metaCampaignId,
      adCount,
    };
    logger.info("complete", { ...result });
    return result;
  },
});
