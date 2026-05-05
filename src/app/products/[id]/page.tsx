import { auth } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
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

  const creativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
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
  const videoAssetRows = await withUser(userId, async (db) => {
    return db
      .select({ ownerId: assets.ownerId, url: assets.url })
      .from(assets)
      .where(
        and(
          eq(assets.ownerType, "creative"),
          eq(assets.kind, "original_video"),
          inArray(assets.ownerId, creativeIds),
        ),
      )
  })

  const videoUrlByCreativeId = new Map<string, string>()
  for (const row of videoAssetRows) {
    videoUrlByCreativeId.set(row.ownerId, row.url)
  }

  const creativesWithVideo: CreativeWithVideo[] = creativeRows.map((row) => ({
    ...row,
    originalVideoUrl: videoUrlByCreativeId.get(row.id) ?? null,
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
