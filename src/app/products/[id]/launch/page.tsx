import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { requireUser, withUser } from "@/db/client"
import { creatives, products } from "@/db/schema"
import { LaunchClient } from "./launch-client.tsx"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LaunchPage({ params }: PageProps) {
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

  // Fetch selected creatives for copy preview
  const selectedCreatives = await withUser(userId, async (db) => {
    return db
      .select({
        id: creatives.id,
        angle: creatives.angle,
        transcriptText: creatives.transcriptText,
      })
      .from(creatives)
      .where(
        and(
          eq(creatives.productId, id),
          eq(creatives.userId, userId),
          eq(creatives.selectedBool, true),
        ),
      )
  })

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-4xl flex flex-col gap-6">
        <div>
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-traffic-badge-fg mb-1">
            Paso 5 · Lanzar campaña
          </p>
          <h2 className="text-title">Configurar y lanzar en Meta Ads</h2>
          <p className="text-body text-fg-2 mt-1">
            La campaña se crea en estado PAUSED para que puedas revisarla antes de activarla.
          </p>
        </div>

        <LaunchClient
          productId={id}
          productName={productData.name ?? "Producto"}
          pricingCents={productData.pricingCents ?? 0}
          bundle2PricingCents={productData.bundle2PricingCents ?? 0}
          bundle3PricingCents={productData.bundle3PricingCents ?? 0}
          selectedCreatives={selectedCreatives}
        />
      </div>
    </div>
  )
}
