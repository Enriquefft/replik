"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

/**
 * Fires `router.refresh()` exactly once when `done` flips from `false` to
 * `true`. Subsequent re-renders with `done === true` are noops.
 *
 * Why this exists: every realtime progress UI in the app needs to pull
 * the persisted DB state back into the RSC snapshot when the underlying
 * Trigger.dev run completes (the asset / status rows may not be visible
 * on the SSR snapshot the user is looking at). Each surface used to keep
 * its own `refreshFiredRef` + `useEffect`; Phase C consolidated them into
 * this single hook (called both inside `<PhaseProgress>` for run-level
 * completion and at the page level for polling-fallback or aggregate
 * gates like "every creative done").
 *
 * Side-effect only; returns nothing.
 */
export function useRefreshOnComplete(done: boolean): void {
  const router = useRouter()
  const firedRef = useRef(false)

  useEffect(() => {
    if (!done || firedRef.current) return
    firedRef.current = true
    router.refresh()
  }, [done, router])
}
