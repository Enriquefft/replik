import { describe, expect, test } from "bun:test"

import type { Cue } from "@/lib/ai/schemas.ts"
import { reSegmentCues } from "@/lib/video/cue-segmenter.ts"

const cue = (index: number, startMs: number, endMs: number, text: string): Cue => ({
  index,
  startMs,
  endMs,
  text,
})

describe("reSegmentCues", () => {
  test("splits a 12-word cue into 3 four-word UPPERCASE cues", () => {
    const out = reSegmentCues([
      cue(1, 0, 3000, "the quick brown fox jumps over the lazy dog and then again"),
    ])

    expect(out).toHaveLength(3)
    expect(out[0]?.text).toBe("THE QUICK BROWN FOX")
    expect(out[1]?.text).toBe("JUMPS OVER THE LAZY")
    expect(out[2]?.text).toBe("DOG AND THEN AGAIN")
    expect(out[0]?.index).toBe(1)
    expect(out[1]?.index).toBe(2)
    expect(out[2]?.index).toBe(3)
  })

  test("preserves total duration across split cues", () => {
    const out = reSegmentCues([cue(1, 1000, 4000, "uno dos tres cuatro cinco seis siete ocho")])

    expect(out[0]?.startMs).toBe(1000)
    expect(out.at(-1)?.endMs).toBe(4000)
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]?.startMs).toBe(out[i - 1]?.endMs ?? -1)
    }
  })

  test("a 1-word cue stays as a single cue", () => {
    const out = reSegmentCues([cue(1, 0, 500, "hola")])
    expect(out).toHaveLength(1)
    expect(out[0]?.text).toBe("HOLA")
    expect(out[0]?.startMs).toBe(0)
    expect(out[0]?.endMs).toBe(500)
  })

  test("renumbers indices contiguously across multiple input cues", () => {
    const out = reSegmentCues([
      cue(7, 0, 1000, "alpha beta gamma delta epsilon"),
      cue(12, 1000, 2000, "one two"),
    ])
    expect(out.map((c) => c.index)).toEqual([1, 2, 3])
  })

  test("collapses internal newlines and extra whitespace", () => {
    const out = reSegmentCues([cue(1, 0, 1000, "line one\nline two   \t  with  spaces")])
    expect(out).toHaveLength(2)
    expect(out[0]?.text).toBe("LINE ONE LINE TWO")
    expect(out[1]?.text).toBe("WITH SPACES")
  })

  test("respects custom maxWords", () => {
    const out = reSegmentCues([cue(1, 0, 1000, "one two three four five six")], { maxWords: 2 })
    expect(out.map((c) => c.text)).toEqual(["ONE TWO", "THREE FOUR", "FIVE SIX"])
  })

  test("opt-out of uppercase keeps casing", () => {
    const out = reSegmentCues([cue(1, 0, 1000, "Hola Mundo Desde Lima")], { uppercase: false })
    expect(out[0]?.text).toBe("Hola Mundo Desde Lima")
  })

  test("rejects maxWords < 1", () => {
    expect(() => reSegmentCues([cue(1, 0, 1000, "x")], { maxWords: 0 })).toThrow()
  })

  test("skips cues whose text is whitespace-only", () => {
    const out = reSegmentCues([cue(1, 0, 500, "   \n\t   "), cue(2, 500, 1000, "hola")])
    expect(out).toHaveLength(1)
    expect(out[0]?.text).toBe("HOLA")
    expect(out[0]?.index).toBe(1)
  })
})
