import { auth } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { CreativesEmptyState } from "@/components/creatives-empty-state.tsx"
import { PublishSuccessPanel } from "@/components/publish-success-panel.tsx"
import { RetryScrapeCard } from "@/components/retry-scrape-card.tsx"
import { KeywordChips, ScrapeProgress } from "@/components/scrape-progress.tsx"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products } from "@/db/schema"
import { rankByComposite } from "@/lib/rank/composite.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import {
  type CreativeCounts,
  CreativesClient,
  type CreativeWithVideo,
} from "./creatives-client.tsx"

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

  // Server fetches every row + passes aggregate counts so the client can
  // disclose suppression honestly (the user paid for the scrape).
  // Null-transcript rows are still hidden from the selectable grid because
  // the burn pipeline dereferences `transcriptText` directly — letting users
  // select would crash. Music-only ads transcribe to "" (not null), so they
  // pass. Ordering uses `rankByComposite` — score = brand-match × engagement
  // × recency, then round-robin across angle buckets so the top-N spans
  // different hooks before doubling up on a single angle.
  const allCreativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
  })

  const transcribedRows = allCreativeRows.filter((row) => row.transcriptText !== null)
  const selectableRows = rankByComposite(transcribedRows)
  const counts: CreativeCounts = {
    total: allCreativeRows.length,
    withTranscript: selectableRows.length,
    hiddenNoTranscript: allCreativeRows.length - selectableRows.length,
  }

  if (selectableRows.length === 0) {
    return (
      <CreativesEmptyState
        productId={productId}
        sourceUrl={productData.sourceUrl}
        scrapeReason={productData.scrapeReason}
        total={counts.total}
        withTranscript={counts.withTranscript}
      />
    )
  }

  const creativeIds = selectableRows.map((row) => row.id)
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
  // wins when present — it's permanent and browser-fetchable. Otherwise we
  // route through `/api/creative-preview/[id]`, which 302-redirects FB CDN
  // URLs (publicly fetchable) and server-streams Apify-KV URLs with
  // `Authorization: Bearer` so APIFY_TOKEN never reaches the browser.
  const rehostedByCreativeId = new Map<string, string>()
  const srtByCreativeId = new Map<string, string>()
  for (const row of assetRows) {
    if (row.kind === "original_video") {
      rehostedByCreativeId.set(row.ownerId, row.url)
    } else if (row.kind === "srt") {
      srtByCreativeId.set(row.ownerId, row.url)
    }
  }

  const creativesWithVideo: CreativeWithVideo[] = selectableRows.map((row) => ({
    ...row,
    previewUrl: rehostedByCreativeId.get(row.id) ?? `/api/creative-preview/${row.id}`,
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
        {productData.storefrontUrl !== null && (
          <div className="mb-6">
            <PublishSuccessPanel url={productData.storefrontUrl} />
          </div>
        )}
        <CreativesClient productId={productId} creatives={creativesWithVideo} counts={counts} />
      </div>
    </div>
  )
}
