"use client"

import type { RealtimeRun } from "@trigger.dev/core/v3"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"
import { CheckCircle2, Clock, Download, Loader2, Video } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { z } from "zod"
import { PhaseProgress } from "@/components/phase-progress.tsx"
import type { Asset, Creative } from "@/db/schema"
import { useRefreshOnComplete } from "@/hooks/use-refresh-on-complete.ts"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import type { ProductId } from "@/lib/types/ids.ts"
import type { rehostCreativesTask } from "@/server/trigger/rehostCreatives"
import {
  REHOST_PHASE_LABELS_ES,
  REHOST_PHASE_WEIGHTS,
  REHOST_PHASES,
  type RehostPhase,
  type RehostProgressMetadata,
  RehostProgressMetadataSchema,
} from "@/server/trigger/rehostCreatives/metadata.ts"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs/index.ts"
import {
  BURN_PHASE_LABELS_ES,
  BURN_PHASE_WEIGHTS,
  BURN_PHASES,
  type BurnPhase,
  type BurnProgressMetadata,
  BurnProgressMetadataSchema,
} from "@/server/trigger/translateAndBurnSubs/metadata.ts"

type CreativeWithAssets = Creative & { assets: Asset[] }
type BurnRun = RealtimeRun<typeof translateAndBurnSubsTask>
type RehostRun = RealtimeRun<typeof rehostCreativesTask>

interface EditPageClientProps {
  productId: ProductId
  creatives: CreativeWithAssets[]
  accessToken: string
}

const BURN_TASK_ID = "translateAndBurnSubs"
const REHOST_TASK_ID = "rehostCreatives"

const BurnPayloadSchema = z.object({ creativeId: z.string() })

function getCreativeIdFromRun(run: BurnRun): string | null {
  const parsed = BurnPayloadSchema.safeParse(run.payload)
  return parsed.success ? parsed.data.creativeId : null
}

function pickLatestRun<T extends { createdAt: Date | string }>(runs: T[]): T | undefined {
  return runs.reduce<T | undefined>((latest, r) => {
    if (!latest) return r
    return new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime() ? r : latest
  }, undefined)
}

function downloadFilename(creative: CreativeWithAssets): string {
  const angle = creative.angle ?? "video"
  return `${angle.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${creative.id.slice(0, 8)}.mp4`
}

