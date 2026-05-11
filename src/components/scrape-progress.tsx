"use client"

import { useQuery } from "@tanstack/react-query"
import type { RealtimeRun, RunStatus } from "@trigger.dev/core/v3"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"
import { Check, Image as ImageIcon, Loader2 } from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { RetryScrapeCard } from "@/components/retry-scrape-card.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { MAX_ADS } from "@/lib/scrape-limits.ts"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import type { ProductId } from "@/lib/types/ids.ts"
import { cn } from "@/lib/utils.ts"
import { getProductStatus } from "@/server/actions/products.ts"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"
import {
  type ScrapePhase,
  type ScrapeProgressMetadata,
  ScrapeProgressMetadataSchema,
} from "@/server/trigger/scrapeProduct/metadata.ts"

type ScrapeRun = RealtimeRun<typeof scrapeProduct>

interface StepDef {
  id: ScrapePhase
  label: string
}

const STEPS: readonly StepDef[] = [
  { id: "scraping", label: "Producto" },
  { id: "finding_ads", label: "Anuncios" },
  { id: "relevance_gating", label: "Relevancia" },
  { id: "transcribing", label: "Transcripción" },
  { id: "classifying", label: "Ángulos" },
]

function phaseIndex(phase: ScrapePhase): number {
  return STEPS.findIndex((s) => s.id === phase)
}

interface DerivedProgress {
  title: string
  detail: string
  progress: number
  activeIndex: number
}

function derive(
  runStatus: RunStatus | undefined,
  meta: ScrapeProgressMetadata | null,
): DerivedProgress {
  if (!runStatus || runStatus === "QUEUED" || runStatus === "PENDING_VERSION") {
    return {
      title: "Iniciando análisis…",
      detail: "Conectando con el agente de scraping.",
      progress: 4,
      activeIndex: 0,
    }
  }
  if (runStatus === "DELAYED" || runStatus === "DEQUEUED") {
    return {
      title: "En cola…",
      detail: "El agente arrancará en unos segundos.",
      progress: 8,
      activeIndex: 0,
    }
  }

  const phase = meta?.phase ?? "scraping"
  const activeIndex = phaseIndex(phase)

  if (phase === "scraping") {
    return {
      title: "Analizando la página del competidor…",
      detail: "Extrayendo nombre, imagen, categoría y keywords.",
      progress: 18,
      activeIndex,
    }
  }
  if (phase === "finding_ads") {
    const total = meta?.ladder_total
    const done = meta?.ladder_done ?? 0
    const current = meta?.ladder_current_keyword
    const fetched = meta?.ads_fetched
    const ladderProgress = total !== undefined && total > 0 ? done / total : 0
    return {
      title:
        current !== undefined
          ? `Probando "${current}" (${done.toString()}/${total?.toString() ?? "?"})`
          : "Buscando creativos en Meta Ad Library…",
      detail:
        fetched !== undefined
          ? `${fetched.toString()} anuncios encontrados hasta ahora.`
          : "Cada keyword toma 30-60 segundos.",
      progress: 32 + Math.round(ladderProgress * 12),
      activeIndex,
    }
  }
  if (phase === "relevance_gating") {
    const fetched = meta?.ads_fetched ?? 0
    const kept = meta?.ads_total
    return {
      title:
        kept === undefined
          ? `Filtrando ${fetched.toString()} anuncios por relevancia…`
          : `Filtrados ${kept.toString()} de ${fetched.toString()} anuncios`,
      detail: "Descartando spam y categorías no relacionadas.",
      progress: 44,
      activeIndex,
    }
  }
  if (phase === "transcribing") {
    const done = meta?.transcribed ?? 0
    const total = meta?.ads_total ?? 0
    const ratio = total > 0 ? Math.min(1, done / total) : 0
    return {
      title: `Transcribiendo videos (${done.toString()}/${total.toString()})`,
      detail: "Whisper está leyendo el audio de cada anuncio.",
      progress: 50 + Math.round(ratio * 40),
      activeIndex,
    }
  }
  return {
    title: "Clasificando ángulos creativos…",
    detail: "Cinco votos de Sonnet por anuncio para mayoría.",
    progress: 92,
    activeIndex,
  }
}

function pickLatestRun(runs: ScrapeRun[]): ScrapeRun | undefined {
  return runs.reduce<ScrapeRun | undefined>((latest, r) => {
    if (!latest) return r
    return new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime() ? r : latest
  }, undefined)
}

