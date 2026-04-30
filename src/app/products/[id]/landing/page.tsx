import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { requireUser, withUser } from "@/db/client"
import { products } from "@/db/schema"
import { TEMPLATES } from "@/lib/shopify/templates/index.ts"
import { LandingClient } from "./landing-client.tsx"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LandingPage({ params }: PageProps) {
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

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-web-badge-fg mb-1">
            Paso 4 · Landing page
          </p>
          <h2 className="text-title">Elige el template y ajusta el copy</h2>
          <p className="text-body text-fg-2 mt-1">
            3 versiones basadas en los ángulos de los videos. Conversa con el asistente para ajustar
            el texto.
          </p>
        </div>

        <LandingClient
          productId={id}
          templates={TEMPLATES}
          productName={productData.name ?? ""}
          pricingCents={productData.pricingCents ?? 0}
          bundle2PricingCents={productData.bundle2PricingCents ?? 0}
          bundle3PricingCents={productData.bundle3PricingCents ?? 0}
        />
      </div>
    </div>
  )
}