export function EditPageClient({ productId, creatives, accessToken }: EditPageClientProps) {
  // Two tag-scoped subscriptions on the same productTag — one typed per task
  // kind so we avoid widening the run type to `AnyRealtimeRun`. The SDK
  // multiplexes them onto the same underlying websocket, so the cost is one
  // socket regardless of how many `useRealtimeRunsWithTag` calls share a
  // tag. Each hook still filters by `taskIdentifier` at runtime since the
  // tag carries both rehost and burn runs.
  const { runs: rehostRuns } = useRealtimeRunsWithTag<typeof rehostCreativesTask>(
    productTag(productId),
    { accessToken },
  )
  const { runs: burnRuns } = useRealtimeRunsWithTag<typeof translateAndBurnSubsTask>(
    productTag(productId),
    { accessToken },
  )

  // Latest rehost run for this product — rehostCreatives runs once per
  // `selectCreatives` action, but the user can retry, so pick the newest.
  const rehostRun: RehostRun | undefined = useMemo(() => {
    const filtered = rehostRuns.filter((r) => r.taskIdentifier === REHOST_TASK_ID)
    return pickLatestRun(filtered)
  }, [rehostRuns])

  // Bucket the burn runs by creativeId, keep the latest per creative — re-runs
  // (failed → re-triggered) replace older attempts in the UI.
  const runByCreativeId = useMemo(() => {
    const map = new Map<string, BurnRun>()
    for (const r of burnRuns) {
      if (r.taskIdentifier !== BURN_TASK_ID) continue
      const cid = getCreativeIdFromRun(r)
      if (cid === null) continue
      const existing = map.get(cid)
      const winner =
        existing && new Date(existing.createdAt).getTime() > new Date(r.createdAt).getTime()
          ? existing
          : r
      map.set(cid, winner)
    }
    return map
  }, [burnRuns])

  const allDone =
    creatives.length > 0 && creatives.every((c) => c.assets.some((a) => a.kind === "edited_video"))
  const anyFailed = creatives.some((c) => {
    const run = runByCreativeId.get(c.id)
    return isRunFailed(run?.status)
  })

  // SSR fetched assets at first paint. When realtime sees a burn flip to
  // COMPLETED, the asset row exists but isn't on the RSC snapshot we have —
  // calling `router.refresh()` pulls it back in. The hook below fires once
  // when ALL creatives report done; each per-creative `<PhaseProgress>`
  // additionally fires its own internal refresh on individual completion so
  // download URLs land as soon as each burn finishes.
  useRefreshOnComplete(allDone)

  if (creatives.length === 0) {
    return (
      <div className="text-center py-12 text-fg-2">
        <p className="text-body">
          No hay creativos seleccionados.{" "}
          <Link href={`/products/${productId}`} className="underline">
            Volver al paso anterior
          </Link>{" "}
          y elige al menos uno.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {rehostRun !== undefined && rehostRun.status !== "COMPLETED" ? (
        <PhaseProgress<RehostPhase, RehostProgressMetadata>
          runId={rehostRun.id}
          accessToken={accessToken}
          phases={REHOST_PHASES}
          phaseWeights={REHOST_PHASE_WEIGHTS}
          phaseLabels={REHOST_PHASE_LABELS_ES}
          metadataSchema={RehostProgressMetadataSchema}
          taskKind="rehost_creatives"
          currentPhaseFromMeta={(m) => m.phase ?? null}
          headerSlot={() => <RehostHeader count={creatives.length} />}
          detailSlot={(meta) => <RehostDetail meta={meta} />}
        />
      ) : null}

      {creatives.map((creative) => {
        const editedVideo = creative.assets.find((a) => a.kind === "edited_video")
        const run = runByCreativeId.get(creative.id)
        return (
          <CreativeRow
            key={creative.id}
            creative={creative}
            editedVideo={editedVideo}
            run={run}
            accessToken={accessToken}
          />
        )
      })}

      <div className="flex items-center justify-between gap-3 mt-4">
        {anyFailed ? (
          <Link
            href={`/products/${productId}`}
            className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-border bg-surface text-callout font-medium text-fg-1 hover:bg-surface-muted transition-colors"
          >
            ← Reintentar selección
          </Link>
        ) : (
          <span />
        )}
        <ContinueButton productId={productId} disabled={!allDone} />
      </div>
    </div>
  )
}

interface RehostHeaderProps {
  count: number
}

function RehostHeader({ count }: RehostHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption font-semibold uppercase tracking-widest text-mode-creative-badge-fg">
        Procesando {count.toString()} {count === 1 ? "creativo" : "creativos"}
      </p>
      <p className="text-caption text-fg-3">
        Subiendo originales a UploadThing y luego editando subtítulos en cada video.
      </p>
    </div>
  )
}

interface RehostDetailProps {
  meta: RehostProgressMetadata | null
}

function RehostDetail({ meta }: RehostDetailProps): React.JSX.Element | null {
  if (meta === null) return null
  const phase = meta.phase

  if (phase === "rehosting") {
    const rehosted = meta.rehosted
    const already = meta.alreadyHosted ?? 0
    return (
      <p className="text-body text-fg-2">
        {rehosted !== undefined
          ? `Subidos ${rehosted.toString()} originales (${already.toString()} ya estaban)`
          : "Copiando los originales a nuestro almacenamiento…"}
      </p>
    )
  }

  if (phase === "burning") {
    const total = meta.burnTotal
    const done = meta.burnDone ?? 0
    return (
      <p className="text-body text-fg-2">
        {total !== undefined
          ? `Editando videos (${done.toString()}/${total.toString()})`
          : "Editando videos…"}
      </p>
    )
  }

  return null
}

interface CreativeRowProps {
  creative: CreativeWithAssets
  editedVideo: Asset | undefined
  run: BurnRun | undefined
  accessToken: string
}

