"use server"

import { z } from "zod"
import { requireUser } from "@/db/client"
import { accountsList, MetaAuthError, pixelsList } from "@/lib/meta"
import { deleteIntegration, saveIntegration as persistIntegration } from "@/server/integrations"
import type { ActionResult } from "./types.ts"

const MetaFormInput = z.object({
  provider: z.literal("meta"),
  token: z.string().min(10),
  ad_account_id: z.string().min(1),
  page_id: z.string().min(1),
})

export type SaveMetaIntegrationInput = z.infer<typeof MetaFormInput>

/**
 * Persists Meta credentials (token + ad account + page id), validating each
 * field against the Marketing API before writing. Shopify uses OAuth and
 * goes through `startShopifyOAuth` + the `/api/shopify/oauth/callback` route
 * instead — no token is ever pasted by the user.
 */
export async function saveMetaIntegration(rawInput: unknown): Promise<ActionResult<{ ok: true }>> {
  const parsed = MetaFormInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      needs: "meta",
      error: "Datos inválidos en el formulario.",
    }
  }
  const data = parsed.data
  const { userId } = await requireUser()

  try {
    const accounts = await accountsList({ token: data.token })
    const targetId = data.ad_account_id.replace(/^act_/, "")
    const matched = accounts.find((a) => a.account_id === targetId)
    if (!matched) {
      return {
        ok: false,
        needs: "meta",
        error: "El ad_account_id no pertenece a este token.",
      }
    }
    const pixels = await pixelsList({
      token: data.token,
      ad_account_id: targetId,
    })
    const pixel = pixels[0]
    if (!pixel) {
      return {
        ok: false,
        needs: "meta",
        error: "La cuenta no tiene pixels disponibles.",
      }
    }
    await persistIntegration(userId, {
      provider: "meta",
      token: data.token,
      extra: {
        provider: "meta",
        ad_account_id: targetId,
        page_id: data.page_id,
        pixel_id: pixel.id,
      },
    })
    return { ok: true, data: { ok: true } }
  } catch (err) {
    const friendly =
      err instanceof MetaAuthError ? err.message : "Token Meta inválido o sin permisos"
    return { ok: false, needs: "meta", error: friendly }
  }
}

const DisconnectInput = z.object({
  provider: z.union([z.literal("meta"), z.literal("shopify")]),
})

/**
 * Removes a provider integration for the current user. The next publish or
 * sync attempt for that provider will surface the standard missing-integration
 * error, triggering the JIT credentials modal again.
 */
export async function disconnectIntegration(
  rawInput: unknown,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = DisconnectInput.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: "Proveedor inválido." }
  }
  const { userId } = await requireUser()
  await deleteIntegration(userId, parsed.data.provider)
  return { ok: true, data: { ok: true } }
}
