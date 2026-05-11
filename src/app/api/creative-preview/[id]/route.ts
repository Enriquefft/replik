import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "@/db/client"
import { creatives } from "@/db/schema"
import { APIFY_KVS_HOSTNAME } from "@/lib/apify/auth.ts"

export const runtime = "edge"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * UUID-gated streaming proxy for creative previews that point at
 * private Apify Key-Value Store URLs (TikTok lane). Browsers cannot
 * fetch those URLs anonymously (HTTP 403) and we cannot embed the
 * APIFY_TOKEN client-side, so the route attaches an `Authorization:
 * Bearer` header server-side and pipes the upstream bytes through.
 *
 * Range header in/out is forwarded so HTML5 `<video>` seeking works.
 *
 * For non-Apify hosts (FB CDN), the route 302-redirects directly so we
 * don't proxy bytes that the browser can fetch on its own.
 *
 * Auth model: the route is intentionally public (excluded from Clerk
 * middleware) so Vercel's CDN can cache responses — Clerk's per-request
 * `Set-Cookie` defeats `Cache-Control: public` caching on any protected
 * route. Access is gated by the unguessable creative UUID, the same way
 * Cloudinary / Mux / YouTube-unlisted protect asset URLs. Bytes are the
 * only thing fetchable; no PII, no user data.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  const idParsed = z.uuid().safeParse(id)
  if (!idParsed.success) return new Response("invalid_id", { status: 400 })
  const creativeId = idParsed.data

  const db = getDb()
  const rows = await db
    .select({ scrapeUrl: creatives.scrapeUrl })
    .from(creatives)
    .where(eq(creatives.id, creativeId))
    .limit(1)
  const scrapeUrl = rows[0]?.scrapeUrl ?? null

  if (scrapeUrl === null) return new Response("not_found", { status: 404 })

  let parsed: URL
  try {
    parsed = new URL(scrapeUrl)
  } catch {
    return new Response("invalid_upstream", { status: 502 })
  }

  if (parsed.hostname !== APIFY_KVS_HOSTNAME) {
    return Response.redirect(scrapeUrl, 302)
  }

  const apifyToken = process.env.APIFY_TOKEN
  if (apifyToken === undefined || apifyToken.length === 0) {
    return new Response("apify_token_missing", { status: 500 })
  }

  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${apifyToken}`,
  }
  const range = request.headers.get("range")
  if (range !== null) upstreamHeaders.Range = range

  const upstream = await fetch(scrapeUrl, {
    headers: upstreamHeaders,
    redirect: "follow",
  })

  if (upstream.body === null) {
    return new Response("upstream_no_body", { status: 502 })
  }

  const respHeaders = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType !== null) respHeaders.set("Content-Type", contentType)
  const contentLength = upstream.headers.get("content-length")
  if (contentLength !== null) respHeaders.set("Content-Length", contentLength)
  const contentRange = upstream.headers.get("content-range")
  if (contentRange !== null) respHeaders.set("Content-Range", contentRange)
  respHeaders.set("Accept-Ranges", "bytes")
  respHeaders.set(
    "Cache-Control",
    "public, s-maxage=604800, max-age=3600, stale-while-revalidate=86400",
  )

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  })
}