function CreativeRow({ creative, editedVideo, run, accessToken }: CreativeRowProps) {
  const isDone = !!editedVideo

  // Done branch: assets exist on the SSR snapshot, no realtime needed —
  // render the static success row with the player + download CTA.
  if (isDone && editedVideo) {
    return (
      <div className="rounded-card bg-surface glass border border-border shadow-tight overflow-hidden">
        <CreativeRowHeader creative={creative} statusSlot={<DoneBadge />} />
        <div className="border-t border-border p-4 flex flex-col gap-3">
          <video
            src={editedVideo.url}
            controls
            className="w-full max-h-64 rounded-control bg-black"
            preload="metadata"
          >
            <track kind="captions" />
          </video>
          <a
            href={editedVideo.url}
            download={downloadFilename(creative)}
            className="inline-flex items-center justify-center gap-2 self-start h-9 px-4 rounded-lg border border-border bg-surface-elevated text-callout font-medium text-fg-1 hover:bg-surface-muted transition-colors"
          >
            <Download className="size-4" strokeWidth={1.8} />
            Descargar MP4
          </a>
        </div>
      </div>
    )
  }

  // Pre-run branch: the burn run hasn't surfaced on the realtime stream yet
  // (rehost is still uploading originals). Show a stable waiting card so the
  // grid doesn't flicker between an empty space and the eventual progress.
  if (run === undefined) {
    return (
      <div className="rounded-card bg-surface glass border border-border shadow-tight p-4">
        <CreativeRowHeader creative={creative} statusSlot={<WaitingBadge />} />
      </div>
    )
  }

  return (
    <div className="rounded-card bg-surface glass border border-border shadow-tight overflow-hidden">
      <CreativeRowHeader creative={creative} />
      <div className="border-t border-border p-4">
        <PhaseProgress<BurnPhase, BurnProgressMetadata>
          runId={run.id}
          accessToken={accessToken}
          phases={BURN_PHASES}
          phaseWeights={BURN_PHASE_WEIGHTS}
          phaseLabels={BURN_PHASE_LABELS_ES}
          metadataSchema={BurnProgressMetadataSchema}
          taskKind="translate_burn"
          currentPhaseFromMeta={(m) => m.phase ?? null}
        />
      </div>
    </div>
  )
}

interface CreativeRowHeaderProps {
  creative: CreativeWithAssets
  statusSlot?: React.ReactNode
}

function CreativeRowHeader({ creative, statusSlot }: CreativeRowHeaderProps) {
  return (
    <div className="flex items-start gap-4 p-4">
      <div className="size-10 rounded-control bg-mode-creative-badge-bg flex items-center justify-center shrink-0">
        <Video className="size-5 text-mode-creative" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-callout font-semibold text-fg-1 truncate">
            {creative.angle ?? "Video sin clasificar"}
          </p>
          {creative.language !== null && creative.language !== "es" ? (
            <span className="inline-flex items-center h-5 px-2 rounded-pill bg-mode-creative-badge-bg text-mode-creative-badge-fg text-[10px] font-semibold uppercase">
              {creative.language} → ES
            </span>
          ) : null}
        </div>
        {creative.transcriptText !== null && creative.transcriptText.length > 0 ? (
          <p className="text-caption text-fg-2 line-clamp-2">
            &ldquo;{creative.transcriptText.slice(0, 120)}&rdquo;
          </p>
        ) : null}
        {statusSlot}
      </div>
    </div>
  )
}

function DoneBadge(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <CheckCircle2 className="size-4 text-mode-web" strokeWidth={1.8} />
      <span className="text-caption text-mode-web-badge-fg font-medium">Listo</span>
    </div>
  )
}

function WaitingBadge(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <Loader2 className="size-4 text-mode-live animate-spin" strokeWidth={1.8} />
      <span className="text-caption text-mode-live font-medium">Esperando en cola…</span>
    </div>
  )
}

interface ContinueButtonProps {
  productId: ProductId
  disabled: boolean
}

function ContinueButton({ productId, disabled }: ContinueButtonProps) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-surface-muted text-callout font-medium text-fg-3 cursor-not-allowed"
      >
        <Clock className="size-4" strokeWidth={1.8} />
        Esperando edición…
      </span>
    )
  }
  return (
    <Link
      href={`/products/${productId}/landing`}
      className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-callout font-medium hover:bg-primary/80 transition-colors"
    >
      Continuar → Landing
    </Link>
  )
}
