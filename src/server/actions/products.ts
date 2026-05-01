"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { tasks } from "@trigger.dev/sdk"
import { generateText } from "ai"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products, users } from "@/db/schema"
import { type ProductId, toProductId } from "@/lib/types/ids.ts"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs"
import type { ActionResult } from "./types.ts"

const CreateProductInput = z.object({
  source_url: z.url("URL inválida"),
  pricing_cents: z.number().int().positive(),
  bundle_2_pricing_cents: z.number().int().positive(),
  bundle_3_pricing_cents: z.number().int().positive(),
  whatsapp_number: z.string().min(7).optional(),
})

export type CreateProductInput = z.infer<typeof CreateProductInput>

export async function createProduct(rawInput: unknown): Promise<ActionResult<{ id: ProductId }>> {
  const parsed = CreateProductInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    }
  }

  const { userId } = await requireUser()
  const input = parsed.data

  return withUser(userId, async (db) => {
    if (input.whatsapp_number) {
      await db
        .update(users)
        .set({ whatsappNumber: input.whatsapp_number })
        .where(eq(users.id, userId))
    }

    const inserted = await db
      .insert(products)
      .values({
        userId,
        sourceUrl: input.source_url,
        pricingCents: input.pricing_cents,
        bundle2PricingCents: input.bundle_2_pricing_cents,
        bundle3PricingCents: input.bundle_3_pricing_cents,
        status: "SCRAPING",
      })
      .returning({ id: products.id })

    const row = inserted[0]
    if (!row) {
      return { ok: false, error: "No se pudo crear el producto." }
    }

    const productId = toProductId(row.id)

    try {
      await tasks.trigger<typeof scrapeProduct>("scrape-product", {
        productId: row.id,
        userId,
        competitorUrl: input.source_url,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al iniciar el análisis."
      return { ok: false, error: message }
    }

    return { ok: true, data: { id: productId } }
  })
}

export type CreativeWithAssets = typeof creatives.$inferSelect & {
  assets: (typeof assets.$inferSelect)[]
}

export async function getCreatives(
  rawProductId: unknown,
): Promise<ActionResult<CreativeWithAssets[]>> {
  const productIdParsed = z.uuid().safeParse(rawProductId)
  if (!productIdParsed.success) {
    return { ok: false, error: "ID de producto inválido." }
  }
  const productId = productIdParsed.data

  const { userId } = await requireUser()

  return withUser(userId, async (db) => {
    const creativeRows = await db
      .select()
      .from(creatives)
      .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))

    const result: CreativeWithAssets[] = await Promise.all(
      creativeRows.map(async (creative) => {
        const assetRows = await db
          .select()
          .from(assets)
          .where(and(eq(assets.ownerType, "creative"), eq(assets.ownerId, creative.id)))
        return { ...creative, assets: assetRows }
      }),
    )

    return { ok: true, data: result }
  })
}

const SelectCreativesInput = z.object({
  productId: z.uuid(),
  creativeIds: z.array(z.uuid()).min(1),
})

export async function selectCreatives(
  rawProductId: unknown,
  rawCreativeIds: unknown,
): Promise<ActionResult<{ triggered: number }>> {
  const parsed = SelectCreativesInput.safeParse({
    productId: rawProductId,
    creativeIds: rawCreativeIds,
  })
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." }
  }

  const { userId } = await requireUser()
  const { productId, creativeIds } = parsed.data

  return withUser(userId, async (db) => {
    for (const creativeId of creativeIds) {
      await db
        .update(creatives)
        .set({ selectedBool: true })
        .where(
          and(
            eq(creatives.id, creativeId),
            eq(creatives.productId, productId),
            eq(creatives.userId, userId),
          ),
        )
    }

    let triggered = 0
    for (const creativeId of creativeIds) {
      try {
        await tasks.trigger<typeof translateAndBurnSubsTask>("translateAndBurnSubs", {
          creativeId,
          userId,
        })
        triggered++
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error al iniciar la edición de video."
        return {
          ok: false,
          error: `${message} (${triggered.toString()}/${creativeIds.length.toString()} disparados).`,
        }
      }
    }

    return { ok: true, data: { triggered } }
  })
}

const AdjustCopyInput = z.object({
  productId: z.uuid(),
  message: z.string().min(1).max(500),
})

export interface CopyOverrides {
  headline?: string
  subheadline?: string
}

const OverridesSchema = z.object({
  headline: z.string().max(100).optional(),
  subheadline: z.string().max(150).optional(),
})

export async function adjustLandingCopy(
  rawProductId: unknown,
  rawMessage: unknown,
): Promise<ActionResult<CopyOverrides>> {
  const parsed = AdjustCopyInput.safeParse({
    productId: rawProductId,
    message: rawMessage,
  })
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." }
  }

  const { userId } = await requireUser()
  const { productId, message } = parsed.data

  return withUser(userId, async (db) => {
    const productRows = await db
      .select({ name: products.name, category: products.category })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1)

    const product = productRows[0]
    if (!product) {
      return { ok: false, error: "Producto no encontrado." }
    }

    const systemPrompt = `Eres un copywriter experto en e-commerce para el mercado peruano (LATAM).
El usuario quiere ajustar el copy de una landing page para el producto: "${product.name ?? "producto"}".
Categoría: "${product.category ?? "general"}".
Responde ÚNICAMENTE con JSON válido con las claves "headline" y "subheadline" (strings cortos, máx 100 y 150 caracteres respectivamente).
No incluyas nada más que el JSON.`

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      prompt: message,
      maxOutputTokens: 300,
    })

    const cleaned = text
      .trim()
      .replace(/^```json\n?/, "")
      .replace(/\n?```$/, "")

    let json: unknown
    try {
      json = JSON.parse(cleaned)
    } catch {
      return { ok: false, error: "El copy generado no es JSON válido." }
    }

    const validated = OverridesSchema.safeParse(json)
    if (!validated.success) {
      return { ok: false, error: "El copy generado no cumple el formato." }
    }

    const overrides: CopyOverrides = {}
    if (validated.data.headline !== undefined) {
      overrides.headline = validated.data.headline
    }
    if (validated.data.subheadline !== undefined) {
      overrides.subheadline = validated.data.subheadline
    }

    return { ok: true, data: overrides }
  })
}
