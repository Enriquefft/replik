"use client"

import { useQuery } from "@tanstack/react-query"
import type { RealtimeRun } from "@trigger.dev/core/v3"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"
import { Image as ImageIcon, Loader2 } from "lucide-react"
import Image from "next/image"
import { useMemo } from "react"
import { PhaseProgress } from "@/components/phase-progress.tsx"
import { RetryScrapeCard } from "@/components/retry-scrape-card.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { useRefreshOnComplete } from "@/hooks/use-refresh-on-complete.ts"
import { MAX_ADS } from "@/lib/scrape-limits.ts"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import type { ProductId } from "@/lib/types/ids.ts"
import { cn } from "@/lib/utils.ts"
import { getProductStatus } from "@/server/actions/products.ts"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"
import {
  SCRAPE_PHASE_LABELS_ES,
  SCRAPE_PHASE_WEIGHTS,
  SCRAPE_PHASES,
  type ScrapePhase,
  type ScrapeProgressMetadata,
  ScrapeProgressMetadataSchema,
} from "@/server/trigger/scrapeProduct/metadata.ts"

type ScrapeRun = RealtimeRun<typeof scrapeProduct>

/**
 * Maximum skeleton cards rendered on `<sm` viewports. The desktop grid is
 * 4-up so 4 rows = 16 cards comfortably fit; phones are 2-up, so 6 cards
 * (= 3 rows) keeps the skeleton bounded to one viewport-ish without
 * dwarfing the actual progress card above.
 */
const MOBILE_SKELETON_CAP = 6

function pickLatestRun(runs: ScrapeRun[]): ScrapeRun | undefined {
  return runs.reduce<ScrapeRun | undefined>((latest, r) => {
    if (!latest) return r
    return new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime() ? r : latest
  }, undefined)
}

interface ScrapeProgressProps {
  productId: ProductId
  accessToken: string
  sourceUrl: string
}

