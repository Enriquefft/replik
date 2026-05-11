"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useJobsDockContext } from "@/components/jobs-dock-provider.tsx"
import { JOB_KIND_COMPLETION_LABELS_ES } from "@/lib/task-kind.ts"
import { getRunFinalStatus } from "@/server/actions/active-runs.ts"
import { translateRunError } from "@/server/actions/translate-error.ts"

const TITLE_FLASH_MS = 5_000
const SUCCESS_TOAST_MS = 8_000

/**
 * Fire a completion toast (and flash the document title) when a
 * previously-active task run leaves the active set. Cold-start safe:
 * the very first feed snapshot seeds the "previously seen" set without
 * triggering toasts, so a user who opens the app after a run finished
 * doesn't get a stale "Listo" popup.
 *
 * The active-runs feed only reports live runs, so to discover whether a
 * disappeared run ended in `completed` vs `failed` we round-trip
 * `getRunFinalStatus` once per disappearance.
 */
export function useRunCompletionToast(): void {
  const { data, loading } = useJobsDockContext()

  // Cold-start guard: until the first non-loading snapshot lands, we
  // can't tell whether an empty set means "no runs in flight" or "we
  // haven't loaded yet". We seed `prevIdsRef` from that first snapshot
  // and only diff against subsequent snapshots.
  const seededRef = useRef(false)
  const prevIdsRef = useRef<Set<string>>(new Set())
  // Guard against double-firing for the same run if a flicker bounces a
  // row out then back into the active set.
  const firedForRef = useRef<Set<string>>(new Set())

  // Title-flash bookkeeping. Refs let the outer cleanup tear down a
  // pending flash if the hook unmounts before either the timer fires or
  // the user focuses the tab.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusListenerRef = useRef<(() => void) | null>(null)
  const originalTitleRef = useRef<string | null>(null)

  const flashTitle = useCallback((message: string): void => {
    if (typeof document === "undefined") return

    // If a previous flash is still pending, restore its title first so
    // overlapping flashes don't compound prefixes and so the old listener
    // doesn't leak.
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
    if (focusListenerRef.current !== null) {
      window.removeEventListener("focus", focusListenerRef.current)
      focusListenerRef.current = null
    }
    if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current
      originalTitleRef.current = null
    }

    const original = document.title
    originalTitleRef.current = original
    document.title = `(¡Listo!) ${message} · ${original}`

    const restore = (): void => {
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current)
        flashTimerRef.current = null
      }
      if (focusListenerRef.current !== null) {
        window.removeEventListener("focus", focusListenerRef.current)
        focusListenerRef.current = null
      }
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current
        originalTitleRef.current = null
      }
    }

    focusListenerRef.current = restore
    window.addEventListener("focus", restore)
    flashTimerRef.current = setTimeout(restore, TITLE_FLASH_MS)
  }, [])

  // Mount-scoped cleanup: cancel any pending flash + listener when the
  // host component unmounts, so neither outlives the React tree.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current)
        flashTimerRef.current = null
      }
      if (focusListenerRef.current !== null) {
        window.removeEventListener("focus", focusListenerRef.current)
        focusListenerRef.current = null
      }
      if (originalTitleRef.current !== null && typeof document !== "undefined") {
        document.title = originalTitleRef.current
        originalTitleRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (loading) return
    const currentIds = new Set(data.runs.map((r) => r.triggerRunId))

    if (!seededRef.current) {
      seededRef.current = true
      prevIdsRef.current = currentIds
      return
    }

    const disappeared: string[] = []
    for (const prev of prevIdsRef.current) {
      if (!currentIds.has(prev) && !firedForRef.current.has(prev)) {
        disappeared.push(prev)
      }
    }
    prevIdsRef.current = currentIds

    if (disappeared.length === 0) return

    const handle = async (): Promise<void> => {
      for (const runId of disappeared) {
        firedForRef.current.add(runId)
        const final = await getRunFinalStatus(runId)
        if (final.status === null || final.taskKind === null) continue
        if (final.status === "completed") {
          const message = JOB_KIND_COMPLETION_LABELS_ES[final.taskKind]
          toast.success(message, { duration: SUCCESS_TOAST_MS })
          flashTitle(message)
        } else if (final.status === "failed" || final.status === "canceled") {
          const translated = await translateRunError({
            code: final.errorCode,
            raw: final.errorCode ?? "",
            taskKind: final.taskKind,
          })
          // Manual dismiss only on failure — the user MUST see this.
          toast.error(translated.titleEs, {
            description: translated.bodyEs,
            duration: Number.POSITIVE_INFINITY,
          })
        }
      }
    }
    void handle()
  }, [data, loading, flashTitle])
}
