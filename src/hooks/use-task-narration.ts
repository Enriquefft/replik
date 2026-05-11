"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { resolvePhaseLabel } from "@/lib/phase-resolver.ts"
import type { TaskKind } from "@/lib/task-kind.ts"
import { narrateProgressAction } from "@/server/actions/narrate-progress.ts"

export interface TaskNarrationInput {
  taskKind: TaskKind
  phase: string | null
  /**
   * Pre-serialized metadata. The caller stringifies its meta object so
   * the hash key is stable: re-stringifying inside the hook would
   * re-create the string on every render and bust the debounce.
   */
  metadataJson: string
}

export interface TaskNarrationOutput {
  /**
   * Spanish narration string, or `null` when there's nothing to show
   * beyond the phase title. Callers MUST suppress their narration slot
   * when this is `null` to avoid rendering a `<p>` that duplicates the
   * `<h2>` label.
   */
  text: string | null
  source: "template" | "llm"
}

const DEBOUNCE_MS = 3_000

/**
 * Return contextual Spanish narration for the current task phase. The
 * template fallback is rendered immediately so the UI never blocks on
 * the LLM; the contextual line replaces it asynchronously once the
 * server action returns. Re-renders triggered within a 3s window of the
 * last issued request are debounced — the next request fires after the
 * window elapses if the inputs are still different.
 *
 * Returns `{ text: <template>, source: "template" }` on first render and
 * when the LLM is unavailable; `{ text: <llm>, source: "llm" }` after a
 * successful narration call lands.
 */
export function useTaskNarration(input: TaskNarrationInput): TaskNarrationOutput {
  const template = useMemo<string | null>(() => {
    const label = resolvePhaseLabel(input.taskKind, input.phase)
    if (label === null) return "Conectando con el agente…"
    // When the phase has no description, returning `label.label` here
    // would duplicate the `<h2>` the caller already renders. Signal
    // "nothing extra to say" with `null` instead.
    return label.description ?? null
  }, [input.taskKind, input.phase])

  const [narration, setNarration] = useState<string | null>(null)

  // The key is the stable identity of "what would I ask the LLM right
  // now". Changes here flip narration back to null + fire a fresh
  // request after the debounce window.
  const inputKey = `${input.taskKind}::${input.phase ?? ""}::${input.metadataJson}`
  const lastRequestedKeyRef = useRef<string | null>(null)
  const lastRequestedAtRef = useRef<number>(0)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (input.phase === null) {
      setNarration(null)
      return
    }

    let cancelled = false

    const fire = (): void => {
      lastRequestedKeyRef.current = inputKey
      lastRequestedAtRef.current = Date.now()
      const inFlight = async (): Promise<void> => {
        const result = await narrateProgressAction({
          taskKind: input.taskKind,
          phase: input.phase,
          metadataJson: input.metadataJson,
        })
        if (cancelled) return
        // Only commit the narration if the inputs haven't changed since
        // we fired — a stale response must not overwrite a fresh phase.
        if (lastRequestedKeyRef.current === inputKey) {
          setNarration(result.text)
        }
      }
      void inFlight()
    }

    // Already asked for this exact key — nothing to do.
    if (lastRequestedKeyRef.current === inputKey) {
      return () => {
        cancelled = true
      }
    }

    const elapsed = Date.now() - lastRequestedAtRef.current
    if (elapsed >= DEBOUNCE_MS || lastRequestedAtRef.current === 0) {
      fire()
      return () => {
        cancelled = true
      }
    }

    // Within the debounce window. Schedule a deferred fire and replace
    // any pending timer so only the latest input is honored.
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current)
    }
    const wait = DEBOUNCE_MS - elapsed
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null
      if (!cancelled) fire()
    }, wait)
    return () => {
      cancelled = true
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
      }
    }
  }, [input.taskKind, input.phase, input.metadataJson, inputKey])

  if (narration !== null) {
    return { text: narration, source: "llm" }
  }
  return { text: template, source: "template" }
}
