import { notFound } from "next/navigation";
import { requireUser, withUser } from "@/db/client";
import { products, creatives } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { CreativesClient } from "./creatives-client.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { AlertCircle } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;

  const { userId } = await requireUser();

  const productData = await withUser(userId, async (db) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!productData) {
    notFound();
  }

  if (productData.status === "SCRAPING") {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg flex flex-col gap-4">
          <div className="rounded-card bg-surface shadow-card border border-border p-6">
            <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg mb-2">
              Paso 2 · Buscando creativos
            </p>
            <h2 className="text-title">Analizando el producto…</h2>
            <p className="text-body text-fg-2 mt-2">
              El agente está scrapeando keywords, buscando en Meta Ad Library y
              transcribiendo los videos. Esto toma 1–3 minutos.
            </p>
          </div>

          {/* Skeleton grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-card" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (productData.status === "SCRAPE_EMPTY") {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="rounded-card bg-surface shadow-card border border-border p-8 text-center">
            <div className="size-14 rounded-card bg-mode-traffic-badge-bg flex items-center justify-center mx-auto mb-4">
              <AlertCircle
                className="size-7 text-mode-traffic"
                strokeWidth={1.5}
              />
            </div>
            <h2 className="text-title mb-2">
              No encontramos creativos
            </h2>
            <p className="text-body text-fg-2 mb-4">
              Meta Ad Library y Apify no devolvieron resultados para este
              producto. Intenta con una URL diferente.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors"
            >
              Intentar con otro producto
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch creatives for READY, LANDING_PUBLISHED, CAMPAIGN_LAUNCHED
  const creativeRows = await withUser(userId, async (db) => {
    return db
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.productId, id),
          eq(creatives.userId, userId),
        ),
      );
  });

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-creative-badge-fg mb-1">
            Paso 2 · Selecciona creativos
          </p>
          <h2 className="text-title">
            {productData.name ?? "Creativos encontrados"}
          </h2>
          <p className="text-body text-fg-2 mt-1">
            Selecciona los videos que quieres editar con subtítulos en español.
            Recomendamos 3–5.
          </p>
        </div>
        <CreativesClient
          productId={id}
          creatives={creativeRows}
        />
      </div>
    </div>
  );
}
