import "server-only"

import { eq } from "drizzle-orm"
import { getDb, withUser } from "@/db/client"
import { taskRuns } from "@/db/schema"
import { logEvent } from "@/lib/observability/log.ts"
import type { TaskKind } from "@/lib/task-kind.ts"

export interface RecordTaskStartInput {
  triggerRunId: string
  userId: string
  productId: string | null
  kind: TaskKind
}

/**
 * Insert one row into `task_runs` when a Trigger.dev task is fired.
 *
 * Fail-open: a telemetry failure must NEVER prevent the task from
 * running. We log and swallow so the user-facing trigger call always
 * succeeds. The unique constraint on `trigger_run_id` makes the call
 * idempotent — if the caller retries it after a network flake, the
 * second insert is a noop.
 */
export async function recordTaskStart(input: RecordTaskStartInput): Promise<void> {
  try {
    await withUser(input.userId, async (db) => {
      await db
        .insert(taskRuns)
        .values({
          triggerRunId: input.triggerRunId,
          userId: input.userId,
          productId: input.productId,
          kind: input.kind,
          status: "queued",
        })
        .onConflictDoNothing({ target: taskRuns.triggerRunId })
    })
  } catch (err) {
    logEvent("telemetry.task_run.insert_failed", {
      triggerRunId: input.triggerRunId,
      kind: input.kind,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

export interface RecordTaskFinishInput {
  triggerRunId: string
  status: "completed" | "failed" | "canceled"
  errorCode: string | null
}

/**
 * Mark a task run as finished. Updates `ended_at` + `status` (+ optional
 * `error_code`) in-place. Same fail-open contract as `recordTaskStart` —
 * telemetry must not break the user flow.
 *
 * Called from the global Trigger.dev lifecycle hooks
 * (`onSuccess` / `onFailure`) wired in `trigger.config.ts`. Those hooks
 * only carry the trigger run id, so this helper resolves `userId` from
 * the existing `task_runs` row (inserted by `recordTaskStart` at the
 * server-action trigger site) before invoking `withUser` to satisfy the
 * tenant-scoping contract. If no row exists (telemetry insert failed at
 * start time, or the run was triggered outside the server actions) the
 * update is a noop — we have no userId to scope to and we must not write
 * cross-tenant.
 */
export async function recordTaskFinish(input: RecordTaskFinishInput): Promise<void> {
  try {
    const existing = await getDb()
      .select({ userId: taskRuns.userId })
      .from(taskRuns)
      .where(eq(taskRuns.triggerRunId, input.triggerRunId))
      .limit(1)
    const row = existing[0]
    if (!row) {
      logEvent("telemetry.task_run.finish_no_row", {
        triggerRunId: input.triggerRunId,
      })
      return
    }
    await withUser(row.userId, async (db) => {
      await db
        .update(taskRuns)
        .set({
          status: input.status,
          endedAt: new Date(),
          errorCode: input.errorCode,
        })
        .where(eq(taskRuns.triggerRunId, input.triggerRunId))
    })
  } catch (err) {
    logEvent("telemetry.task_run.finish_failed", {
      triggerRunId: input.triggerRunId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}
