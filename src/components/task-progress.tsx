"use client"

import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils.ts"

interface TaskProgressProps {
  runId: string
  step?: string
  detail?: string
  className?: string
}

type RunStatus =
  | "WAITING_FOR_DEPLOY"
  | "QUEUED"
  | "DEQUEUED"
  | "EXECUTING"
  | "REATTEMPTING"
  | "FROZEN"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | "CRASHED"
  | "INTERRUPTED"
  | "SYSTEM_FAILURE"
  | "DELAYED"
  | "EXPIRED"
  | "TIMED_OUT"

function getStatusConfig(status: RunStatus | undefined) {
  if (!status) {
    return { icon: Loader2, label: "Iniciando…", spin: true, color: "text-fg-2" }
  }
  switch (status) {
    case "QUEUED":
    case "WAITING_FOR_DEPLOY":
    case "DEQUEUED":
    case "DELAYED":
      return { icon: Clock, label: "En cola…", spin: false, color: "text-fg-2" }
    case "EXECUTING":
    case "REATTEMPTING":
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
    case "INTERRUPTED":
    case "FROZEN":
      return { icon: XCircle, label: "Cancelado", spin: false, color: "text-fg-3" }
  }
}

function getProgress(status: RunStatus | undefined): number {
  if (!status) return 0
  switch (status) {
    case "QUEUED":
    case "WAITING_FOR_DEPLOY":
    case "DELAYED":
      return 10
    case "DEQUEUED":
      return 25
    case "EXECUTING":
    case "REATTEMPTING":
      return 65
    case "FROZEN":
      return 65
    case "COMPLETED":
      return 100
    default:
      return 0
  }
}

export function TaskProgress({ runId, step, detail, className }: TaskProgressProps) {
  const { run } = useRealtimeRun(runId)

  const status = run?.status as RunStatus | undefined
  const config = getStatusConfig(status)
  const progress = getProgress(status)
  const Icon = config.icon

  return (
    <div
      className={cn(
        "rounded-card bg-surface-elevated border border-border p-4 shadow-tight",
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

      {status === "FAILED" || status === "CRASHED" || status === "SYSTEM_FAILURE" ? (
        <p className="mt-2 text-caption text-mode-traffic">
          {run?.output ? String(run.output) : "Algo salió mal. Intenta de nuevo."}
        </p>
      ) : null}
    </div>
  )
}
