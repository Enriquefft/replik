"use client"

import { useEffect, useState } from "react"

/**
 * Tri-state classification of the realtime stream's health, used by every
 * `<PhaseProgress>` mount + the JobsDock so the UI can degrade gracefully:
 *
 *   - `live`    — websocket is up AND we've received an update in the last
 *                 30s. Show the green dot.
 *   - `polling` — websocket is broken but the caller's polling fallback is
 *                 still landing fresh updates (within 15s). Show a muted
 *                 banner; the run is still observable.
 *   - `lost`    — neither stream nor polling has produced an update in time.
 *                 Show the "intermitente" copy; let the user kick a manual
 *                 refresh.
 */
export type ConnectionState = "live" | "polling" | "lost"

interface UseConnectionStateInput {
  /** Realtime error from `useRealtimeRun`/`useRealtimeRunsWithTag`. */
  realtimeError: unknown
  /** Caller-supplied: ms since the last successful metadata read (stream OR poll). */
  lastUpdateAt: number | null
}

/**
 * Liveness window for the websocket path. Beyond this we assume the stream
 * silently went idle (proxies / load balancers can drop long-lived sockets
 * without surfacing an error).
 */
const LIVE_WINDOW_MS = 30_000
/** Liveness window for the polling fallback (caller picks its own cadence). */
const POLLING_WINDOW_MS = 15_000

/**
 * Internal state classifier (pure). Exported for tests; the hook calls
 * this on every render with `Date.now()` evaluated inside the effect tick.
 */
export function classifyConnectionState(args: {
  realtimeError: unknown
  lastUpdateAt: number | null
  now: number
}): ConnectionState {
  const { realtimeError, lastUpdateAt, now } = args
  const elapsed = lastUpdateAt === null ? Number.POSITIVE_INFINITY : now - lastUpdateAt
  if (realtimeError === undefined || realtimeError === null) {
    return elapsed <= LIVE_WINDOW_MS ? "live" : "lost"
  }
  return elapsed <= POLLING_WINDOW_MS ? "polling" : "lost"
}

/**
 * Re-classify the connection state every second so the UI flips to "lost"
 * after the configured window without waiting for an external state change.
 */
const TICK_MS = 1_000

export function useConnectionState({
  realtimeError,
  lastUpdateAt,
}: UseConnectionStateInput): ConnectionState {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [])

  return classifyConnectionState({ realtimeError, lastUpdateAt, now })
}
