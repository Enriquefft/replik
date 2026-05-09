import { auth } from "@trigger.dev/sdk"
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { notFound } from "next/navigation"
import { RetryScrapeCard } from "@/components/retry-scrape-card.tsx"
import { KeywordChips, ScrapeProgress } from "@/components/scrape-progress.tsx"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products } from "@/db/schema"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import { CreativesClient, type CreativeWithVideo } from "./creatives-client.tsx"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProductPage({ params }: PageProps) {
  const { id: rawId } = await params
  const productId = toProductId(rawId)

  const { userId } = await requireUser()

  const productData = await withUser(userId, async (db) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!productData) {
    notFound()
  }

  if (productData.status === "SCRAPING") {
    const accessToken = await auth.createPublicToken({
      scopes: { read: { tags: [productTag(productId)] } },
      expirationTime: "1h",
    })
    return (
      <ScrapeProgress
        productId={productId}
        accessToken={accessToken}
        sourceUrl={productData.sourceUrl}
      />
    )
  }

  if (productData.status === "SCRAPE_EMPTY") {
    return (
      <RetryScrapeCard
        productId={productId}
        sourceUrl={productData.sourceUrl}
        reason={productData.scrapeReason}
      />
    )
  }

  if (productData.status === "FAILED") {
    return (
      <RetryScrapeCard
        productId={productId}
        sourceUrl={productData.sourceUrl}
        reason={productData.scrapeReason}
      />
    )
  }

  // Render order: classified creatives first (they have transcripts and a
  // sales angle), then everything else by insertion order. Null-transcript
  // rows are persistent transcribe failures (oversize, fetch_failed,
  // whisper_failed) — hide them so the user can't pick one and crash the
  // downstream burn pipeline, which dereferences `transcriptText` directly.
  // Music-only ads transcribe to "" (empty string), not null, so they pass.
  const creativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.productId, productId),
          eq(creatives.userId, userId),
          isNotNull(creatives.transcriptText),
        ),
      )
      .orderBy(desc(sql`${creatives.angle} IS NOT NULL`), asc(creatives.scrapedAt))
  })

  if (creativeRows.length === 0) {
    return (
      <RetryScrapeCard
        productId={productId}
        sourceUrl={productData.sourceUrl}
        reason={productData.scrapeReason}
      />
    )
  }

  const creativeIds = creativeRows.map((row) => row.id)
  const assetRows = await withUser(userId, async (db) => {
    return db
      .select({ ownerId: assets.ownerId, kind: assets.kind, url: assets.url })
      .from(assets)
      .where(
        and(
          eq(assets.ownerType, "creative"),
          inArray(assets.kind, ["original_video", "srt"]),
          inArray(assets.ownerId, creativeIds),
        ),
      )
  })

  // Resolve playable + caption URLs per creative. Rehosted UploadThing URL
  // wins over `scrapeUrl` because it's permanent — Meta/Apify CDN URLs carry
  // signed expirations that drift over hours/days. Pre-rehost creatives fall
  // back to `scrapeUrl`, which is guaranteed to be a direct video URL by the
  // video-only filter in `findAds`.
  const rehostedByCreativeId = new Map<string, string>()
  const srtByCreativeId = new Map<string, string>()
  for (const row of assetRows) {
    if (row.kind === "original_video") {
      rehostedByCreativeId.set(row.ownerId, row.url)
    } else if (row.kind === "srt") {
      srtByCreativeId.set(row.ownerId, row.url)
    }
  }

  const creativesWithVideo: CreativeWithVideo[] = creativeRows.map((row) => ({
    ...row,
    previewUrl: rehostedByCreativeId.get(row.id) ?? row.scrapeUrl,
    srtUrl: srtByCreativeId.get(row.id) ?? null,
  }))

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-creative-badge-fg mb-1">
            Paso 2 · Selecciona creativos
          </p>
          <h2 className="text-title">{productData.name ?? "Creativos encontrados"}</h2>
          <p className="text-body text-fg-2 mt-1">
            Selecciona los videos que quieres editar con subtítulos en español. Recomendamos 3–5.
          </p>
          <KeywordChips keywords={productData.keywords} className="mt-3" />
        </div>
        <CreativesClient productId={productId} creatives={creativesWithVideo} />
      </div>
    </div>
  )
}
