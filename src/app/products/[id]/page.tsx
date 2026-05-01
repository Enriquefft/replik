import { auth } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { RetryScrapeCard } from "@/components/retry-scrape-card.tsx"
import { ScrapeProgress } from "@/components/scrape-progress.tsx"
import { requireUser, withUser } from "@/db/client"
import { creatives, products } from "@/db/schema"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import { CreativesClient } from "./creatives-client.tsx"

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
    return <ScrapeProgress productId={productId} accessToken={accessToken} />
  }

  if (productData.status === "SCRAPE_EMPTY") {
    return (
      <RetryScrapeCard
        productId={productId}
        title="No encontramos creativos"
        detail="Meta Ad Library y Apify no devolvieron resultados para este producto. Puedes reintentar o probar con otra URL."
      />
    )
  }

  if (productData.status === "FAILED") {
    return (
      <RetryScrapeCard
        productId={productId}
        title="El análisis falló"
        detail="No pudimos completar el scraping de este producto. Reintenta o cambia la URL."
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
    const isPartial = productData.status === "SCRAPE_PARTIAL"
    return (
      <RetryScrapeCard
        productId={productId}
        title={isPartial ? "Análisis incompleto" : "No hay creativos disponibles"}
        detail={
          isPartial
            ? "No pudimos extraer suficientes datos del producto para buscar anuncios. Reintenta o usa otra URL."
            : "No encontramos creativos para este producto. Reintenta o usa otra URL."
        }
      />
    )
  }

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
        </div>
        <CreativesClient productId={productId} creatives={creativeRows} />
      </div>
    </div>
  )
}
