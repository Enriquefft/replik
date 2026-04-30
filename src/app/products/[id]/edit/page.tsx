import { and, eq } from "drizzle-orm"
import Link from "next/link"
import { notFound } from "next/navigation"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products } from "@/db/schema"
import { EditPageClient } from "./edit-page-client.tsx"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditPage({ params }: PageProps) {
  const { id } = await params
  const { userId } = await requireUser()

  const productData = await withUser(userId, async (db) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!productData) {
    notFound()
  }

  // Fetch selected creatives with their assets
  const creativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.productId, id),
          eq(creatives.userId, userId),
          eq(creatives.selectedBool, true),
        ),
      )
  })

  const creativesWithAssets = await Promise.all(
    creativeRows.map(async (creative) => {
      const assetRows = await withUser(userId, async (db) => {
        return db
          .select()
          .from(assets)
          .where(and(eq(assets.ownerType, "creative"), eq(assets.ownerId, creative.id)))
      })
      return { ...creative, assets: assetRows }
    }),
  )

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-4xl flex flex-col gap-6">
        <div>
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-creative-badge-fg mb-1">
            Paso 3 · Editando videos
          </p>
          <h2 className="text-title">Traduciendo y quemando subtítulos</h2>
          <p className="text-body text-fg-2 mt-1">
            Los videos seleccionados están siendo procesados con subtítulos en español. Cuando
            terminen, podrás continuar a la landing.
          </p>
        </div>

        <EditPageClient productId={id} creatives={creativesWithAssets} />

        {/* Continue button — enabled when all done */}
        <div className="flex justify-end mt-4">
          <Link
            href={`/products/${id}/landing`}
            className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors"
          >
            Continuar → Landing
          </Link>
        </div>
      </div>
    </div>
  )
}
