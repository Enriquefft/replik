"use client"

import type { RealtimeRun, RunStatus } from "@trigger.dev/core/v3"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, Video } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef } from "react"
import { z } from "zod"
import type { Asset, Creative } from "@/db/schema"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import type { ProductId } from "@/lib/types/ids.ts"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs/index.ts"
import {
  type BurnPhase,
  BurnProgressMetadataSchema,
} from "@/server/trigger/translateAndBurnSubs/metadata.ts"

type CreativeWithAssets = Creative & { assets: Asset[] }
type BurnRun = RealtimeRun<typeof translateAndBurnSubsTask>

interface EditPageClientProps {
  productId: ProductId
  creatives: CreativeWithAssets[]
  accessToken: string
}

const BURN_TASK_ID = "translateAndBurnSubs"

const PHASE_LABEL: Record<BurnPhase, string> = {
  transcribe: "Transcribiendo audio",
  translate: "Traduciendo subtítulos",
  burn: "Quemando subtítulos",
  upload: "Subiendo video final",
}

const PHASE_PROGRESS: Record<BurnPhase, number> = {
  transcribe: 25,
  translate: 50,
  burn: 75,
  upload: 92,
}

// run.payload is typed via the hook generic but the runtime value still
// goes through trigger.dev's serialization layer. Parse defensively so a
// shape change can't crash the page.
const BurnPayloadSchema = z.object({ creativeId: z.string() })

function getCreativeIdFromRun(run: BurnRun): string | null {
  const parsed = BurnPayloadSchema.safeParse(run.payload)
  return parsed.success ? parsed.data.creativeId : null
}

function progressForRun(status: RunStatus | undefined, phase: BurnPhase | undefined): number {
  if (!status) return 5
  if (status === "QUEUED" || status === "PENDING_VERSION" || status === "DELAYED") return 8
  if (status === "DEQUEUED") return 14
  if (status === "COMPLETED") return 100
  if (phase) return PHASE_PROGRESS[phase]
  return 18
}

function pickLatestRun(a: BurnRun, b: BurnRun): BurnRun {
  return new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a
}

function downloadFilename(creative: CreativeWithAssets): string {
  const angle = creative.angle ?? "video"
  return `${angle.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${creative.id.slice(0, 8)}.mp4`
}

export function EditPageClient({ productId, creatives, accessToken }: EditPageClientProps) {
  const router = useRouter()
  const refreshFiredRef = useRef(false)

  const { runs, error: realtimeError } = useRealtimeRunsWithTag<typeof translateAndBurnSubsTask>(
    productTag(productId),
    { accessToken },
  )

  // Bucket the burn runs by creativeId, keep the latest per creative — re-runs
  // (failed → re-triggered) replace older attempts in the UI.
  const runByCreativeId = useMemo(() => {
    const map = new Map<string, BurnRun>()
    for (const run of runs) {
      if (run.taskIdentifier !== BURN_TASK_ID) continue
      const cid = getCreativeIdFromRun(run)
      if (cid === null) continue
      const existing = map.get(cid)
      map.set(cid, existing ? pickLatestRun(existing, run) : run)
    }
    return map
  }, [runs])

  const allDone =
    creatives.length > 0 && creatives.every((c) => c.assets.some((a) => a.kind === "edited_video"))
  const anyFailed = creatives.some((c) => {
    const run = runByCreativeId.get(c.id)
    return isRunFailed(run?.status)
  })

  // SSR fetched assets at first paint. When the realtime stream sees a burn
  // flip to COMPLETED the asset row exists but isn't on this RSC snapshot —
  // call router.refresh() once so the download URLs land. After that the
  // page renders the final state without further realtime calls.
  useEffect(() => {
    if (allDone || refreshFiredRef.current) return
    for (const c of creatives) {
      const hasAsset = c.assets.some((a) => a.kind === "edited_video")
      const run = runByCreativeId.get(c.id)
      if (!hasAsset && run?.status === "COMPLETED") {
        refreshFiredRef.current = true
        router.refresh()
        break
      }
    }
  }, [allDone, creatives, runByCreativeId, router])

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
      {realtimeError !== undefined ? (
        <div className="rounded-card border border-border bg-surface-elevated px-4 py-2 text-caption text-fg-3">
          Conexión en vivo intermitente — refresca si el progreso queda atascado.
        </div>
      ) : null}

      {creatives.map((creative) => {
        const editedVideo = creative.assets.find((a) => a.kind === "edited_video")
        const run = runByCreativeId.get(creative.id)
        return (
          <CreativeRow key={creative.id} creative={creative} editedVideo={editedVideo} run={run} />
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

interface CreativeRowProps {
  creative: CreativeWithAssets
  editedVideo: Asset | undefined
  run: BurnRun | undefined
}

function CreativeRow({ creative, editedVideo, run }: CreativeRowProps) {
  const isDone = !!editedVideo
  const failed = isRunFailed(run?.status)
  const meta = useMemo(() => {
    const parsed = BurnProgressMetadataSchema.safeParse(run?.metadata)
    return parsed.success ? parsed.data : null
  }, [run?.metadata])
  const phase = meta?.phase
  const progress = isDone ? 100 : progressForRun(run?.status, phase)

  return (
    <div className="rounded-card bg-surface glass border border-border shadow-tight overflow-hidden">
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
          <RowStatus
            isDone={isDone}
            failed={failed}
            phase={phase}
            errorMessage={extractErrorMessage(run)}
          />
          {!isDone && !failed ? (
            <div className="mt-2 h-1 w-full rounded-pill bg-surface-muted overflow-hidden">
              <div
                className="h-full rounded-pill bg-mode-live transition-all duration-700 ease-out"
                style={{ width: `${progress.toString()}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {editedVideo ? (
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
      ) : null}
    </div>
  )
}

interface RowStatusProps {
  isDone: boolean
  failed: boolean
  phase: BurnPhase | undefined
  errorMessage: string | null
}

function RowStatus({ isDone, failed, phase, errorMessage }: RowStatusProps) {
  if (failed) {
    return (
      <div className="flex items-start gap-1.5 mt-2">
        <AlertTriangle className="size-4 text-mode-traffic shrink-0 mt-0.5" strokeWidth={1.8} />
        <span className="text-caption text-mode-traffic">
          Falló la edición.{errorMessage !== null ? ` ${errorMessage}` : ""} Vuelve al paso anterior
          y reintenta la selección.
        </span>
      </div>
    )
  }
  if (isDone) {
    return (
      <div className="flex items-center gap-1.5 mt-2">
        <CheckCircle2 className="size-4 text-mode-web" strokeWidth={1.8} />
        <span className="text-caption text-mode-web-badge-fg font-medium">Listo</span>
      </div>
    )
  }
  const label = phase ? PHASE_LABEL[phase] : "Procesando…"
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <Loader2 className="size-4 text-mode-live animate-spin" strokeWidth={1.8} />
      <span className="text-caption text-mode-live font-medium">{label}</span>
    </div>
  )
}

function extractErrorMessage(run: BurnRun | undefined): string | null {
  if (!run || run.error === undefined) return null
  return run.error.message.slice(0, 200)
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
