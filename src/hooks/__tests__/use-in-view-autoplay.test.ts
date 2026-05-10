import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  MAX_CONCURRENT_AUTOPLAY,
  releaseAutoplay,
  requestAutoplay,
  resetAutoplayBudgetForTests,
  subscribeInViewAutoplay,
} from "@/hooks/use-in-view-autoplay.ts"

interface FakeVideo {
  play: ReturnType<typeof mock>
  pause: ReturnType<typeof mock>
  currentTime: number
}

/**
 * Build a stub that quacks like the slice of `HTMLVideoElement` the FIFO
 * actually touches (`play`, `pause`, `currentTime`). Bun's test runtime is
 * node-based — `HTMLVideoElement` exists only as a TS type from `lib: dom`,
 * so the only way to satisfy the structural type without dragging jsdom in
 * is `as unknown as`. CLAUDE.md permits `as` when there is no alternative.
 */
function makeFakeVideo(): { video: HTMLVideoElement; spy: FakeVideo } {
  const spy: FakeVideo = {
    play: mock(() => Promise.resolve()),
    pause: mock(() => undefined),
    currentTime: 0,
  }
  const video = spy as unknown as HTMLVideoElement
  return { video, spy }
}

interface CapturedObserver {
  callback: IntersectionObserverCallback
  observed: Element[]
  disconnected: boolean
}

/**
 * Replace the global `IntersectionObserver` with one whose constructor records
 * the callback so the test can fire intersection events on demand. Returns
 * the captured-observer registry plus a restore function.
 */
