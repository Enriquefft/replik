export const RUN_STATUSES = [
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "DELAYED",
  "EXECUTING",
  "WAITING",
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

export function isRunStatus(value: unknown): value is RunStatus {
  if (typeof value !== "string") return false
  switch (value) {
    case "PENDING_VERSION":
    case "QUEUED":
    case "DEQUEUED":
    case "DELAYED":
    case "EXECUTING":
    case "WAITING":
    case "COMPLETED":
    case "CANCELED":
    case "FAILED":
    case "CRASHED":
    case "SYSTEM_FAILURE":
    case "EXPIRED":
    case "TIMED_OUT":
      return true
    default:
      return false
  }
}

const FAILED_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "EXPIRED",
  "CANCELED",
])

export function isRunFailed(status: RunStatus | undefined): boolean {
  return status !== undefined && FAILED_RUN_STATUSES.has(status)
}
