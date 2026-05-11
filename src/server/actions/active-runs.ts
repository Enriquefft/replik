"use server"

import type { RunStatus } from "@trigger.dev/core/v3"
import { auth, runs } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { requireUser, UnauthenticatedError, withUser } from "@/db/client"
import { products } from "@/db/schema"
import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import { logEvent } from "@/lib/observability/log.ts"
import { type TaskKind, taskKindFromTriggerId } from "@/lib/task-kind.ts"
import { isRunFailed } from "@/lib/trigger-status.ts"
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

// Hard cap on result-set size. Active runs per user are naturally bounded
// (a user might have ~5 in flight at once); the cap is defensive.
const LIST_LIMIT = 50

const PRODUCT_TAG_PREFIX = "product:"

/**
 * The status enum we expose to the JobsDock client. Lossy projection of
 * Trigger.dev's broader run-status enum onto the five cases the UI cares
 * about: in-flight (queued/executing), terminal (completed/failed/canceled).
 */
type SimpleStatus = "completed" | "failed" | "canceled" | "queued" | "executing"

function projectStatus(status: RunStatus): SimpleStatus | null {
  if (status === "COMPLETED") return "completed"
  if (status === "CANCELED") return "canceled"
  if (isRunFailed(status)) return "failed"
  if (status === "EXECUTING" || status === "WAITING") return "executing"
  if (
    status === "QUEUED" ||
    status === "PENDING_VERSION" ||
    status === "DEQUEUED" ||
    status === "DELAYED"
  ) {
    return "queued"
  }
  return null
}

function productIdFromTags(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith(PRODUCT_TAG_PREFIX)) {
      return tag.slice(PRODUCT_TAG_PREFIX.length)
    }
  }
  return null
}

/**
 * Server action consumed by `<JobsDock>` to list the current user's
 * in-flight task runs. Returns an empty response when unauthenticated so
 * the client doesn't have to special-case the signed-out branch.
 *
 * Source of truth: Trigger.dev's `runs.list` API, filtered by
 * `userTag(userId)` so the response is naturally tenant-scoped server-side.
 * Every task trigger site in the codebase tags with `userTag(userId)` so
 * this filter covers all run kinds.
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

  const myUserTag = userTag(toUserId(userId))
  type ListPage = Awaited<ReturnType<typeof runs.list>>
  let page: ListPage
  try {
    page = await runs.list({
      tag: myUserTag,
      status: ["QUEUED", "EXECUTING"],
      limit: LIST_LIMIT,
    })
  } catch (err) {
    logEvent("action.active_runs.list_failed", {
      userId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return EMPTY
  }

  const items = page.data
  if (items.length === 0) return EMPTY

  // Map Trigger.dev items → ActiveRunSummary, dropping any whose
  // taskIdentifier isn't a known TaskKind (e.g., orphan child runs or
  // tasks introduced without a label entry).
  const summariesPartial: Array<{
    triggerRunId: string
    kind: TaskKind
    productId: string | null
    startedAt: Date
  }> = []
  const productIdSet = new Set<string>()

  for (const item of items) {
    const kind = taskKindFromTriggerId(item.taskIdentifier)
    if (kind === null) continue
    const productId = productIdFromTags(item.tags)
    if (productId !== null) productIdSet.add(productId)
    summariesPartial.push({
      triggerRunId: item.id,
      kind,
      productId,
      startedAt: item.startedAt ?? item.createdAt,
    })
  }

  if (summariesPartial.length === 0) return EMPTY

  // Resolve product names for runs that carry a `product:` tag. One
  // round-trip — the dock refetches every 30s so cheap matters.
  const productNameById = new Map<string, string>()
  if (productIdSet.size > 0) {
    const productIds = [...productIdSet]
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

  const summaries: ActiveRunSummary[] = summariesPartial
    .map((s) => {
      const summary: ActiveRunSummary = {
        triggerRunId: s.triggerRunId,
        kind: s.kind,
        productId: s.productId,
        startedAt: s.startedAt,
      }
      if (s.productId !== null) {
        const name = productNameById.get(s.productId)
        if (name !== undefined) summary.productName = name
      }
      return summary
    })
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())

  // Tag union: `productTag` for every product with an active run, plus
  // `userTag` so the token also covers product-less runs (`sync_insights`).
  const tagSet = new Set<string>()
  tagSet.add(myUserTag)
  for (const pid of productIdSet) {
    tagSet.add(productTag(toProductId(pid)))
  }

  let accessToken = ""
  try {
    // 4h TTL covers worst-case long-running tasks: rehost+burn can stretch
    // 30–90 min, and a user who opens JobsDock partway through, navigates
    // away, then reconnects to resume monitoring should not hit an expired
    // token mid-stream. The token is still scoped to user-owned tags only,
    // so a longer TTL doesn't widen the blast radius if it leaks.
    accessToken = await auth.createPublicToken({
      scopes: { read: { tags: [...tagSet] } },
      expirationTime: "4h",
    })
  } catch (err) {
    logEvent("action.active_runs.token_mint_failed", {
      userId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  return { runs: summaries, accessToken }
}

export interface RunFinalStatusResponse {
  status: SimpleStatus | null
  errorCode: string | null
  taskKind: TaskKind | null
}

const NO_RUN: RunFinalStatusResponse = { status: null, errorCode: null, taskKind: null }

/**
 * Look up the terminal state of a single run by Trigger.dev run id.
 * Used by `useRunCompletionToast` after a run disappears from the active
 * set: the active-runs feed only reports live runs, so we need a second
 * trip to discover whether the run completed cleanly or failed.
 *
 * Defensive auth: the run is only returned if its tags include
 * `userTag(userId)`. The Trigger.dev secret key auto-scopes to the
 * project, so this guard is what enforces tenant isolation across
 * projects-with-multiple-users.
 */
export async function getRunFinalStatus(triggerRunId: string): Promise<RunFinalStatusResponse> {
  if (typeof triggerRunId !== "string" || triggerRunId.length === 0) {
    return NO_RUN
  }
  let userId: string
  try {
    const session = await requireUser()
    userId = session.userId
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NO_RUN
    throw err
  }

  type RetrievedRun = Awaited<ReturnType<typeof runs.retrieve>>
  let run: RetrievedRun
  try {
    run = await runs.retrieve(triggerRunId)
  } catch (err) {
    logEvent("action.active_runs.retrieve_failed", {
      userId,
      triggerRunId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return NO_RUN
  }

  if (!run.tags.includes(userTag(toUserId(userId)))) return NO_RUN

  const taskKind = taskKindFromTriggerId(run.taskIdentifier)
  const status = projectStatus(run.status)
  const errorCode = parseTaskErrorPayload(run.error?.message ?? "")?.code ?? null

  return { status, errorCode, taskKind }
}
