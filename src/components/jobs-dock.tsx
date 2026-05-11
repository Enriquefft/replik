"use client"

import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { ChevronDown, Loader2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useJobsDockContext } from "@/components/jobs-dock-provider.tsx"
import { resolvePhaseLabel } from "@/lib/phase-resolver.ts"
import { JOB_KIND_LABELS_ES, type TaskKind } from "@/lib/task-kind.ts"
import { cn } from "@/lib/utils.ts"
import type { ActiveRunSummary } from "@/server/actions/active-runs.ts"

/**
 * Floating dock pill (bottom-right of every page) that surfaces the
 * current user's in-flight task runs. Renders nothing when no runs are
 * active. Click to expand a panel listing each row with a phase label,
 * elapsed timer, and "Volver" deep-link.
 *
 * Mounts inside `<JobsDockProvider>` — reads from the shared active-runs
 * context so the dock and `useRunCompletionToast` agree on the live set.
 */
export function JobsDock(): React.JSX.Element | null {
  const { data } = useJobsDockContext()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  // Close on Escape from anywhere inside the dock.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Click-outside closes the panel.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener("mousedown", onClick)
    return () => {
      window.removeEventListener("mousedown", onClick)
    }
  }, [open])

  if (data.runs.length === 0) return null

  const count = data.runs.length
  const countLabel = count === 1 ? "1 tarea en curso" : `${count.toString()} tareas en curso`

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open ? (
        <section
          ref={panelRef}
          id="jobs-dock-panel"
          aria-label="Tareas en curso"
          className="w-80 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface glass shadow-card overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-3 py-2">
            <p className="text-caption font-semibold uppercase tracking-widest text-fg-3">
              En curso
            </p>
            <span className="text-caption font-mono tabular-nums text-fg-3">
              {count.toString()}
            </span>
          </div>
          <ul className="flex flex-col">
            {data.runs.map((run) => (
              <li key={run.triggerRunId} className="border-b border-border last:border-b-0">
                <JobsDockRow
                  run={run}
                  accessToken={data.accessToken}
                  onNavigate={() => {
                    setOpen(false)
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-controls="jobs-dock-panel"
        aria-label={countLabel}
        className="inline-flex items-center gap-2 h-11 rounded-pill border border-border bg-surface glass shadow-card px-4 hover:bg-surface-elevated transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mode-live"
      >
        <Loader2 className="size-4 animate-spin text-mode-live" strokeWidth={2} />
        <span className="text-caption font-semibold tabular-nums">{count.toString()}</span>
        <span className="hidden sm:inline text-caption text-fg-2">
          {count === 1 ? "tarea" : "tareas"}
        </span>
        <ChevronDown
          className={cn("size-4 text-fg-3 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>
    </div>
  )
}

interface JobsDockRowProps {
  run: ActiveRunSummary
  accessToken: string
  onNavigate: () => void
}

function JobsDockRow({ run, accessToken, onNavigate }: JobsDockRowProps): React.JSX.Element {
  // `useRealtimeRun` shares a single websocket across multiple calls in
  // the same React tree, so subscribing per-row scales fine for the
  // typical ~5 active runs per user. Empty access token short-circuits
  // the subscription so dev/anonymous renders don't 401.
  const subscribed = accessToken.length > 0
  const { run: realtime } = useRealtimeRun(run.triggerRunId, {
    accessToken,
    enabled: subscribed,
  })

  const taskLabel = JOB_KIND_LABELS_ES[run.kind]
  const phase = pickPhaseFromMetadata(realtime?.metadata)
  const phaseLabel = resolvePhaseLabel(run.kind, phase)
  const elapsed = useElapsed(run.startedAt)
  const href = deepLinkFor(run.kind, run.productId)

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="block px-3 py-2.5 hover:bg-surface-elevated transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mode-live"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-callout font-medium truncate">{taskLabel}</p>
          {run.productName !== undefined ? (
            <p className="text-caption text-fg-3 truncate">{run.productName}</p>
          ) : null}
          {phaseLabel !== null ? (
            <p className="text-caption text-mode-live mt-0.5 truncate">{phaseLabel.label}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          <span className="text-caption font-mono tabular-nums text-fg-3">{elapsed}</span>
          <span className="text-caption text-mode-live">Volver</span>
        </div>
      </div>
    </Link>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickPhaseFromMetadata(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object") return null
  if (!("phase" in meta)) return null
  const phase = meta.phase
  return typeof phase === "string" ? phase : null
}

function deepLinkFor(kind: TaskKind, productId: string | null): string {
  switch (kind) {
    case "scrape_product":
      return productId ? `/products/${productId}` : "/dashboard"
    case "translate_burn":
      return productId ? `/products/${productId}/edit` : "/dashboard"
    case "rehost_creatives":
      return productId ? `/products/${productId}/edit` : "/dashboard"
    case "publish_landing":
      return productId ? `/products/${productId}/landing` : "/dashboard"
    case "launch_campaign":
      return productId ? `/products/${productId}/launch` : "/dashboard"
    case "sync_insights":
      return "/dashboard"
  }
}

function useElapsed(startedAt: Date): string {
  const [now, setNow] = useState(() => Date.now())
  const startMs = startedAt.getTime()
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1_000)
    return () => {
      clearInterval(id)
    }
  }, [])
  return formatElapsed(Math.max(0, Math.floor((now - startMs) / 1000)))
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

// Re-export for ergonomic imports outside this module.
export { useJobsDockContext } from "@/components/jobs-dock-provider.tsx"
