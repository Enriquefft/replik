"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { tasks } from "@trigger.dev/sdk"
import { generateText } from "ai"
import { and, desc, eq, inArray, like } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, idempotencyKeys, products, users } from "@/db/schema"
import { logError, withTiming } from "@/lib/observability/log.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import { type ProductId, toProductId } from "@/lib/types/ids.ts"
import type { rehostCreativesTask } from "@/server/trigger/rehostCreatives"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"
import type { ActionResult } from "./types.ts"
import { validateUrl } from "./url-probe.ts"

const RETRY_COOLDOWN_MS = 60_000

export type ProductStatus = (typeof products.$inferSelect)["status"]

export async function getProductStatus(
  rawProductId: unknown,
): Promise<ActionResult<{ status: ProductStatus }>> {
  const productIdParsed = z.uuid().safeParse(rawProductId)
  if (!productIdParsed.success) {
    return { ok: false, error: "ID de producto inválido." }
  }
  const productId = toProductId(productIdParsed.data)

  const { userId } = await requireUser()

  return withTiming(
    "action.product.get_status",
    () =>
      withUser(userId, async (db) => {
        const rows = await db
          .select({ status: products.status })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        const row = rows[0]
        if (!row) return { ok: false, error: "Producto no encontrado." }
        return { ok: true, data: { status: row.status } }
      }),
    { productId },
  )
}

const RetryScrapeInput = z.object({
  productId: z.uuid("ID de producto inválido."),
  newUrl: z.url().optional(),
})

export async function retryScrape(rawInput: unknown): Promise<ActionResult<null>> {
  const parsed = RetryScrapeInput.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }
  }
  const productId = toProductId(parsed.data.productId)
  const { userId } = await requireUser()

  return withTiming(
    "action.product.retry_scrape",
    async () => {
      const product = await withUser(userId, async (db) => {
        const rows = await db
          .select({ sourceUrl: products.sourceUrl })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .limit(1)
        return rows[0] ?? null
      })
      if (!product) return { ok: false, error: "Producto no encontrado." }

      let competitorUrl = product.sourceUrl
      let urlChanged = false
      if (parsed.data.newUrl !== undefined && parsed.data.newUrl !== product.sourceUrl) {
        const probe = await validateUrl(parsed.data.newUrl)
        if (!probe.ok) {
          return { ok: false, error: probe.error ?? "URL inválida." }
        }
        competitorUrl = probe.data.finalUrl
        urlChanged = competitorUrl !== product.sourceUrl
      }

      // Cooldown: each retry creates a fresh idempotency key (the `attempt`
      // suffix is monotonic), which means each retry pays full Apify charge.
      // Block re-runs within RETRY_COOLDOWN_MS unless the URL actually
      // changed — a URL change is a legitimate re-scrape.
      if (!urlChanged) {
        const recent = await withUser(userId, async (db) => {
          const rows = await db
            .select({ createdAt: idempotencyKeys.createdAt })
            .from(idempotencyKeys)
            .where(
              and(
                eq(idempotencyKeys.userId, userId),
                like(idempotencyKeys.key, `scrape_${productId}_%`),
              ),
            )
            .orderBy(desc(idempotencyKeys.createdAt))
            .limit(1)
          return rows[0] ?? null
        })
        if (recent) {
          const elapsed = Date.now() - recent.createdAt.getTime()
          if (elapsed < RETRY_COOLDOWN_MS) {
            const waitSecs = Math.ceil((RETRY_COOLDOWN_MS - elapsed) / 1000)
            return {
              ok: false,
              error: `Espera ${waitSecs.toString()} s antes de reintentar el análisis.`,
            }
          }
        }
      }

      try {
        // Idempotency invariant (`scrape-product/index.ts:295`):
        // `scrape_${productId}_${attempt}` keys the dedup row. Every retry
        // MUST pass a fresh `attempt`, otherwise the run replays the cached
        // summary instead of re-scraping the (possibly new) URL.
        await tasks.trigger<typeof scrapeProduct>(
          "scrape-product",
          {
            productId,
            userId,
            competitorUrl,
            attempt: Math.floor(Date.now() / 1000),
          },
          { tags: [productTag(productId)] },
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : "No se pudo reintentar el análisis."
        logError("action.product.retry_scrape.trigger_failed", { productId, reason })
        return { ok: false, error: reason }
      }

      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({
            status: "SCRAPING",
            scrapeReason: null,
            sourceUrl: competitorUrl,
          })
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
      })
      return { ok: true, data: null }
    },
    { productId, hasNewUrl: parsed.data.newUrl !== undefined },
  )
}

