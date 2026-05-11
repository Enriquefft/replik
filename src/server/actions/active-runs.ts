"use server"

import { auth } from "@trigger.dev/sdk"
import { and, desc, eq, inArray } from "drizzle-orm"
import { requireUser, UnauthenticatedError, withUser } from "@/db/client"
import { products, taskRuns } from "@/db/schema"
import { logEvent } from "@/lib/observability/log.ts"
import type { TaskKind } from "@/lib/task-kind.ts"
import { productTag, userTag } from "@/lib/trigger-tags.ts"
import { toProductId, toUserId } from "@/lib/types/ids.ts"

export interface ActiveRunSummary {
  triggerRunId: string
  kind: TaskKind
  productId: string | null
  startedAt: Date
  productName?: string
}

export interface ActiveRunsResponse {
  runs: readonly ActiveRunSummary[]
  /**
   * Trigger.dev public token scoped to the union of `productTag(productId)`
   * for products in the result, plus `userTag(userId)` to cover
   * product-less tasks (`sync_insights`). Empty string when unauthenticated.
   */
  accessToken: string
}

const EMPTY: ActiveRunsResponse = { runs: [], accessToken: "" }

/**
 * Server action consumed by `<JobsDock>` to list the current user's
 * in-flight task runs. Returns an empty response when unauthenticated so
 * the client doesn't have to special-case the signed-out branch.
 *
 * Auth: Clerk `auth()` is invoked via `requireUser`. Unauthenticated
 * callers get a fail-closed empty response. The Trigger.dev public token
 * scopes to the union of tags for runs the user actually owns — a token
 * minted under user A can never decode a run belonging to user B.
 */
export async function listActiveRuns(): Promise<ActiveRunsResponse> {
  let userId: string
  try {
    const session = await requireUser()
    userId = session.userId
  } catch (err) {
    if (err instanceof UnauthenticatedError) return EMPTY
    throw err
  }

  // Composite index `(user_id, status)` covers the WHERE clause. The
  // status filter intentionally drops `completed`/`failed`/`canceled` so
  // the dock only ever surfaces work that's still alive on Trigger.dev.
  const rows = await withUser(userId, async (db) =>
    db
      .select({
        triggerRunId: taskRuns.triggerRunId,
        kind: taskRuns.kind,
        productId: taskRuns.productId,
        startedAt: taskRuns.startedAt,
      })
      .from(taskRuns)
      .where(and(eq(taskRuns.userId, userId), inArray(taskRuns.status, ["queued", "executing"])))
      .orderBy(desc(taskRuns.startedAt)),
  )

  if (rows.length === 0) return EMPTY

  // Resolve product names for runs that have a productId. One round-trip
  // because Neon HTTP doesn't support transactions and we want to keep
  // this server action cheap (the dock refetches every 30s).
  const productIds = [...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : [])))]
  const productNameById = new Map<string, string>()
  if (productIds.length > 0) {
    const productRows = await withUser(userId, async (db) =>
      db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.userId, userId), inArray(products.id, productIds))),
    )
    for (const p of productRows) {
      if (p.name !== null) productNameById.set(p.id, p.name)
    }
  }

  const runs: ActiveRunSummary[] = rows.map((r) => {
    const summary: ActiveRunSummary = {
      triggerRunId: r.triggerRunId,
      kind: r.kind,
      productId: r.productId,
      startedAt: r.startedAt,
    }
    if (r.productId !== null) {
      const name = productNameById.get(r.productId)
      if (name !== undefined) summary.productName = name
    }
    return summary
  })

  // Tag union: `productTag` for every product with an active run, plus
  // `userTag` to catch `sync_insights` runs (which carry no productId).
  // Defensive scoping — the token can ONLY decode runs whose tags the
  // user actually owns.
  const tagSet = new Set<string>()
  tagSet.add(userTag(toUserId(userId)))
  for (const pid of productIds) {
    tagSet.add(productTag(toProductId(pid)))
  }

  let accessToken = ""
  try {
    accessToken = await auth.createPublicToken({
      scopes: { read: { tags: [...tagSet] } },
      expirationTime: "1h",
    })
  } catch (err) {
    logEvent("action.active_runs.token_mint_failed", {
      userId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  return { runs, accessToken }
}

export interface RunFinalStatusResponse {
  status: "completed" | "failed" | "canceled" | "queued" | "executing" | null
  errorCode: string | null
  taskKind: TaskKind | null
}

/**
 * Look up the persisted terminal state of a single run by trigger run id.
 * Used by `useRunCompletionToast` after a run disappears from the active
 * set: the active-runs feed only returns live rows, so we need a second
 * trip to discover whether the run completed cleanly or failed.
 *
 * Defensive auth: the row is only returned if it belongs to the current
 * user. A null response covers both "no such row" and "row belongs to
 * another tenant" without leaking which case it was.
 */
export async function getRunFinalStatus(triggerRunId: string): Promise<RunFinalStatusResponse> {
  if (typeof triggerRunId !== "string" || triggerRunId.length === 0) {
    return { status: null, errorCode: null, taskKind: null }
  }
  let userId: string
  try {
    const session = await requireUser()
    userId = session.userId
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return { status: null, errorCode: null, taskKind: null }
    }
    throw err
  }

  const rows = await withUser(userId, async (db) =>
    db
      .select({
        status: taskRuns.status,
        errorCode: taskRuns.errorCode,
        kind: taskRuns.kind,
      })
      .from(taskRuns)
      .where(and(eq(taskRuns.triggerRunId, triggerRunId), eq(taskRuns.userId, userId)))
      .limit(1),
  )
  const row = rows[0]
  if (!row) return { status: null, errorCode: null, taskKind: null }
  return { status: row.status, errorCode: row.errorCode, taskKind: row.kind }
}
