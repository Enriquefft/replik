"use server"

import { requireUser, UnauthenticatedError } from "@/db/client"
import {
  NarrateProgressInputSchema,
  type NarrateProgressResult,
  narrateProgress,
} from "@/lib/ai/narrate.ts"
import { logEvent } from "@/lib/observability/log.ts"

export interface NarrateProgressActionInput {
  taskKind: string
  phase: string | null
  metadataJson: string
}

const EMPTY: NarrateProgressResult = { text: null }

// ─── Rate limit ──────────────────────────────────────────────────────────────
//
// Worst-case math: a 30-min burn over 5 parallel creatives each calls the
// narration action ~once per phase change. With ~6 phases and a 30-min burn
// the LLM bill caps around $9/run if every call misses cache. Two thresholds:
//
//   - BURST_WINDOW_MS / BURST_MAX_CALLS — kills the obvious abuse pattern of
//     a hot polling loop. Anything faster than 1 call / 2s is template-only.
//   - HOURLY_WINDOW_MS / HOURLY_MAX_CALLS — bounds spend per user-hour even
//     across legitimate multi-task surfaces (JobsDock + per-product wait).
//
// In-memory `Map<userId, …>` is intentional: the MVP runs on a single
// serverful Next.js process; Redis would be premature. If we go multi-region
// or serverless-edge, the map needs to move to a shared store, but the
// shape (per-userId burst + hourly window) stays the same.

const BURST_WINDOW_MS = 2_000
const BURST_MAX_CALLS = 1
const HOURLY_WINDOW_MS = 60 * 60 * 1000
const HOURLY_MAX_CALLS = 60

interface RateState {
  /** Monotonic timestamps (ms) of recent narrate calls, oldest first. */
  calls: number[]
  /** Last call's timestamp — kept separately so the burst check is O(1). */
  lastCallAt: number
}

const rateMap = new Map<string, RateState>()

/**
 * Returns `true` when the user has exceeded EITHER the burst or hourly
 * limit. Mutates `rateMap` to record the current call (only when it's
 * allowed) so back-to-back denials don't extend the window indefinitely.
 */
function recordAndCheckRateLimit(userId: string, now: number): boolean {
  const prev = rateMap.get(userId)
  if (prev === undefined) {
    rateMap.set(userId, { calls: [now], lastCallAt: now })
    return false
  }
  if (now - prev.lastCallAt < BURST_WINDOW_MS / BURST_MAX_CALLS) {
    return true
  }
  const cutoff = now - HOURLY_WINDOW_MS
  const recent = prev.calls.filter((t) => t > cutoff)
  if (recent.length >= HOURLY_MAX_CALLS) {
    return true
  }
  recent.push(now)
  rateMap.set(userId, { calls: recent, lastCallAt: now })
  return false
}

/**
 * Client-side entry-point for the narration LLM. Validates the input
 * against the zod schema and gates behind a Clerk session — the
 * `narration_cache` table is shared across users (the hash includes
 * `taskKind + phase + metadataJson`, no user-specific data), but the LLM
 * call itself is gated to prevent anonymous abuse of our model spend.
 *
 * Additionally enforces a per-user rate limit (1 call / 2s burst, 60 calls
 * / hour) to bound LLM spend on long-running surfaces with multiple
 * parallel waits. When the limit is exceeded we fail-soft (return
 * `{ text: null }`) so the UI falls back to the template narration — the
 * frontend gates rendering on `narration.text !== null`.
 *
 * Returns `{ text: null }` when validation, auth, rate-limit, or the LLM
 * fails so the caller can fall back to the template.
 */
export async function narrateProgressAction(
  input: NarrateProgressActionInput,
): Promise<NarrateProgressResult> {
  let userId: string
  try {
    const session = await requireUser()
    userId = session.userId
  } catch (err) {
    if (err instanceof UnauthenticatedError) return EMPTY
    throw err
  }
  if (recordAndCheckRateLimit(userId, Date.now())) {
    logEvent("action.narrate.rate_limited", { userId })
    return EMPTY
  }
  const parsed = NarrateProgressInputSchema.safeParse(input)
  if (!parsed.success) return EMPTY
  return await narrateProgress(parsed.data)
}
