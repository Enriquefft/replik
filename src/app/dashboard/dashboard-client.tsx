"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"
import { CredentialsModal } from "@/components/credentials-modal.tsx"
import { ProductCard } from "@/components/product-card.tsx"
import { TaskProgress } from "@/components/task-progress.tsx"
import { Button } from "@/components/ui/button.tsx"
import { getDashboard } from "@/server/actions/dashboard.ts"
import { refreshInsights } from "@/server/actions/insights.ts"
import type { DashboardData } from "@/server/dashboard"

interface DashboardClientProps {
  initialData: DashboardData
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [refreshRunId, setRefreshRunId] = React.useState<string | null>(null)
  const [credModalOpen, setCredModalOpen] = React.useState(false)
  const [credError, setCredError] = React.useState<string | undefined>()
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const { data, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const result = await getDashboard()
      if (!result.ok) {
        throw new Error(result.error ?? "Error al cargar el dashboard.")
      }
      return result.data
    },
    initialData,
    staleTime: 60_000,
  })

  async function handleRefreshMetrics() {
    setIsRefreshing(true)
    const result = await refreshInsights()
    setIsRefreshing(false)

    if (!result.ok) {
      setCredError(result.error)
      setCredModalOpen(true)
      return
    }

    setRefreshRunId(result.data.runId)
    toast.success("Sincronizando métricas…")
  }

  function handleCredSaved() {
    setCredModalOpen(false)
    setCredError(undefined)
    void handleRefreshMetrics()
  }

  const products = data.products

  return (
    <div className="flex flex-col gap-6">
      {/* Actions bar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-callout text-fg-2">
          {products.length > 0
            ? `${products.length.toString()} producto${products.length !== 1 ? "s" : ""}`
            : "Sin productos aún"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="size-3.5 mr-1.5" />
            Actualizar
          </Button>
          <Button size="sm" onClick={() => void handleRefreshMetrics()} disabled={isRefreshing}>
            {isRefreshing ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Refrescar métricas
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {refreshRunId && (
        <TaskProgress runId={refreshRunId} step="Sincronizando métricas desde Meta Ads…" />
      )}

      {/* Product grid */}
      {products.length === 0 ? (
        <div className="rounded-card bg-surface border border-border shadow-tight p-12 text-center">
          <p className="text-title text-fg-1 mb-2">Aún no tienes productos</p>
          <p className="text-body text-fg-2 mb-4">
            Agrega tu primer producto y Replik se encarga del resto.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors"
          >
            Agregar producto
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Credentials modal */}
      <CredentialsModal
        open={credModalOpen}
        onOpenChange={setCredModalOpen}
        provider="meta"
        onSaved={handleCredSaved}
        {...(credError !== undefined && { errorMessage: credError })}
      />
    </div>
  )
}
