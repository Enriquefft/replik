"use client"

/**
 * Connection health for the Trigger.dev realtime subscription.
 *
 *   - `live` — `useRealtimeRun` / `useRealtimeRunsWithTag` has no error.
 *   - `lost` — the SDK exhausted its internal reconnects and surfaced an
 *              Error. The dot indicator turns muted; no prose is shown.
 *
 * Task pace is a separate concern handled by `<StuckBanner>` in
 * `phase-progress.tsx`. This hook never inspects metadata cadence — a
 * silent task on a healthy stream stays "live".
 */
export type ConnectionState = "live" | "lost"

interface UseConnectionStateInput {
  /** Realtime error from `useRealtimeRun` / `useRealtimeRunsWithTag`. */
  realtimeError: unknown
}

/**
 * Pure classifier — exported for tests. `undefined`/`null` are the only
 * "no error" sentinels the Trigger.dev hooks use; any other value (Error
 * instance, string, even falsy primitives like `0` / `""`) means the SDK
 * raised something and the connection should be treated as lost.
 */
export function classifyConnectionState(args: { realtimeError: unknown }): ConnectionState {
  return args.realtimeError === undefined || args.realtimeError === null ? "live" : "lost"
}

export function useConnectionState(input: UseConnectionStateInput): ConnectionState {
  return classifyConnectionState({ realtimeError: input.realtimeError })
}
