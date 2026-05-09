import "server-only"

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { requireUser, withUser } from "@/db/client"
import { creatives } from "@/db/schema"
import { APIFY_KVS_HOSTNAME } from "@/lib/apify/auth.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Authenticated streaming proxy for creative previews that point at
 * private Apify Key-Value Store URLs (TikTok lane). Browsers cannot
 * fetch those URLs anonymously (HTTP 403) and we cannot embed the
 * APIFY_TOKEN client-side, so the route attaches an `Authorization:
 * Bearer` header server-side and pipes the upstream bytes through.
 *
 * Range header in/out is forwarded so HTML5 `<video>` seeking works.
 *
 * For non-Apify hosts (FB CDN), the route 302-redirects directly so we
 * don't proxy bytes that the browser can fetch on its own.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  const idParsed = z.uuid().safeParse(id)
  if (!idParsed.success) return new Response("invalid_id", { status: 400 })
  const creativeId = idParsed.data

  const { userId } = await requireUser()

  const scrapeUrl = await withUser(userId, async (db) => {
    const rows = await db
      .select({ scrapeUrl: creatives.scrapeUrl })
      .from(creatives)
      .where(and(eq(creatives.id, creativeId), eq(creatives.userId, userId)))
      .limit(1)
    return rows[0]?.scrapeUrl ?? null
  })

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
    cache: "no-store",
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
  respHeaders.set("Cache-Control", "private, max-age=60")

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  })
}
