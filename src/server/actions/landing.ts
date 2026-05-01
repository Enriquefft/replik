"use server"

import { tasks } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { products } from "@/db/schema"
import { IntegrationMissingError, requireIntegration } from "@/server/integrations"
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
export async function publishLanding(rawInput: unknown): Promise<ActionResult<{ runId: string }>> {
  const parsed = PublishLandingInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    }
  }
  const { productId, templateId, bundle2PricingCents, bundle3PricingCents, overrides } = parsed.data

  const { userId } = await requireUser()

  // Verify product belongs to user, then persist bundle prices set in the
  // landing UI so the trigger task and downstream surfaces (launch page, copy
  // gen) read consistent values from the DB.
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

  // Gate on Shopify integration. We do not need Meta to publish a landing —
  // pixel_id is injected when present, otherwise empty string at render time.
  try {
    await requireIntegration(userId, "shopify")
  } catch (err) {
    if (err instanceof IntegrationMissingError) {
      return { ok: false, needs: "shopify" }
    }
    throw err
  }

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

  const handle = await tasks.trigger<typeof publishLandingTask>("publishLanding", {
    productId,
    userId,
    ...(templateId !== undefined && { templateId }),
    ...(overridesPayload !== undefined && { overrides: overridesPayload }),
  })

  return { ok: true, data: { runId: handle.id } }
}
