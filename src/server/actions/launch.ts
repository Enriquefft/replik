"use server"

/**
 * Owner: Lane L4b (Launch).
 *
 * Server Action entry-point for "lanzar campaña". Its job is to (1) verify
 * the Meta integration is connected and complete (token + ad_account_id +
 * page_id + pixel_id), (2) verify the product belongs to the caller and has
 * at least one selected creative with an edited video asset, (3) compute a
 * fresh `attempt` number for the idempotency key, and (4) hand off the heavy
 * orchestration to the `launchCampaign` Trigger.dev task.
 *
 * Failure shape `{ ok:false, needs:'meta'|'shopify' }` matches the JIT modal
 * contract used by `saveIntegration` so the UI can pop the connect modal
 * without bespoke error plumbing.
 */

import { tasks } from "@trigger.dev/sdk"
import { and, eq, like, sql } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys, products } from "@/db/schema"
import { logEvent, withTiming } from "@/lib/observability/log.ts"
import { IntegrationMissingError, requireIntegration } from "@/server/integrations"
import type { launchCampaign as launchCampaignTask } from "@/server/trigger/launchCampaign"

export type LaunchResult =
  | { ok: true; data: { runId: string } }
  | { ok: false; needs: "meta" | "shopify"; error?: string }

const LaunchInput = z.object({
  productId: z.uuid(),
  budgetDailyCents: z.number().int().positive(),
})

export type LaunchInput = z.infer<typeof LaunchInput>

export async function launchCampaign(rawInput: unknown): Promise<LaunchResult> {
  const parsed = LaunchInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      needs: "meta",
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    }
  }
  const { productId, budgetDailyCents } = parsed.data

  const { userId } = await requireUser()

  return withTiming(
    "action.launch.start",
    async (): Promise<LaunchResult> => {
      // 1. Meta integration must exist and be fully configured (incl. pixel).
      let meta: Awaited<ReturnType<typeof requireIntegration>>
      try {
        meta = await requireIntegration(userId, "meta")
      } catch (err) {
        if (err instanceof IntegrationMissingError) {
          return { ok: false, needs: "meta" }
        }
        throw err
      }
      if (meta.extra.provider !== "meta" || !meta.extra.pixel_id) {
        return {
          ok: false,
          needs: "meta",
          error: "Falta el pixel en la integración Meta.",
        }
      }

      // 2. Product belongs to caller + ≥1 selected creative w/ edited_video.
      const ready = await withUser(userId, async (db) => {
        const productRows = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        if (productRows.length === 0) {
          return { ownsProduct: false, hasCreative: false }
        }
        const creativeRows = await db
          .select({ id: creatives.id })
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
          .limit(1)
        return { ownsProduct: true, hasCreative: creativeRows.length > 0 }
      })
      if (!ready.ownsProduct) {
        return { ok: false, needs: "meta", error: "Producto no encontrado." }
      }
      if (!ready.hasCreative) {
        return {
          ok: false,
          needs: "meta",
          error: "No hay creativos editados listos.",
        }
      }

      // 3. Compute next attempt by counting prior idempotency rows.
      const attempt = await withUser(userId, async (db) => {
        const rows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              like(idempotencyKeys.key, `launch_${userId}_${productId}_%`),
            ),
          )
        const prior = rows[0]?.count ?? 0
        return prior + 1
      })

      // 4. Fire-and-forget the durable launch task.
      const handle = await tasks.trigger<typeof launchCampaignTask>("launchCampaign", {
        productId,
        userId,
        attempt,
        budgetDailyCents,
      })

      logEvent("action.launch.triggered", {
        productId,
        runId: handle.id,
        attempt,
      })

      return { ok: true, data: { runId: handle.id } }
    },
    { productId, budgetDailyCents },
  )
}
