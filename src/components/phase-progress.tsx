"use client"

import type { AnyRealtimeRun, RunStatus } from "@trigger.dev/core/v3"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { AlertTriangle, Check, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { z } from "zod"
import { useConnectionState } from "@/hooks/use-connection-state.ts"
import { useRefreshOnComplete } from "@/hooks/use-refresh-on-complete.ts"
import { useTaskNarration } from "@/hooks/use-task-narration.ts"
import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { PhaseLabel } from "@/lib/phase.ts"
import type { TaskKind } from "@/lib/task-kind.ts"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { cn } from "@/lib/utils.ts"
import { translateRunError } from "@/server/actions/translate-error.ts"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PhaseProgressProps<Phase extends string, Meta> {
  /** Trigger.dev run id from the server action's `tasks.trigger` handle. */
  runId: string
  /** Public access token scoped to this run id (`auth.createPublicToken`). */
  accessToken: string
  /** Ordered phase IDs from the task's metadata.ts. SSOT — never inlined. */
  phases: readonly Phase[]
  /** Per-phase weight summing to 100. */
  phaseWeights: Record<Phase, number>
  /** Spanish UI strings for the rail + status line. */
  phaseLabels: Record<Phase, PhaseLabel>
  /** Zod schema for the run's broadcast metadata. */
  metadataSchema: z.ZodType<Meta>
  /** Task kind — drives error-translator lookup. */
  taskKind: TaskKind
  /** Extractor — pulls the current phase out of parsed metadata. */
  currentPhaseFromMeta: (meta: Meta) => Phase | null
  /** Optional header slot rendered above the phase rail. */
  headerSlot?: (meta: Meta | null) => React.ReactNode
  /** Optional detail slot rendered below the progress bar. */
  detailSlot?: (meta: Meta | null) => React.ReactNode
  /** Override the default failed-state error card. */
  errorSlot?: (err: TranslatedError) => React.ReactNode
  /** Fires once when the run reaches `COMPLETED`. */
  onComplete?: () => void
  /**
   * Fires when the user clicks the retry action on the failure card. The
   * caller is expected to re-invoke the originating server action and
   * mount a fresh run — leave undefined to fall back to `router.refresh()`
   * (whose button label switches to "Refrescar" to stay honest).
   */
  onRetry?: () => void
  /** Show a "stuck" banner if no metadata update lands within this window. */
  stuckThresholdMs?: number
  /** Extra className on the outer container. */
  className?: string
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const DEFAULT_STUCK_MS = 5 * 60 * 1000

function computeProgressPct<Phase extends string>(
  current: Phase | null,
  phases: readonly Phase[],
  weights: Record<Phase, number>,
): number {
  if (current === null) return 0
  const idx = phases.indexOf(current)
  if (idx < 0) return 0
  let cumulativeBefore = 0
  for (let i = 0; i < idx; i++) {
    const p = phases[i]
    if (p === undefined) continue
    cumulativeBefore += weights[p]
  }
  // The active phase counts as half-complete for the bar — visited phases
  // are 100%, the active is 50% of its weight, upcoming are 0%. This yields
  // a smooth bar that doesn't snap to the next bucket the instant the
  // metadata flips.
  const activeWeight = weights[current]
  return Math.min(100, Math.round(cumulativeBefore + activeWeight / 2))
}

function deriveDone(status: RunStatus | undefined): boolean {
  return status === "COMPLETED"
}

function formatElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h.toString()}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m.toString()}:${s.toString().padStart(2, "0")}`
}

// Strongly-typed extractor — `RealtimeRun.error` is `{ message, name }` |
// undefined. We pull the message and feed it to `parseTaskErrorPayload`
// so structured errors thrown via `taskError(...)` round-trip cleanly.
function extractErrorContext(run: AnyRealtimeRun | undefined): {
  code: string | null
  raw: string
} | null {
  if (run === undefined) return null
  const err = run.error
  if (err === undefined) return null
  const raw = err.message
  if (typeof raw !== "string" || raw.length === 0) return null
  const payload = parseTaskErrorPayload(raw)
  if (payload === null) {
    return { code: null, raw }
  }
  return { code: payload.code, raw: payload.message }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaseProgress<Phase extends string, Meta>(
  props: PhaseProgressProps<Phase, Meta>,
): React.JSX.Element {
  const {
    runId,
    accessToken,
    phases,
    phaseWeights,
    phaseLabels,
    metadataSchema,
    taskKind,
    currentPhaseFromMeta,
    headerSlot,
    detailSlot,
    errorSlot,
    onComplete,
    onRetry,
    stuckThresholdMs = DEFAULT_STUCK_MS,
    className,
  } = props

  const { run, error: realtimeError } = useRealtimeRun(runId, { accessToken })
  const status = run?.status

  // Keep the last-known-good metadata so a parse failure doesn't blank
  // the UI mid-run. Re-parse on every render; only commit when the parse
  // succeeds. Using `useMemo` here would still recompute on every metadata
  // change — `useState` + the effect below is the cheapest way to retain.
  const [lastGoodMeta, setLastGoodMeta] = useState<Meta | null>(null)
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null)

  useEffect(() => {
    if (run?.metadata === undefined) return
    const parsed = metadataSchema.safeParse(run.metadata)
    if (parsed.success) {
      setLastGoodMeta(parsed.data)
      setLastUpdateAt(Date.now())
    }
  }, [run?.metadata, metadataSchema])

  const meta = lastGoodMeta
  const currentPhase = useMemo(
    () => (meta === null ? null : currentPhaseFromMeta(meta)),
    [meta, currentPhaseFromMeta],
  )
  const progressPct = useMemo(
    () => computeProgressPct(currentPhase, phases, phaseWeights),
    [currentPhase, phases, phaseWeights],
  )

  const done = deriveDone(status)
  const failed = isRunFailed(status)

  // Fire `onComplete` exactly once.
  const completeFiredRef = useRef(false)
  useEffect(() => {
    if (!done || completeFiredRef.current) return
    completeFiredRef.current = true
    onComplete?.()
  }, [done, onComplete])

  useRefreshOnComplete(done)

  // ─── Elapsed timer ─────────────────────────────────────────────────────────
  const [startedAt] = useState(() => Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    if (done || failed) return
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    }, 1_000)
    return () => {
      clearInterval(id)
    }
  }, [startedAt, done, failed])

  // ─── Connection banner ─────────────────────────────────────────────────────
  const connectionState = useConnectionState({ realtimeError, lastUpdateAt })

  // ─── Stuck banner ──────────────────────────────────────────────────────────
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (done || failed) return
    const id = setInterval(() => {
      setNowMs(Date.now())
    }, 10_000)
    return () => {
      clearInterval(id)
    }
  }, [done, failed])
  const stuck = !done && !failed && lastUpdateAt !== null && nowMs - lastUpdateAt > stuckThresholdMs

  // ─── Error translation (async, kicked off when status flips to failed) ────
  const [translatedError, setTranslatedError] = useState<TranslatedError | null>(null)
  const translateRequestedRef = useRef(false)

  const requestTranslate = useCallback(
    async (ctx: { code: string | null; raw: string }) => {
      const result = await translateRunError({
        code: ctx.code,
        raw: ctx.raw,
        taskKind,
      })
      setTranslatedError(result)
    },
    [taskKind],
  )

  useEffect(() => {
    if (!failed || translateRequestedRef.current) return
    const ctx = extractErrorContext(run)
    if (ctx === null) return
    translateRequestedRef.current = true
    void requestTranslate(ctx)
  }, [failed, run, requestTranslate])

  // ─── Render ────────────────────────────────────────────────────────────────

  const activeIndex = currentPhase === null ? -1 : phases.indexOf(currentPhase)

  return (
    <div
      aria-busy={!done && !failed}
      aria-live="polite"
      className={cn(
        "rounded-card bg-surface glass shadow-card border border-border p-6",
        className,
      )}
    >
      {headerSlot !== undefined ? <div className="mb-4">{headerSlot(meta)}</div> : null}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <PhaseStatusLine
            currentPhase={currentPhase}
            phaseLabels={phaseLabels}
            status={status}
            done={done}
            failed={failed}
            taskKind={taskKind}
            meta={meta}
          />
        </div>
        <span className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-pill border border-border bg-surface-elevated text-caption font-mono text-fg-2 tabular-nums">
          {formatElapsed(elapsedSec)}
        </span>
      </div>

      <ol
        className="mt-5 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${phases.length.toString()}, minmax(0, 1fr))` }}
      >
        {phases.map((phase, idx) => {
          const state = failed
            ? idx <= activeIndex
              ? "failed"
              : "pending"
            : idx < activeIndex
              ? "done"
              : idx === activeIndex
                ? "active"
                : done
                  ? "done"
                  : "pending"
          const label = phaseLabels[phase].label
          return (
            <li
              key={phase}
              className={cn(
                "flex items-center gap-2 rounded-pill border px-3 h-9 text-caption font-medium transition-colors",
                state === "done" && "border-mode-web text-mode-web bg-mode-web-badge-bg",
                state === "active" &&
                  "border-mode-live text-mode-live bg-mode-live-badge-bg shadow-tight",
                state === "failed" &&
                  "border-mode-traffic text-mode-traffic bg-mode-traffic-badge-bg",
                state === "pending" && "border-border text-fg-3 bg-surface-elevated",
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center size-5 rounded-full text-[11px] font-semibold shrink-0",
                  state === "done" && "bg-mode-web text-white",
                  state === "active" && "bg-mode-live text-white",
                  state === "failed" && "bg-mode-traffic text-white",
                  state === "pending" && "bg-surface-muted text-fg-3",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : state === "active" ? (
                  <Loader2 className="size-3 animate-spin" strokeWidth={3} />
                ) : state === "failed" ? (
                  <AlertTriangle className="size-3" strokeWidth={3} />
                ) : (
                  idx + 1
                )}
              </span>
              <span className="truncate">{label}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-5 h-1.5 w-full rounded-pill bg-surface-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-pill transition-all duration-700 ease-out",
            failed ? "bg-mode-traffic" : done ? "bg-mode-web" : "bg-mode-live",
          )}
          style={{ width: `${(done ? 100 : progressPct).toString()}%` }}
        />
      </div>

      {detailSlot !== undefined ? <div className="mt-4">{detailSlot(meta)}</div> : null}

      <ConnectionBanner state={connectionState} />
      {stuck ? <StuckBanner /> : null}
      {failed ? (
        <FailedCard
          translated={translatedError}
          errorSlot={errorSlot}
          {...(onRetry !== undefined && { onRetry })}
        />
      ) : null}
    </div>
  )
}

// ─── Subviews ────────────────────────────────────────────────────────────────

interface PhaseStatusLineProps<Phase extends string, Meta> {
  currentPhase: Phase | null
  phaseLabels: Record<Phase, PhaseLabel>
  status: RunStatus | undefined
  done: boolean
  failed: boolean
  taskKind: TaskKind
  meta: Meta | null
}

function PhaseStatusLine<Phase extends string, Meta>(
  props: PhaseStatusLineProps<Phase, Meta>,
): React.JSX.Element {
  const { currentPhase, phaseLabels, status, done, failed, taskKind, meta } = props
  // The narration hook is called unconditionally (rules-of-hooks). It
  // returns the deterministic template until the LLM lands a contextual
  // sentence, then swaps to the LLM text. We only render the result
  // inside the "in process" branch — the failed/done/queued branches
  // have fixed copy that doesn't benefit from narration.
  const metadataJson = useMemo(() => {
    if (meta === null) return "{}"
    try {
      return JSON.stringify(meta)
    } catch {
      return "{}"
    }
  }, [meta])
  const narration = useTaskNarration({
    taskKind,
    phase: currentPhase,
    metadataJson,
  })
  if (failed) {
    return (
      <>
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-traffic mb-2">
          Falló
        </p>
        <h2 className="text-title truncate">Algo se cortó a mitad</h2>
      </>
    )
  }
  if (done) {
    return (
      <>
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-web mb-2">
          Listo
        </p>
        <h2 className="text-title truncate">Terminado</h2>
      </>
    )
  }
  if (status === "QUEUED" || status === "PENDING_VERSION" || status === "DELAYED") {
    return (
      <>
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg mb-2">
          En cola
        </p>
        <h2 className="text-title truncate">Esperando al agente…</h2>
      </>
    )
  }
  if (currentPhase === null) {
    return (
      <>
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-system-badge-fg mb-2">
          Iniciando
        </p>
        <h2 className="text-title truncate">Conectando con el agente…</h2>
      </>
    )
  }
  const label = phaseLabels[currentPhase]
  // Prefer the LLM narration when available, fall back to the static
  // description, fall back to nothing. The narration hook already
  // template-fallbacks internally to `label.description`, so by the time
  // it returns we always have either an LLM line or the SSOT description.
  return (
    <>
      <p className="text-caption font-semibold uppercase tracking-widest text-mode-live mb-2">
        En proceso
      </p>
      <h2 className="text-title truncate">{label.label}</h2>
      {narration.text !== null ? (
        <p className="text-body text-fg-2 mt-1">{narration.text}</p>
      ) : null}
    </>
  )
}

interface ConnectionBannerProps {
  state: "live" | "polling" | "lost"
}

function ConnectionBanner({ state }: ConnectionBannerProps): React.JSX.Element | null {
  if (state === "live") return null
  return (
    <p className="mt-3 text-caption text-fg-3">
      {state === "polling"
        ? "Conexión en vivo intermitente — seguimos sondeando el estado."
        : "Perdimos la conexión con el agente. Refresca si el progreso queda atascado."}
    </p>
  )
}

function StuckBanner(): React.JSX.Element {
  return (
    <p className="mt-3 text-caption text-mode-traffic">
      El progreso lleva varios minutos sin actualizarse. Si persiste, refresca o contáctanos.
    </p>
  )
}

interface FailedCardProps {
  translated: TranslatedError | null
  errorSlot: ((err: TranslatedError) => React.ReactNode) | undefined
  onRetry?: () => void
}

const SUPPORT_MAILTO = "mailto:soporte@usereplik.com?subject=Necesito%20ayuda%20con%20una%20tarea"

interface ActionLabel {
  label: string
  href?: string
  onClick?: () => void
}

function resolveActionLabel(
  action: ErrorAction,
  router: ReturnType<typeof useRouter>,
  onRetry: (() => void) | undefined,
): ActionLabel | null {
  switch (action.kind) {
    case "retry":
      // If the parent passed `onRetry`, treat the click as a true restart of
      // the originating server action (fresh runHandle, fresh wait surface).
      // Otherwise fall back to a page refresh and rename the button to match
      // — "Reintentar" promises behavior we can't deliver without the hook.
      if (onRetry !== undefined) {
        return {
          label: "Reintentar",
          onClick: onRetry,
        }
      }
      return {
        label: "Refrescar",
        onClick: () => {
          router.refresh()
        },
      }
    case "reconnect_integration":
      // The dashboard mounts both `<CredentialsModal provider="meta">` and
      // `<CredentialsModal provider="shopify">` and auto-opens whichever is
      // referenced via `?reconnect=<provider>` on first render (then strips
      // the param). Meta surfaces from the "Refrescar métricas" flow and the
      // per-product launch screen; Shopify surfaces from the per-product
      // landing screen. Dashboard centralizes both so a single deep link
      // works regardless of which flow surfaced the error.
      return {
        label: action.provider === "meta" ? "Reconectar Meta" : "Reconectar Shopify",
        href: `/dashboard?reconnect=${action.provider}`,
      }
    case "contact_support":
      return { label: "Contactar soporte", href: SUPPORT_MAILTO }
    case "edit_input":
      return {
        label: "Volver y corregir",
        onClick: () => {
          router.back()
        },
      }
    case "none":
      return null
  }
}

function FailedCard({ translated, errorSlot, onRetry }: FailedCardProps): React.JSX.Element {
  const router = useRouter()
  if (translated === null) {
    return (
      <div className="mt-4 rounded-card border border-mode-traffic bg-mode-traffic-badge-bg p-3 flex items-start gap-2">
        <Loader2 className="size-4 mt-0.5 shrink-0 text-mode-traffic animate-spin" />
        <p className="text-caption text-mode-traffic">Traduciendo el error…</p>
      </div>
    )
  }
  if (errorSlot !== undefined) {
    return <div className="mt-4">{errorSlot(translated)}</div>
  }
  const actionLabel = resolveActionLabel(translated.action, router, onRetry)
  return (
    <div className="mt-4 rounded-card border border-mode-traffic bg-mode-traffic-badge-bg p-4">
      <p className="text-callout font-semibold text-mode-traffic">{translated.titleEs}</p>
      <p className="text-caption text-mode-traffic mt-1">{translated.bodyEs}</p>
      {actionLabel !== null ? (
        <div className="mt-3">
          {actionLabel.href !== undefined ? (
            <a
              href={actionLabel.href}
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-mode-traffic bg-surface text-sm font-medium text-mode-traffic hover:bg-surface-muted transition-colors"
            >
              {actionLabel.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={actionLabel.onClick}
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-mode-traffic bg-surface text-sm font-medium text-mode-traffic hover:bg-surface-muted transition-colors"
            >
              {actionLabel.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