function installIntersectionObserverSpy(): {
  observers: CapturedObserver[]
  restore: () => void
} {
  const observers: CapturedObserver[] = []
  const original = globalThis.IntersectionObserver

  class SpyIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ""
    readonly scrollMargin: string = ""
    readonly thresholds: ReadonlyArray<number> = []
    readonly #captured: CapturedObserver

    constructor(callback: IntersectionObserverCallback) {
      this.#captured = { callback, observed: [], disconnected: false }
      observers.push(this.#captured)
    }
    observe(target: Element): void {
      this.#captured.observed.push(target)
    }
    unobserve(): void {}
    disconnect(): void {
      this.#captured.disconnected = true
    }
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  globalThis.IntersectionObserver = SpyIntersectionObserver

  return {
    observers,
    restore: () => {
      globalThis.IntersectionObserver = original
    },
  }
}

/** Stub IntersectionObserver instance — the production callback never reads it. */
function makeStubObserverInstance(): IntersectionObserver {
  const stub = {
    root: null,
    rootMargin: "",
    thresholds: [],
    disconnect: () => {},
    observe: () => {},
    takeRecords: (): IntersectionObserverEntry[] => [],
    unobserve: () => {},
  }
  return stub as unknown as IntersectionObserver
}

/** Build a minimal `IntersectionObserverEntry` for a given target + ratio. */
function makeEntry(target: Element, ratio: number): IntersectionObserverEntry {
  // The production callback only reads `intersectionRatio`. The rest of the
  // entry is supplied as zero-value structural stubs so we don't pull DOM
  // runtime types (`DOMRect`) into bun:test's node environment.
  const zeroRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
  const stub = {
    target,
    intersectionRatio: ratio,
    isIntersecting: ratio > 0,
    boundingClientRect: zeroRect,
    intersectionRect: zeroRect,
    rootBounds: null,
    time: 0,
  }
  return stub as unknown as IntersectionObserverEntry
}

beforeEach(() => {
  resetAutoplayBudgetForTests()
})

afterEach(() => {
  resetAutoplayBudgetForTests()
})

describe("requestAutoplay / releaseAutoplay (pure FIFO)", () => {
  test("plays a single video and releases it cleanly", () => {
    const { video, spy } = makeFakeVideo()
    requestAutoplay(video)
    expect(spy.play).toHaveBeenCalledTimes(1)

    releaseAutoplay(video)
    expect(spy.pause).toHaveBeenCalledTimes(1)
    expect(spy.currentTime).toBe(0)
  })

  test("re-requesting the same video is a no-op", () => {
    const { video, spy } = makeFakeVideo()
    requestAutoplay(video)
    requestAutoplay(video)
    expect(spy.play).toHaveBeenCalledTimes(1)
  })

  test("4th play evicts the oldest (FIFO cap = 3)", () => {
    expect(MAX_CONCURRENT_AUTOPLAY).toBe(3)
    const a = makeFakeVideo()
    const b = makeFakeVideo()
    const c = makeFakeVideo()
    const d = makeFakeVideo()

    requestAutoplay(a.video)
    requestAutoplay(b.video)
    requestAutoplay(c.video)

    expect(a.spy.pause).not.toHaveBeenCalled()
    expect(b.spy.pause).not.toHaveBeenCalled()
    expect(c.spy.pause).not.toHaveBeenCalled()

    requestAutoplay(d.video)

    expect(a.spy.pause).toHaveBeenCalledTimes(1)
    expect(b.spy.pause).not.toHaveBeenCalled()
    expect(c.spy.pause).not.toHaveBeenCalled()
    expect(d.spy.play).toHaveBeenCalledTimes(1)
  })

  test("releasing an unknown video does nothing", () => {
    const { video, spy } = makeFakeVideo()
    releaseAutoplay(video)
    expect(spy.pause).not.toHaveBeenCalled()
  })
})

describe("subscribeInViewAutoplay (IntersectionObserver-driven)", () => {
  test("plays when entry crosses the threshold and pauses when it leaves", () => {
    const io = installIntersectionObserverSpy()
    try {
      const { video, spy } = makeFakeVideo()
      const unsubscribe = subscribeInViewAutoplay(video, 0.5)

      const captured = io.observers[0]
      expect(captured).toBeDefined()
      if (captured === undefined) throw new Error("observer not captured")
      expect(captured.observed).toContain(video)

      const observerInstance = makeStubObserverInstance()

      // Simulate the card scrolling into view.
      captured.callback([makeEntry(video, 0.75)], observerInstance)
      expect(spy.play).toHaveBeenCalledTimes(1)

      // And then out of view.
      captured.callback([makeEntry(video, 0.1)], observerInstance)
      expect(spy.pause).toHaveBeenCalledTimes(1)

      unsubscribe()
      expect(captured.disconnected).toBe(true)
    } finally {
      io.restore()
    }
  })

  test("teardown blocks late IO callbacks (strict-mode safe)", () => {
    const io = installIntersectionObserverSpy()
    try {
      const { video, spy } = makeFakeVideo()
      const unsubscribe = subscribeInViewAutoplay(video, 0.5)

      const captured = io.observers[0]
      if (captured === undefined) throw new Error("observer not captured")

      unsubscribe()

      // A delayed IO callback firing after teardown must not call play().
      captured.callback([makeEntry(video, 0.9)], makeStubObserverInstance())
      expect(spy.play).not.toHaveBeenCalled()
    } finally {
      io.restore()
    }
  })

  test("FIFO cap holds across multiple IO subscriptions", () => {
    const io = installIntersectionObserverSpy()
    try {
      const v1 = makeFakeVideo()
      const v2 = makeFakeVideo()
      const v3 = makeFakeVideo()
      const v4 = makeFakeVideo()

      const u1 = subscribeInViewAutoplay(v1.video, 0.5)
      const u2 = subscribeInViewAutoplay(v2.video, 0.5)
      const u3 = subscribeInViewAutoplay(v3.video, 0.5)
      const u4 = subscribeInViewAutoplay(v4.video, 0.5)

      const observerInstance = makeStubObserverInstance()
      const cbs = io.observers.map((o) => o.callback)
      cbs[0]?.([makeEntry(v1.video, 0.9)], observerInstance)
      cbs[1]?.([makeEntry(v2.video, 0.9)], observerInstance)
      cbs[2]?.([makeEntry(v3.video, 0.9)], observerInstance)
      cbs[3]?.([makeEntry(v4.video, 0.9)], observerInstance)

      // v1 should have been evicted by v4.
      expect(v1.spy.pause).toHaveBeenCalledTimes(1)
      expect(v4.spy.play).toHaveBeenCalledTimes(1)

      u1()
      u2()
      u3()
      u4()
    } finally {
      io.restore()
    }
  })
})
