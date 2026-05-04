"use client"

import type { RunStatus } from "@trigger.dev/core/v3"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"
import { isRunFailed } from "@/lib/trigger-status.ts"
import { cn } from "@/lib/utils.ts"

interface TaskProgressProps {
  runId: string
  accessToken: string
  step?: string
  detail?: string
  className?: string
}

function getStatusConfig(status: RunStatus | undefined) {
  if (!status) {
    return { icon: Loader2, label: "Iniciando…", spin: true, color: "text-fg-2" }
  }
  switch (status) {
    case "QUEUED":
    case "PENDING_VERSION":
    case "DEQUEUED":
    case "DELAYED":
      return { icon: Clock, label: "En cola…", spin: false, color: "text-fg-2" }
    case "EXECUTING":
    case "WAITING":
      return { icon: Loader2, label: "Procesando…", spin: true, color: "text-mode-live" }
    case "COMPLETED":
      return { icon: CheckCircle2, label: "Completado", spin: false, color: "text-mode-web" }
    case "FAILED":
    case "CRASHED":
    case "SYSTEM_FAILURE":
    case "TIMED_OUT":
    case "EXPIRED":
      return { icon: XCircle, label: "Error", spin: false, color: "text-mode-traffic" }
    case "CANCELED":
      return { icon: XCircle, label: "Cancelado", spin: false, color: "text-fg-3" }
  }
}

function getProgress(status: RunStatus | undefined): number {
  if (!status) return 0
  switch (status) {
    case "QUEUED":
    case "PENDING_VERSION":
    case "DELAYED":
      return 10
    case "DEQUEUED":
      return 25
    case "EXECUTING":
    case "WAITING":
      return 65
    case "COMPLETED":
      return 100
    default:
      return 0
  }
}

export function TaskProgress({ runId, accessToken, step, detail, className }: TaskProgressProps) {
  const { run } = useRealtimeRun(runId, { accessToken })

  const status = run?.status
  const config = getStatusConfig(status)
  const progress = getProgress(status)
  const Icon = config.icon

  return (
    <div
      className={cn(
        "rounded-card bg-surface-elevated glass border border-border p-4 shadow-tight",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Icon
          className={cn("size-5 shrink-0", config.color, config.spin && "animate-spin")}
          strokeWidth={1.8}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-callout font-medium text-fg-1 truncate">{step ?? config.label}</p>
            <span className="text-caption text-fg-3 shrink-0">{progress}%</span>
          </div>
          {detail && <p className="text-caption text-fg-2 mt-0.5 truncate">{detail}</p>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1 w-full rounded-pill bg-surface-muted overflow-hidden">
        <div
          className="h-full rounded-pill bg-mode-live transition-all duration-500 ease-out"
          style={{ width: `${String(progress)}%` }}
        />
      </div>

      {isRunFailed(status) ? (
        <p className="mt-2 text-caption text-mode-traffic">
          {run?.output ? String(run.output) : "Algo salió mal. Intenta de nuevo."}
        </p>
      ) : null}
    </div>
  )
}
