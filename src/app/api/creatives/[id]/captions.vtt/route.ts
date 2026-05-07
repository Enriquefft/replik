import "server-only"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives } from "@/db/schema"
import { srtToVtt } from "@/lib/captions/srt-to-vtt.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  const idParsed = z.uuid().safeParse(id)
  if (!idParsed.success) {
    return new Response("invalid_id", { status: 400 })
  }
  const creativeId = idParsed.data

  const { userId } = await requireUser()

  // Tenant-scoped fetch — RLS via `withUser` ensures the SRT URL belongs to a
  // creative owned by the requesting user.
  const srtUrl = await withUser(userId, async (db) => {
    const rows = await db
      .select({ url: assets.url })
      .from(assets)
      .innerJoin(creatives, eq(creatives.id, assets.ownerId))
      .where(
        and(
          eq(assets.ownerType, "creative"),
          eq(assets.kind, "srt"),
          eq(assets.ownerId, creativeId),
          eq(creatives.userId, userId),
        ),
      )
      .limit(1)
    return rows[0]?.url ?? null
  })

  if (srtUrl === null) {
    return new Response("not_found", { status: 404 })
  }

  const srtResponse = await fetch(srtUrl, { cache: "no-store" })
  if (!srtResponse.ok) {
    return new Response("upstream_failed", { status: 502 })
  }
  const srt = await srtResponse.text()
  const vtt = srtToVtt(srt)

  return new Response(vtt, {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  })
}
