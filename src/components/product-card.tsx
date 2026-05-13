"use client"

import { Copy, ExternalLink, Package, ShoppingBag, TrendingUp } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx"
import { cn } from "@/lib/utils.ts"
import type { DashboardProduct } from "@/server/dashboard"

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  SCRAPING: { label: "Scrapeando", variant: "secondary" },
  READY: { label: "Listo", variant: "default" },
  LANDING_PUBLISHED: { label: "Landing publicada", variant: "default" },
  CAMPAIGN_LAUNCHED: { label: "Campaña activa", variant: "default" },
  SCRAPE_EMPTY: { label: "Sin creativos", variant: "destructive" },
  SCRAPE_PARTIAL: { label: "Análisis incompleto", variant: "destructive" },
  FAILED: { label: "Error", variant: "destructive" },
}

function formatCents(cents: number): string {
  return `S/ ${(cents / 100).toFixed(2)}`
}

interface ProductCardProps {
  product: DashboardProduct
}

export function ProductCard({ product }: ProductCardProps) {
  const statusConfig =
    STATUS_CONFIG[product.status] ??
    STATUS_CONFIG.READY ??
    ({ label: "Listo", variant: "default" } as const)

  return (
    <Card
      className={cn("group relative overflow-hidden transition-all duration-200 hover:shadow-card")}
    >
      <CardHeader className="pb-2">
        <div className="flex w-full min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {product.imageUrls[0] ? (
              <Image
                src={product.imageUrls[0]}
                alt={product.name ?? "Producto"}
                width={40}
                height={40}
                className="size-10 rounded-control object-cover shrink-0"
                unoptimized
              />
            ) : (
              <div className="size-10 rounded-control bg-surface-muted flex items-center justify-center shrink-0">
                <Package className="size-5 text-fg-3" strokeWidth={1.5} />
              </div>
            )}
            <CardTitle className="text-headline truncate">
              {product.name ?? "Producto sin nombre"}
            </CardTitle>
          </div>
          <Badge variant={statusConfig.variant} className="shrink-0">
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="rounded-control bg-surface-muted p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="size-3.5 text-mode-live" strokeWidth={1.8} />
              <span className="text-caption text-fg-2 font-medium uppercase tracking-wide">
                Gastado
              </span>
            </div>
            <p className="text-headline font-semibold text-fg-1">
              {formatCents(product.metrics.spendCents)}
            </p>
          </div>

          <div className="rounded-control bg-surface-muted p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingBag className="size-3.5 text-mode-web" strokeWidth={1.8} />
              <span className="text-caption text-fg-2 font-medium uppercase tracking-wide">
                Pedidos
              </span>
            </div>
            <p className="text-headline font-semibold text-fg-1">{product.ordersCount}</p>
          </div>

          {product.metrics.cpaCents !== null && (
            <div className="rounded-control bg-surface-muted p-3">
              <p className="text-caption text-fg-2 font-medium uppercase tracking-wide mb-1">CPA</p>
              <p className="text-headline font-semibold text-fg-1">
                {formatCents(product.metrics.cpaCents)}
              </p>
            </div>
          )}

          {product.metrics.roas !== null && (
            <div className="rounded-control bg-surface-muted p-3">
              <p className="text-caption text-fg-2 font-medium uppercase tracking-wide mb-1">
                ROAS
              </p>
              <p className="text-headline font-semibold text-fg-1">
                {product.metrics.roas.toFixed(2)}×
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <Link
            href={`/products/${product.id}`}
            className="text-callout text-mode-live hover:underline font-medium"
          >
            Ver producto →
          </Link>
          {product.storefrontUrl !== null && (
            <div className="flex items-center gap-2">
              <a
                href={product.storefrontUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-caption text-fg-2 hover:text-fg-1"
              >
                Ver landing en vivo <ExternalLink className="size-3" />
              </a>
              <button
                type="button"
                aria-label="Copiar enlace"
                onClick={() => {
                  if (product.storefrontUrl === null) return
                  void navigator.clipboard
                    .writeText(product.storefrontUrl)
                    .then(() => toast.success("Enlace copiado"))
                    .catch(() => toast.error("No se pudo copiar el enlace"))
                }}
                className="inline-flex items-center text-fg-2 hover:text-fg-1"
              >
                <Copy className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