export function ScrapeProgress({ productId, accessToken, sourceUrl }: ScrapeProgressProps) {
  // Subscribe by tag — the run is already in flight when the user lands on
  // this page (status===SCRAPING in SSR); we don't have a server-supplied
  // runId. The latest tagged run becomes the canonical run id we pass into
  // `<PhaseProgress>`. `<PhaseProgress>` re-subscribes to that run id; the
  // tag-subscription stream and the run-subscription stream share the same
  // backend socket so this is cheap.
  const { runs, error: realtimeError } = useRealtimeRunsWithTag<typeof scrapeProduct>(
    productTag(productId),
    { accessToken },
  )

  const run = useMemo(() => pickLatestRun(runs), [runs])
  const status = run?.status
  const failed = isRunFailed(status)

  // Polling fallback — covers the case where realtime stops emitting before
  // the run flips to COMPLETED. The product row's `status` column is the
  // ultimate source of truth: anything other than `SCRAPING` means the task
  // wrote a terminal state and the RSC snapshot needs to be refetched so
  // the page can re-render past this client.
  const { data: statusData } = useQuery({
    queryKey: ["product-status", productId],
    queryFn: async () => {
      const result = await getProductStatus(productId)
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    refetchInterval: realtimeError !== undefined ? 5_000 : 15_000,
    refetchIntervalInBackground: true,
  })

  const dbStatus = statusData?.status
  const dbStatusDone = dbStatus !== undefined && dbStatus !== "SCRAPING"
  useRefreshOnComplete(dbStatusDone)

  if (failed) {
    // The DB write may not have landed yet. The next status poll fires
    // `router.refresh()` which re-renders SSR with the persisted reason.
    return <RetryScrapeCard productId={productId} sourceUrl={sourceUrl} reason={null} />
  }

  const displayUrl = formatSourceUrl(sourceUrl)
  const adsTotalForSkeletons = parseAdsTotalFromMeta(run?.metadata) ?? MAX_ADS

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg">
            Paso 2 · Buscando creativos
          </p>
          <p className="text-caption text-fg-3 font-mono truncate" title={sourceUrl}>
            Analizando: {displayUrl}
          </p>
        </div>

        {/* Stable aria-live wrapper across the bootstrap → phase-progress
            handoff. Without this, screen readers see two distinct live
            regions appear and disappear (one on BootstrapCard, one on
            PhaseProgress), which can drop or duplicate announcements during
            the swap. Wrapping both in a single persistent `aria-live="polite"`
            container makes the transition feel like a single region whose
            *content* changes — which is what the user actually perceives. */}
        <div aria-live="polite" aria-busy={run === undefined || !isRunFailed(status)}>
          {run !== undefined ? (
            <PhaseProgress<ScrapePhase, ScrapeProgressMetadata>
              runId={run.id}
              accessToken={accessToken}
              phases={SCRAPE_PHASES}
              phaseWeights={SCRAPE_PHASE_WEIGHTS}
              phaseLabels={SCRAPE_PHASE_LABELS_ES}
              metadataSchema={ScrapeProgressMetadataSchema}
              taskKind="scrape_product"
              currentPhaseFromMeta={(m) => m.phase ?? null}
              headerSlot={(meta) => <DetectedPanel meta={meta} />}
              detailSlot={(meta) => <ScrapeDetail meta={meta} />}
            />
          ) : (
            <BootstrapCard />
          )}
        </div>

        {/* Cap to MOBILE_SKELETON_CAP on `<sm` so a typical phone (≥1 viewport
            height of skeletons) doesn't drown the progress card. On sm+ we
            render the full ladder count so the layout matches what the
            results grid will look like once ads land. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: adsTotalForSkeletons }, (_, i) => ({
            id: `skel-${i.toString()}`,
            mobileVisible: i < MOBILE_SKELETON_CAP,
          })).map((skel) => (
            <Skeleton
              key={skel.id}
              className={cn("aspect-[9/16] rounded-card", !skel.mobileVisible && "hidden sm:block")}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Parse `meta.ads_total` off the unsanitized realtime payload so the skeleton
 * grid can size itself even before `<PhaseProgress>`'s first parse lands.
 * Uses the same SSOT Zod schema the inner component uses, then projects to
 * the single field this caller cares about.
 */
function parseAdsTotalFromMeta(value: unknown): number | undefined {
  const parsed = ScrapeProgressMetadataSchema.safeParse(value)
  return parsed.success ? parsed.data.ads_total : undefined
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

/**
 * Tiny stand-in card shown for the first ~second between SSR landing on the
 * SCRAPING status and the tag-stream surfacing the in-flight run id. Keeps
 * the layout stable so the page doesn't shift when `<PhaseProgress>` mounts.
 */
function BootstrapCard(): React.JSX.Element {
  // No `aria-live` here — the parent in `<ScrapeProgress>` owns a single
  // stable `aria-live="polite"` region that wraps both BootstrapCard and
  // PhaseProgress so the handoff doesn't drop announcements.
  return (
    <div
      className="rounded-card bg-surface glass shadow-card border border-border p-6 flex items-center gap-3"
      aria-busy="true"
    >
      <Loader2 className="size-5 animate-spin text-mode-live" strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg mb-1">
          Iniciando
        </p>
        <h2 className="text-title truncate">Conectando con el agente de scraping…</h2>
      </div>
    </div>
  )
}

interface ScrapeDetailProps {
  meta: ScrapeProgressMetadata | null
}

/**
 * Phase-specific contextual narration rendered below the progress bar. Reads
 * the same SSOT phase descriptions as `<PhaseProgress>` from
 * `SCRAPE_PHASE_LABELS_ES`, then augments with per-counter detail when the
 * task has emitted enough to be specific:
 *
 *   - `finding_ads`     → "Probando '{kw}' ({done}/{total})" + ads-fetched badge.
 *   - `relevance_gating`→ "Filtrados X de Y" or pre-verdict "Filtrando…".
 *   - `transcribing`    → "{done}/{total} videos transcritos".
 *   - `classifying`     → static description.
 *   - `scraping` / null → static description.
 */
function ScrapeDetail({ meta }: ScrapeDetailProps): React.JSX.Element | null {
  if (meta === null) return null
  const phase = meta.phase

  if (phase === "finding_ads") {
    const total = meta.ladder_total
    const done = meta.ladder_done ?? 0
    const current = meta.ladder_current_keyword
    const fetched = meta.ads_fetched
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-fg-2">
          {current !== undefined
            ? `Probando "${current}" (${done.toString()}/${total?.toString() ?? "?"})`
            : "Buscando creativos en Meta Ad Library y TikTok…"}
        </p>
        {fetched !== undefined ? <AdCountBadge count={fetched} /> : null}
      </div>
    )
  }

  if (phase === "relevance_gating") {
    const fetched = meta.ads_fetched ?? 0
    const kept = meta.ads_total
    return (
      <p className="text-body text-fg-2">
        {kept === undefined
          ? `Filtrando ${fetched.toString()} anuncios por relevancia…`
          : `Filtrados ${kept.toString()} de ${fetched.toString()} anuncios`}
      </p>
    )
  }

  if (phase === "transcribing") {
    const done = meta.transcribed ?? 0
    const total = meta.ads_total ?? 0
    return (
      <p className="text-body text-fg-2">
        Transcribiendo videos ({done.toString()}/{total.toString()})
      </p>
    )
  }

  // `scraping` and `classifying` already have their static SSOT description
  // surfaced by `<PhaseProgress>`'s status line — no extra detail to add.
  return null
}

interface AdCountBadgeProps {
  count: number
}

function AdCountBadge({ count }: AdCountBadgeProps): React.JSX.Element {
  return (
    <span className="self-start inline-flex items-center h-6 px-2 rounded-pill border border-border bg-surface-elevated text-caption font-mono text-fg-2 tabular-nums">
      {count.toString()} anuncios
    </span>
  )
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
    <div className="flex items-start gap-3 rounded-card border border-border bg-surface-elevated p-3 transition-opacity duration-300">
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
