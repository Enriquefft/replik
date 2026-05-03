import "server-only"

import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"
import { requireUser, UnauthenticatedError } from "@/db/client"
import { logError, logEvent } from "@/lib/observability/log.ts"
import {
  exchangeCode,
  normalizeShopDomain,
  ShopifyOAuthError,
  verifyHmac,
} from "@/lib/shopify/oauth"
import { SHOPIFY_OAUTH_STATE_COOKIE } from "@/server/actions/shopify-oauth"
import { saveIntegration } from "@/server/integrations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectWithError(origin: string, message: string): NextResponse {
  const url = new URL("/dashboard", origin)
  url.searchParams.set("shopify", "error")
  url.searchParams.set("message", message)
  return NextResponse.redirect(url)
}

function redirectSuccess(origin: string): NextResponse {
  const url = new URL("/dashboard", origin)
  url.searchParams.set("shopify", "connected")
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin
  const search = request.nextUrl.searchParams

  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    logError("shopify.oauth.misconfigured", {})
    return redirectWithError(origin, "Servidor no configurado para Shopify OAuth.")
  }

  // 1. HMAC — proves the redirect actually came from Shopify with our secret.
  if (!verifyHmac(search, clientSecret)) {
    logError("shopify.oauth.hmac_mismatch", {})
    return redirectWithError(origin, "Validación HMAC fallida.")
  }

  // 2. State (CSRF) — compare URL state with the cookie nonce we set in
  // `startShopifyOAuth`. Both must be present and equal.
  const stateFromUrl = search.get("state")
  const cookieStore = await cookies()
  const stateFromCookie = cookieStore.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(SHOPIFY_OAUTH_STATE_COOKIE)
  if (!stateFromUrl || !stateFromCookie || stateFromUrl !== stateFromCookie) {
    logError("shopify.oauth.state_mismatch", {
      hasUrl: stateFromUrl !== null,
      hasCookie: stateFromCookie !== undefined,
    })
    return redirectWithError(origin, "Estado OAuth inválido. Reintenta la conexión.")
  }

  // 3. Shop domain regex — Shopify always sends `shop=*.myshopify.com`.
  const shopRaw = search.get("shop")
  if (!shopRaw) {
    return redirectWithError(origin, "Falta el dominio de la tienda.")
  }
  let shop: string
  try {
    shop = normalizeShopDomain(shopRaw)
  } catch (err) {
    if (err instanceof ShopifyOAuthError) {
      return redirectWithError(origin, err.message)
    }
    throw err
  }

  const code = search.get("code")
  if (!code) {
    return redirectWithError(origin, "Falta el código de autorización.")
  }

  // 4. Resolve the user — the Clerk session cookie rides along with the
  // top-level redirect from Shopify because we set our state cookie with
  // SameSite=Lax. If the session expired, redirect to sign-in.
  let userId: string
  try {
    const user = await requireUser()
    userId = user.userId
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const signInUrl = new URL("/sign-in", origin)
      return NextResponse.redirect(signInUrl)
    }
    throw err
  }

  // 5. Exchange code → token, then persist via the existing integrations
  // helper (encrypts at rest).
  try {
    const exchanged = await exchangeCode({
      shop,
      code,
      clientId,
      clientSecret,
    })
    await saveIntegration(userId, {
      provider: "shopify",
      token: exchanged.token,
      extra: { provider: "shopify", shop_domain: shop },
    })
    logEvent("shopify.oauth.connected", { userId, shop, scope: exchanged.scope })
    return redirectSuccess(origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido"
    logError("shopify.oauth.exchange_failed", { userId, shop, message })
    return redirectWithError(origin, "No se pudo completar la conexión con Shopify.")
  }
}
