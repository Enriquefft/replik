"use server"

import { auth, tasks } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products } from "@/db/schema"
import { logEvent, withTiming } from "@/lib/observability/log.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import { IntegrationMissingError, requireIntegration } from "@/server/integrations"
import { recordTaskStart } from "@/server/telemetry/task-runs.ts"
import type { publishLandingTask } from "@/server/trigger/publishLanding"
import type { ActionResult } from "./types.ts"

const PublishLandingInput = z.object({
  productId: z.uuid(),
  templateId: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  bundle2PricingCents: z.number().int().positive(),
  bundle3PricingCents: z.number().int().positive(),
  overrides: z
    .object({
      headline: z.string().max(120).optional(),
      subheadline: z.string().max(180).optional(),
    })
    .optional(),
})

export type PublishLandingInput = z.infer<typeof PublishLandingInput>

/**
 * JIT credential gate + run trigger for the publishLanding pipeline.
 * Returns `{ ok:false, needs:'shopify' }` when the user has no Shopify
 * integration so the client can mount `<CredentialsModal provider="shopify"/>`.
 */
export async function publishLanding(
  rawInput: unknown,
): Promise<ActionResult<{ runId: string; accessToken: string }>> {
  const parsed = PublishLandingInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    }
  }
  const { productId, templateId, bundle2PricingCents, bundle3PricingCents, overrides } = parsed.data

  const { userId } = await requireUser()

  return withTiming(
    "action.landing.publish",
    async (): Promise<ActionResult<{ runId: string; accessToken: string }>> => {
      // 1. Verify product belongs to user and has valid status for publishing.
      // SCRAPE_EMPTY products cannot be published. Must be READY or SCRAPE_PARTIAL
      // (with at least basic metadata).
      const productCheck = await withUser(userId, async (db) => {
        const rows = await db
          .select({ id: products.id, status: products.status })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        return rows[0]
      })
      if (!productCheck) {
        return { ok: false, error: "Producto no encontrado." }
      }
      if (productCheck.status === "SCRAPE_EMPTY") {
        return {
          ok: false,
          error: "No se puede publicar un producto sin datos. Reintenta el análisis.",
        }
      }
      const validStatuses = ["READY", "SCRAPE_PARTIAL", "LANDING_PUBLISHED", "CAMPAIGN_LAUNCHED"]
      if (!validStatuses.includes(productCheck.status)) {
        return {
          ok: false,
          error: "El producto aún se está analizando. Espera a que termine.",
        }
      }

      // 2. Persist bundle prices set in the landing UI so the trigger task and
      // downstream surfaces (launch page, copy gen) read consistent values from the DB.
      const owned = await withUser(userId, async (db) => {
        const rows = await db
          .update(products)
          .set({
            bundle2PricingCents,
            bundle3PricingCents,
          })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .returning({ id: products.id })
        return rows[0]
      })
      if (!owned) {
        return { ok: false, error: "Producto no encontrado." }
      }

      // 2b. Gate on burn completion. Every selected creative must have a
      // persisted edited_video asset; otherwise we'd publish with a partial
      // video CSV silently. rehostCreatives uses batchTriggerAndWait on burn,
      // so this only fires while the burn batch is still running.
      const burnGate = await withUser(userId, async (db) => {
        const selectedRows = await db
          .select({ id: creatives.id })
          .from(creatives)
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
              eq(creatives.selectedBool, true),
            ),
          )
        const selectedIds = selectedRows.map((r) => r.id)
        if (selectedIds.length === 0) return { selected: 0, edited: 0 }
        const editedRows = await db
          .select({ ownerId: assets.ownerId })
          .from(assets)
          .where(
            and(
              eq(assets.ownerType, "creative"),
              eq(assets.kind, "edited_video"),
              inArray(assets.ownerId, selectedIds),
            ),
          )
        return { selected: selectedIds.length, edited: editedRows.length }
      })
      if (burnGate.selected === 0) {
        return { ok: false, error: "Selecciona al menos un creativo antes de publicar." }
      }
      if (burnGate.edited < burnGate.selected) {
        return {
          ok: false,
          error: `Aún editando los videos (${burnGate.edited.toString()}/${burnGate.selected.toString()}). Espera a que terminen para publicar.`,
        }
      }

      // 3. Gate on Shopify integration. We do not need Meta to publish a landing —
      // pixel_id is injected when present, otherwise empty string at render time.
      try {
        await requireIntegration(userId, "shopify")
      } catch (err) {
        if (err instanceof IntegrationMissingError) {
          return { ok: false, needs: "shopify" }
        }
        throw err
      }

      // 4. Prepare overrides payload.
      const overridesPayload =
        overrides === undefined
          ? undefined
          : {
              ...(overrides.headline !== undefined && {
                headline: overrides.headline,
              }),
              ...(overrides.subheadline !== undefined && {
                subheadline: overrides.subheadline,
              }),
            }

      // 5. Trigger publishLanding task. Tagged with `productTag` so the
      // JobsDock realtime subscription can pick it up under the
      // user-scoped public token without needing the runId up-front.
      const handle = await tasks.trigger<typeof publishLandingTask>(
        "publishLanding",
        {
          productId,
          userId,
          ...(templateId !== undefined && { templateId }),
          ...(overridesPayload !== undefined && { overrides: overridesPayload }),
        },
        { tags: [productTag(toProductId(productId))] },
      )

      await recordTaskStart({
        triggerRunId: handle.id,
        userId,
        productId,
        kind: "publish_landing",
      })

      const accessToken = await auth.createPublicToken({
        scopes: { read: { runs: [handle.id] } },
        expirationTime: "1h",
      })

      logEvent("action.landing.publish.triggered", {
        productId,
        runId: handle.id,
        templateId,
      })

      return { ok: true, data: { runId: handle.id, accessToken } }
    },
    { productId },
  )
}