function parseMetadata(value: unknown): ScrapeProgressMetadata | null {
  const parsed = ScrapeProgressMetadataSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

interface ScrapeProgressProps {
  productId: ProductId
  accessToken: string
  sourceUrl: string
}

export function ScrapeProgress({ productId, accessToken, sourceUrl }: ScrapeProgressProps) {
  const router = useRouter()
  const [startedAt] = useState(() => Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)
  const refreshFiredRef = useRef(false)

  const { runs, error: realtimeError } = useRealtimeRunsWithTag<typeof scrapeProduct>(
    productTag(productId),
    { accessToken },
  )

  const run = useMemo(() => pickLatestRun(runs), [runs])
  const meta = useMemo(() => parseMetadata(run?.metadata), [run?.metadata])
  const status = run?.status

  const failed = isRunFailed(status)

  const { data: statusData } = useQuery({
    queryKey: ["product-status", productId],
    queryFn: async () => {
      const result = await getProductStatus(productId)
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    refetchInterval: realtimeError ? 5_000 : 15_000,
    refetchIntervalInBackground: true,
    enabled: !refreshFiredRef.current,
  })

  const dbStatus = statusData?.status
  const shouldRefresh =
    status === "COMPLETED" || (dbStatus !== undefined && dbStatus !== "SCRAPING")

  useEffect(() => {
    if (shouldRefresh && !refreshFiredRef.current) {
      refreshFiredRef.current = true
      router.refresh()
    }
  }, [shouldRefresh, router])

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [startedAt])

  if (failed) {
    // The DB write may not have landed yet. The next status poll fires
    // `router.refresh()` which re-renders SSR with the persisted reason.
    return <RetryScrapeCard productId={productId} sourceUrl={sourceUrl} reason={null} />
  }

  const { title, detail, progress, activeIndex } = derive(status, meta)
  const elapsedLabel = formatElapsed(elapsedSec)
  const displayUrl = formatSourceUrl(sourceUrl)

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-6">
        <div className="rounded-card bg-surface glass shadow-card border border-border p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg mb-2">
                Paso 2 · Buscando creativos
              </p>
              <h2 className="text-title truncate">{title}</h2>
              <p className="text-body text-fg-2 mt-1">{detail}</p>
              <p className="text-caption text-fg-3 mt-1 font-mono truncate" title={sourceUrl}>
                Analizando: {displayUrl}
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-pill border border-border bg-surface-elevated text-caption font-mono text-fg-2 tabular-nums">
              {elapsedLabel}
            </span>
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-2">
            {STEPS.map((step, idx) => {
              const state = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "pending"
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-center gap-2 rounded-pill border px-3 h-9 text-caption font-medium transition-colors",
                    state === "done" && "border-mode-web text-mode-web bg-mode-web-badge-bg",
                    state === "active" &&
                      "border-mode-live text-mode-live bg-mode-live-badge-bg shadow-tight",
                    state === "pending" && "border-border text-fg-3 bg-surface-elevated",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center size-5 rounded-full text-[11px] font-semibold shrink-0",
                      state === "done" && "bg-mode-web text-white",
                      state === "active" && "bg-mode-live text-white",
                      state === "pending" && "bg-surface-muted text-fg-3",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : state === "active" ? (
                      <Loader2 className="size-3 animate-spin" strokeWidth={3} />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="truncate">{step.label}</span>
                </li>
              )
            })}
          </ol>

          <DetectedPanel meta={meta} />

          <div className="mt-5 h-1.5 w-full rounded-pill bg-surface-muted overflow-hidden">
            <div
              className="h-full rounded-pill bg-mode-live transition-all duration-700 ease-out"
              style={{ width: `${progress.toString()}%` }}
            />
          </div>

          {realtimeError !== undefined ? (
            <p className="mt-3 text-caption text-fg-3">
              Conexión en vivo intermitente — seguimos sondeando el estado.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: meta?.ads_total ?? MAX_ADS }, (_, i) => `skel-${i.toString()}`).map(
            (skelId) => (
              <Skeleton key={skelId} className="aspect-[9/16] rounded-card" />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString()}:${s.toString().padStart(2, "0")}`
}

function formatSourceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === "/" ? "" : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return url
  }
}

interface DetectedPanelProps {
  meta: ScrapeProgressMetadata | null
}

function DetectedPanel({ meta }: DetectedPanelProps): React.JSX.Element {
  const productName = meta?.productName
  const imageUrl = meta?.imageUrls?.[0]
  const keywords = meta?.keywords
  const hasAny = productName !== undefined || imageUrl !== undefined

  return (
    <div className="mt-5 flex items-start gap-3 rounded-card border border-border bg-surface-elevated p-3 transition-opacity duration-300">
      <div className="size-14 rounded-card overflow-hidden bg-surface-muted flex items-center justify-center shrink-0 border border-border relative">
        {imageUrl !== undefined ? (
          <Image
            src={imageUrl}
            alt={productName ?? "Producto detectado"}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <ImageIcon className="size-5 text-fg-3" strokeWidth={1.5} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-caption font-semibold uppercase tracking-wide text-fg-3">Detectado</p>
        {productName !== undefined ? (
          <p className="text-body font-medium text-fg-1 truncate" title={productName}>
            {productName}
          </p>
        ) : (
          <Skeleton className="h-4 w-2/3 mt-1" />
        )}
        {keywords !== undefined && keywords.length > 0 ? (
          <KeywordChips keywords={keywords} className="mt-1.5" />
        ) : !hasAny ? (
          <Skeleton className="h-3 w-1/3 mt-1" />
        ) : null}
      </div>
    </div>
  )
}

const KEYWORD_CHIP_LIMIT = 6

interface KeywordChipsProps {
  keywords: readonly string[]
  className?: string
}

export function KeywordChips({ keywords, className }: KeywordChipsProps): React.JSX.Element | null {
  if (keywords.length === 0) return null
  const visible = keywords.slice(0, KEYWORD_CHIP_LIMIT)
  const overflow = keywords.length - visible.length
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {visible.map((kw) => (
        <span
          key={kw}
          className="inline-flex items-center h-6 px-2 rounded-pill border border-border bg-surface-muted text-caption text-fg-2"
        >
          {kw}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex items-center h-6 px-2 rounded-pill border border-border bg-surface-muted text-caption font-medium text-fg-3 tabular-nums">
          +{overflow.toString()} más
        </span>
      ) : null}
    </div>
  )
}
