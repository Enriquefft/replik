/**
 * Tests for `rankByComposite` — verifies the composite scoring,
 * angle-bucket round-robin, and tail-placement of unclassified rows.
 *
 * All tests pin `now` so the recency exponential is deterministic.
 */

import { describe, expect, it } from "bun:test"

import { rankByComposite } from "@/lib/rank/composite.ts"

const NOW = new Date("2026-05-09T00:00:00Z")
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)

interface Row {
  id: string
  angle: string | null
  brandMatched: boolean
  playCount: number | null
  postedAt: Date | null
  scrapedAt: Date
}

const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  id,
  angle: "precio",
  brandMatched: false,
  playCount: null,
  postedAt: null,
  scrapedAt: daysAgo(0),
  ...overrides,
})

describe("rankByComposite", () => {
  it("returns [] for empty input", () => {
    expect(rankByComposite([], { now: NOW })).toEqual([])
  })

  it("returns a single row unchanged", () => {
    const r = row("a")
    expect(rankByComposite([r], { now: NOW }).map((x) => x.id)).toEqual(["a"])
  })

  it("brand-matched rows beat non-matched at equal engagement", () => {
    const a = row("a", { brandMatched: true, playCount: 1000, postedAt: daysAgo(30) })
    const b = row("b", { brandMatched: false, playCount: 1000, postedAt: daysAgo(30) })
    expect(rankByComposite([b, a], { now: NOW }).map((x) => x.id)).toEqual(["a", "b"])
  })

  it("higher engagement wins within the same angle", () => {
    const a = row("a", { angle: "precio", playCount: 100 })
    const b = row("b", { angle: "precio", playCount: 1_000_000 })
    const c = row("c", { angle: "precio", playCount: 10_000 })
    expect(rankByComposite([a, b, c], { now: NOW }).map((x) => x.id)).toEqual(["b", "c", "a"])
  })

  it("recency decays — newer beats older at equal engagement+brand", () => {
    const fresh = row("fresh", { playCount: 1000, postedAt: daysAgo(7) })
    const stale = row("stale", { playCount: 1000, postedAt: daysAgo(180) })
    expect(rankByComposite([stale, fresh], { now: NOW }).map((x) => x.id)).toEqual([
      "fresh",
      "stale",
    ])
  })

  it("interleaves across angle buckets, leader-of-strongest-angle first", () => {
    const a1 = row("a1", { angle: "precio", playCount: 1_000_000 })
    const a2 = row("a2", { angle: "precio", playCount: 100 })
    const b1 = row("b1", { angle: "demostracion", playCount: 500_000 })
    const b2 = row("b2", { angle: "demostracion", playCount: 50 })
    // First round = leader of each angle (precio leads, demostracion second).
    // Second round = #2 of each angle.
    expect(rankByComposite([a2, b2, a1, b1], { now: NOW }).map((x) => x.id)).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
    ])
  })

  it("unclassified rows tail at the end regardless of score", () => {
    const classified = row("c", { angle: "precio", brandMatched: false, playCount: 100 })
    const unclassifiedHigh = row("u", {
      angle: null,
      brandMatched: true,
      playCount: 10_000_000,
    })
    const out = rankByComposite([unclassifiedHigh, classified], { now: NOW }).map((x) => x.id)
    expect(out).toEqual(["c", "u"])
  })

  it("null playCount and null postedAt do not crash; neutral recency applies", () => {
    const noMeta = row("noMeta", { angle: "precio", playCount: null, postedAt: null })
    const withMeta = row("withMeta", {
      angle: "precio",
      playCount: 1000,
      postedAt: daysAgo(30),
    })
    const out = rankByComposite([noMeta, withMeta], { now: NOW }).map((x) => x.id)
    // withMeta has engagement signal + recent posted; noMeta has neutral
    // recency (0.5) but zero engagement. withMeta wins.
    expect(out).toEqual(["withMeta", "noMeta"])
  })

  it("is deterministic — equal scores tiebreak by scrapedAt asc", () => {
    const a = row("a", { angle: "precio", playCount: 1000, scrapedAt: daysAgo(5) })
    const b = row("b", { angle: "precio", playCount: 1000, scrapedAt: daysAgo(2) })
    // Exact same composite (same brand, same eng denom, same null postedAt
    // → neutral recency); scrapedAt asc → a (older) first.
    expect(rankByComposite([b, a], { now: NOW }).map((x) => x.id)).toEqual(["a", "b"])
  })
})
