"use server"

import { cookies } from "next/headers"
import { z } from "zod"
import { requireUser } from "@/db/client"
import {
  buildAuthorizeUrl,
  generateNonce,
  normalizeShopDomain,
  SHOPIFY_OAUTH_STATE_COOKIE,
  ShopifyOAuthError,
} from "@/lib/shopify/oauth"
import type { ActionResult } from "./types.ts"

const Input = z.object({
  shop_domain: z.string().min(3),
})

const STATE_TTL_SECONDS = 600

/**
 * Server action that builds the Shopify Admin OAuth authorize URL.
 *
 * Side-effect: writes a short-lived `shopify_oauth_state` HttpOnly cookie
 * carrying the random nonce. The callback at `/api/shopify/oauth/callback`
 * compares this against `state` from the redirect query string to defend
 * against CSRF / login-confusion. SameSite=Lax so the cookie still rides
 * along on Shopify's top-level redirect back to us.
 *
 * Returns the URL for the client to navigate to. The client (not the
 * server) performs the navigation so that on errors the caller stays on
 * the page and can show inline feedback.
 */
export async function startShopifyOAuth(
  rawInput: unknown,
): Promise<ActionResult<{ authorizeUrl: string }>> {
  const parsed = Input.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    }
  }
  await requireUser()

  let shop: string
  try {
    shop = normalizeShopDomain(parsed.data.shop_domain)
  } catch (err) {
    if (err instanceof ShopifyOAuthError) {
      return { ok: false, error: err.message }
    }
    throw err
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID
  const redirectUri = process.env.SHOPIFY_OAUTH_REDIRECT_URI
  const scopes = process.env.SHOPIFY_OAUTH_SCOPES
  if (!clientId || !redirectUri || !scopes) {
    return {
      ok: false,
      error: "Servidor no configurado para Shopify OAuth.",
    }
  }

  const nonce = generateNonce()
  const cookieStore = await cookies()
  cookieStore.set(SHOPIFY_OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  })

  const authorizeUrl = buildAuthorizeUrl({
    shop,
    clientId,
    scopes,
    redirectUri,
    state: nonce,
  })

  return { ok: true, data: { authorizeUrl } }
}
