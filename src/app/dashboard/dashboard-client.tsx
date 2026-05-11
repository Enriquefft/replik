"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { CredentialsModal } from "@/components/credentials-modal.tsx"
import { PhaseProgress } from "@/components/phase-progress.tsx"
import { ProductCard } from "@/components/product-card.tsx"
import { Button } from "@/components/ui/button.tsx"
import { getDashboard } from "@/server/actions/dashboard.ts"
import { refreshInsights } from "@/server/actions/insights.ts"
import type { DashboardData } from "@/server/dashboard"
import {
  SYNC_INSIGHTS_PHASE_LABELS_ES,
  SYNC_INSIGHTS_PHASE_WEIGHTS,
  SYNC_INSIGHTS_PHASES,
  type SyncInsightsProgressMetadata,
  SyncInsightsProgressMetadataSchema,
} from "@/server/trigger/syncInsights/metadata.ts"

interface DashboardClientProps {
  initialData: DashboardData
}

type ReconnectProvider = "meta" | "shopify"

function parseReconnectProvider(raw: string | null): ReconnectProvider | null {
  if (raw === "meta" || raw === "shopify") return raw
  return null
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [refreshRunHandle, setRefreshRunHandle] = React.useState<{
    runId: string
    accessToken: string
  } | null>(null)
  const [metaModalOpen, setMetaModalOpen] = React.useState(false)
  const [shopifyModalOpen, setShopifyModalOpen] = React.useState(false)
  const [credError, setCredError] = React.useState<string | undefined>()
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Honor `?reconnect=<provider>` deep links produced by the failure card
  // in `<PhaseProgress>` (`reconnect_integration` action). We open the
  // matching modal exactly once on mount, then strip the param so a hard
  // refresh doesn't re-open it indefinitely.
  const handledReconnectRef = React.useRef(false)
  React.useEffect(() => {
    if (handledReconnectRef.current) return
    const provider = parseReconnectProvider(searchParams.get("reconnect"))
    if (provider === null) return
    handledReconnectRef.current = true
    if (provider === "meta") setMetaModalOpen(true)
    else setShopifyModalOpen(true)
    router.replace(pathname)
  }, [searchParams, router, pathname])

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
      setMetaModalOpen(true)
      return
    }

    // Submit-receipt: fire BEFORE the wait surface mounts.
    toast.success("Sincronizando métricas…")
    setRefreshRunHandle({ runId: result.data.runId, accessToken: result.data.accessToken })
  }

  function handleMetaSaved() {
    setMetaModalOpen(false)
    setCredError(undefined)
    void handleRefreshMetrics()
  }

  function handleShopifySaved() {
    setShopifyModalOpen(false)
    setCredError(undefined)
    // Shopify reconnection on the dashboard is initiated from a deep link
    // after a publish-landing failure on the per-product flow. There is no
    // dashboard-level Shopify retry — once the OAuth round-trip completes
    // we just close the modal and let the user navigate back.
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
          {/* Gate on BOTH the in-flight server action (isRefreshing) AND
              the live PhaseProgress handle. `isRefreshing` only covers the
              ~ms-long server action call; once the handle is set the
              Trigger.dev run can still be running for minutes, and a second
              click would spawn a concurrent sync. */}
          <Button
            size="sm"
            onClick={() => void handleRefreshMetrics()}
            disabled={isRefreshing || refreshRunHandle !== null}
          >
            {isRefreshing || refreshRunHandle !== null ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Refrescar métricas
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {refreshRunHandle && (
        <PhaseProgress<(typeof SYNC_INSIGHTS_PHASES)[number], SyncInsightsProgressMetadata>
          runId={refreshRunHandle.runId}
          accessToken={refreshRunHandle.accessToken}
          phases={SYNC_INSIGHTS_PHASES}
          phaseWeights={SYNC_INSIGHTS_PHASE_WEIGHTS}
          phaseLabels={SYNC_INSIGHTS_PHASE_LABELS_ES}
          metadataSchema={SyncInsightsProgressMetadataSchema}
          taskKind="sync_insights"
          currentPhaseFromMeta={(m) => m.phase ?? null}
          onComplete={() => {
            // Re-enable the "Refrescar métricas" CTA once the run terminates.
            // useRefreshOnComplete inside PhaseProgress will refetch the RSC
            // snapshot, so the underlying dashboard data refreshes too.
            setRefreshRunHandle(null)
          }}
          onRetry={() => {
            // Drop the dead handle so PhaseProgress unmounts cleanly, then
            // re-invoke the server action — the next setRefreshRunHandle
            // call inside handleRefreshMetrics mounts a fresh subscription.
            setRefreshRunHandle(null)
            void handleRefreshMetrics()
          }}
          detailSlot={(meta) => {
            const product = meta?.product
            if (product === undefined) return null
            const { done, total, currentName } = product
            const base = `Sincronizando ${done.toString()} de ${total.toString()} producto${total === 1 ? "" : "s"}`
            return (
              <p className="text-caption text-fg-2">
                {currentName !== undefined ? `${base} · ${currentName}` : base}
              </p>
            )
          }}
        />
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

      {/* Credentials modals — mounted unconditionally so deep-link
          `?reconnect=meta` / `?reconnect=shopify` can open either one.
          `credError` is only ever populated by the Meta refresh path; the
          Shopify modal opens via deep link with no inline error message. */}
      <CredentialsModal
        open={metaModalOpen}
        onOpenChange={setMetaModalOpen}
        provider="meta"
        onSaved={handleMetaSaved}
        {...(credError !== undefined && { errorMessage: credError })}
      />
      <CredentialsModal
        open={shopifyModalOpen}
        onOpenChange={setShopifyModalOpen}
        provider="shopify"
        onSaved={handleShopifySaved}
      />
    </div>
  )
}