const CreateProductInput = z.object({
  source_url: z.url("URL inválida"),
  pricing_cents: z.number().int().positive(),
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

  return withTiming(
    "action.product.create",
    async () => {
      const probe = await validateUrl(input.source_url)
      if (!probe.ok) {
        return { ok: false, error: probe.error ?? "URL inválida." }
      }
      const sourceUrl = probe.data.finalUrl

      try {
        return await withUser(userId, async (db) => {
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
              sourceUrl,
              pricingCents: input.pricing_cents,
              status: "SCRAPING",
            })
            .returning({ id: products.id })

          const row = inserted[0]
          if (!row) {
            return { ok: false, error: "No se pudo crear el producto." }
          }

          const productId = toProductId(row.id)

          try {
            await tasks.trigger<typeof scrapeProduct>(
              "scrape-product",
              {
                productId: row.id,
                userId,
                competitorUrl: sourceUrl,
              },
              { tags: [productTag(productId)] },
            )
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Error al iniciar el análisis."
            logError("action.product.create.trigger_failed", { productId, reason })
            await db
              .delete(products)
              .where(and(eq(products.id, row.id), eq(products.userId, userId)))
            return { ok: false, error: reason }
          }

          return { ok: true, data: { id: productId } }
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logError("action.product.create.db_error", { reason })
        const message = err instanceof Error ? err.message : "Error al crear el producto."
        return { ok: false, error: message }
      }
    },
    { source_url: input.source_url },
  )
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

  return withTiming(
    "action.product.get_creatives",
    () =>
      withUser(userId, async (db) => {
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
      }),
    { productId },
  )
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

  return withTiming(
    "action.product.select_creatives",
    () =>
      withUser(userId, async (db) => {
        const owned = await db
          .select({ id: creatives.id })
          .from(creatives)
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
              inArray(creatives.id, creativeIds),
            ),
          )
        if (owned.length !== creativeIds.length) {
          return { ok: false, error: "Creativos inválidos." }
        }

        // Flip selectedBool first so a downstream trigger failure doesn't
        // leave creatives rehosted-but-unselected (irrecoverable from the UI).
        // The reverse — selected-but-unrehosted — is recoverable: the user
        // re-clicks Select, and `rehostCreatives` short-circuits on creatives
        // that already have an `original_video` asset.
        await db
          .update(creatives)
          .set({ selectedBool: true })
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
              inArray(creatives.id, creativeIds),
            ),
          )

        try {
          await tasks.trigger<typeof rehostCreativesTask>("rehostCreatives", {
            creativeIds,
            userId,
          })
        } catch (err) {
          const reason =
            err instanceof Error ? err.message : "Error al iniciar la edición de video."
          logError("action.product.select_creatives.trigger_failed", {
            productId,
            count: creativeIds.length,
            reason,
          })
          return { ok: false, error: reason }
        }

        return { ok: true, data: { triggered: creativeIds.length } }
      }),
    { productId, count: creativeIds.length },
  )
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

  return withTiming(
    "action.product.adjust_copy",
    () =>
      withUser(userId, async (db) => {
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

        const { text } = await withTiming(
          "ai.adjust_copy",
          () =>
            generateText({
              model: anthropic("claude-sonnet-4-6"),
              system: systemPrompt,
              prompt: message,
              maxOutputTokens: 300,
            }),
          { productId },
        )

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
      }),
    { productId, messageLen: message.length },
  )
}
