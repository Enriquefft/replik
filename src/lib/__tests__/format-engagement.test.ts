import { describe, expect, test } from "bun:test"
import { formatCount, formatRelativeTimeEs } from "@/lib/format-engagement.ts"

describe("formatCount", () => {
  test("returns '0' for non-positive or non-finite inputs", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(-50)).toBe("0")
    expect(formatCount(Number.NaN)).toBe("0")
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0")
  })

  test("returns the integer as-is below 1K", () => {
    expect(formatCount(1)).toBe("1")
    expect(formatCount(742)).toBe("742")
    expect(formatCount(999)).toBe("999")
  })

  test("formats thousands with truncated single decimal", () => {
    expect(formatCount(1_000)).toBe("1K")
    expect(formatCount(1_200)).toBe("1.2K")
    // Truncation, not rounding — 1,999 must NOT become "2K".
    expect(formatCount(1_999)).toBe("1.9K")
    expect(formatCount(12_500)).toBe("12.5K")
  })

  test("formats millions with truncated single decimal", () => {
    expect(formatCount(1_000_000)).toBe("1M")
    expect(formatCount(2_500_000)).toBe("2.5M")
    expect(formatCount(2_599_000)).toBe("2.5M")
    expect(formatCount(10_000_000)).toBe("10M")
  })
})

describe("formatRelativeTimeEs", () => {
  const now = new Date("2026-05-09T12:00:00Z")

  test("future timestamps collapse to 'hoy'", () => {
    expect(formatRelativeTimeEs(new Date("2026-05-10T00:00:00Z"), now)).toBe("hoy")
  })

  test("seconds bucket renders 'ahora'", () => {
    const d = new Date(now.getTime() - 30 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("ahora")
  })

  test("minute bucket", () => {
    const d = new Date(now.getTime() - 5 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 5m")
  })

  test("hour bucket", () => {
    const d = new Date(now.getTime() - 3 * 60 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 3h")
  })

  test("day bucket", () => {
    const d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 3d")
  })

  test("week bucket", () => {
    const d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 2 sem")
  })

  test("month bucket", () => {
    const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 3 mes")
  })

  test("year bucket", () => {
    const d = new Date(now.getTime() - 800 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTimeEs(d, now)).toBe("hace 2 año")
  })
})
