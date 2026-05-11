import { auth } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { requireUser, withUser } from "@/db/client"
import { assets, creatives, products } from "@/db/schema"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import { EditPageClient } from "./edit-page-client.tsx"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditPage({ params }: PageProps) {
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

  const creativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.productId, productId),
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

  // Realtime read scope is the same `productTag` already used by the scrape
  // pipeline — rehostCreatives + every translateAndBurnSubs run is tagged
  // with it, so one subscription covers all per-creative work.
  //
  // 4h TTL because rehost+burn can stretch 30–90 min in the worst case and
  // a user who reconnects to monitor (e.g. via JobsDock-driven return)
  // should not hit an expired token mid-stream.
  const accessToken = await auth.createPublicToken({
    scopes: { read: { tags: [productTag(productId)] } },
    expirationTime: "4h",
  })

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
            terminen, podrás descargarlos y continuar a la landing.
          </p>
        </div>

        <EditPageClient
          productId={productId}
          creatives={creativesWithAssets}
          accessToken={accessToken}
        />
      </div>
    </div>
  )
}
