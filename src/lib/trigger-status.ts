import type { RunStatus } from "@trigger.dev/core/v3"

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
