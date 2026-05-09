/**
 * Fixture-free tests for `rankByAngleDiversity()` — verifies round-robin
 * interleaving, scrapedAt tiebreaks, unclassified-tail behavior, and
 * single-angle / empty edge cases.
 */

import { describe, expect, test } from "bun:test"
import { rankByAngleDiversity } from "@/lib/rank/angle-diversity.ts"

interface Row {
  id: string
  angle: string | null
  scrapedAt: Date
}

const t = (iso: string) => new Date(iso)

describe("rankByAngleDiversity", () => {
  test("round-robin across angles, classified-first within each depth", () => {
    const rows: Row[] = [
      { id: "p1", angle: "precio", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "p2", angle: "precio", scrapedAt: t("2026-05-02T00:00:00Z") },
      { id: "p3", angle: "precio", scrapedAt: t("2026-05-03T00:00:00Z") },
      { id: "d1", angle: "demostracion", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "d2", angle: "demostracion", scrapedAt: t("2026-05-02T00:00:00Z") },
      { id: "t1", angle: "testimonio", scrapedAt: t("2026-05-01T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    // depth 0: demostracion, precio, testimonio (alpha order across angle keys)
    // depth 1: demostracion, precio
    // depth 2: precio
    expect(out).toEqual(["d1", "p1", "t1", "d2", "p2", "p3"])
  })

  test("unclassified rows sink to tail, scrapedAt-sorted", () => {
    const rows: Row[] = [
      { id: "p1", angle: "precio", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "u2", angle: null, scrapedAt: t("2026-05-03T00:00:00Z") },
      { id: "u1", angle: null, scrapedAt: t("2026-05-02T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    expect(out).toEqual(["p1", "u1", "u2"])
  })

  test("within-bucket ordering uses scrapedAt asc", () => {
    const rows: Row[] = [
      { id: "p_late", angle: "precio", scrapedAt: t("2026-05-05T00:00:00Z") },
      { id: "p_early", angle: "precio", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "p_mid", angle: "precio", scrapedAt: t("2026-05-03T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    expect(out).toEqual(["p_early", "p_mid", "p_late"])
  })

  test("single-angle pool reduces to scrapedAt order", () => {
    const rows: Row[] = [
      { id: "a", angle: "precio", scrapedAt: t("2026-05-02T00:00:00Z") },
      { id: "b", angle: "precio", scrapedAt: t("2026-05-01T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    expect(out).toEqual(["b", "a"])
  })

  test("all-unclassified pool returns scrapedAt-sorted tail", () => {
    const rows: Row[] = [
      { id: "x", angle: null, scrapedAt: t("2026-05-02T00:00:00Z") },
      { id: "y", angle: null, scrapedAt: t("2026-05-01T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    expect(out).toEqual(["y", "x"])
  })

  test("empty input returns empty array", () => {
    expect(rankByAngleDiversity([])).toEqual([])
  })

  test("alpha tie-break across angle keys is stable across runs", () => {
    const rows: Row[] = [
      { id: "z1", angle: "zeta", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "a1", angle: "alpha", scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "m1", angle: "mid", scrapedAt: t("2026-05-01T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    expect(out).toEqual(["a1", "m1", "z1"])
  })

  test("does not mutate input array", () => {
    const rows: Row[] = [
      { id: "p1", angle: "precio", scrapedAt: t("2026-05-02T00:00:00Z") },
      { id: "p2", angle: "precio", scrapedAt: t("2026-05-01T00:00:00Z") },
    ]
    const snapshot = rows.map((r) => r.id)
    rankByAngleDiversity(rows)
    expect(rows.map((r) => r.id)).toEqual(snapshot)
  })

  test("interleaves a realistic 14-row pool covering every angle in first sweep", () => {
    // Mirrors the actual customer-test result: 14 classified creatives skewed
    // toward `precio` (8) with a long tail. Top-of-grid should expose the
    // user to every distinct angle within the first 4 cards.
    const rows: Row[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `pr${i.toString()}`,
        angle: "precio" as string | null,
        scrapedAt: t(`2026-05-0${(i + 1).toString()}T00:00:00Z`),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `dm${i.toString()}`,
        angle: "demostracion" as string | null,
        scrapedAt: t(`2026-05-0${(i + 1).toString()}T00:00:00Z`),
      })),
      { id: "ts0", angle: "testimonio" as string | null, scrapedAt: t("2026-05-01T00:00:00Z") },
      { id: "ts1", angle: "testimonio" as string | null, scrapedAt: t("2026-05-02T00:00:00Z") },
    ]
    const out = rankByAngleDiversity(rows).map((r) => r.id)
    // First 3 must include exactly one row per distinct angle.
    const firstThreeAngles = new Set(out.slice(0, 3).map((id) => id.slice(0, 2)))
    expect(firstThreeAngles).toEqual(new Set(["dm", "pr", "ts"]))
  })
})
