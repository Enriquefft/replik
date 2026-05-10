"use client"

import * as React from "react"

/**
 * Hard cap on simultaneously-playing in-view videos. Mobile (the persona's
 * primary surface) decodes one video per core; >3 concurrent decodes melts
 * battery and pegs CPU on mid-range Android. Tracked module-wide so every
 * card on the grid contends against the same budget.
 */
export const MAX_CONCURRENT_AUTOPLAY = 3

/**
 * FIFO of currently-playing video elements. When a new video wants to play
 * and the budget is full, the oldest is paused. Module-level so the budget
 * is shared across every card on the page; React state would re-render the
 * grid on every transition.
 */
const playing = new Set<HTMLVideoElement>()

/**
 * Marks `video` as playing within the shared budget. Pauses the oldest
 * member if at capacity. Exported for tests; the hook calls it from the IO
 * callback.
 */
export function requestAutoplay(video: HTMLVideoElement): void {
  if (playing.has(video)) return
  if (playing.size >= MAX_CONCURRENT_AUTOPLAY) {
    // Set iteration order is insertion order, so the first entry is the oldest.
    const oldest = playing.values().next().value
    if (oldest !== undefined) {
      oldest.pause()
      oldest.currentTime = 0
      playing.delete(oldest)
    }
  }
  playing.add(video)
  void video.play().catch(() => {
    // Autoplay can reject (browser policy, mid-load, element detached).
    // Roll back so the slot frees up for another card.
    playing.delete(video)
  })
}

/** Pauses `video` (if playing) and frees its slot in the budget. */
export function releaseAutoplay(video: HTMLVideoElement): void {
  if (!playing.has(video)) return
  video.pause()
  video.currentTime = 0
  playing.delete(video)
}

/** Test-only: clear the FIFO so each test starts with an empty budget. */
export function resetAutoplayBudgetForTests(): void {
  playing.clear()
}

/**
 * Detects devices whose primary pointer can hover (desktop with mouse).
 * Hover-driven play stays the right UX there — users scrub many cards fast,
 * and IO would compete with their cursor. On touch (no hover), we autoplay
 * what the user is actually looking at.
 */
function prefersHoverPlay(): boolean {
  if (typeof window === "undefined") return false
  if (typeof window.matchMedia !== "function") return false
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches
}

/**
 * Pure subscription primitive: plays `video` while ≥`threshold` of it is
 * visible, pauses when below. Returns an unsubscribe that disconnects the
 * observer and releases the slot. Exported for tests so we can drive the IO
 * callback directly without a React renderer.
 */
export function subscribeInViewAutoplay(video: HTMLVideoElement, threshold: number): () => void {
  let active = true

  const observer = new IntersectionObserver(
    (entries) => {
      if (!active) return
      for (const entry of entries) {
        if (entry.intersectionRatio >= threshold) {
          requestAutoplay(video)
        } else {
          releaseAutoplay(video)
        }
      }
    },
    { threshold: [0, threshold, 1] },
  )

  observer.observe(video)

  return () => {
    // Strict-mode double-invokes effects — `active` blocks any IO callback
    // that fires after teardown, and we always release the slot so the
    // next mount starts from a clean budget.
    active = false
    observer.disconnect()
    releaseAutoplay(video)
  }
}

interface UseInViewAutoplayOptions {
  /** Visibility ratio (0–1) at which to begin playing. Defaults to 0.5. */
  threshold?: number
  /** Skip the observer (e.g. when the video failed to load). */
  disabled?: boolean
}

/**
 * Plays a `<video>` element when it scrolls into view and pauses when it
 * leaves. No-op on hover-capable devices — the consumer keeps its hover
 * handlers. Side-effect-only; returns nothing.
 */
export function useInViewAutoplay(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  { threshold = 0.5, disabled = false }: UseInViewAutoplayOptions = {},
): void {
  React.useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (video === null) return
    if (typeof window === "undefined") return
    if (typeof window.IntersectionObserver !== "function") return
    if (prefersHoverPlay()) return

    return subscribeInViewAutoplay(video, threshold)
  }, [videoRef, threshold, disabled])
}
