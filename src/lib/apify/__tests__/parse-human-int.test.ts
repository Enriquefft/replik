/**
 * Unit tests for `parseHumanInt` — the boundary that converts
 * compact human-readable counts ("1.2M", "500K") to numbers so
 * the downstream typed columns get integers, not strings.
 */

import { describe, expect, test } from "bun:test"

import { parseHumanInt } from "@/lib/apify/parse-human-int.ts"

describe("parseHumanInt", () => {
  test("parses bare integers", () => {
    expect(parseHumanInt("1234")).toBe(1234)
    expect(parseHumanInt("0")).toBe(0)
    expect(parseHumanInt("999999")).toBe(999_999)
  })

  test("parses K suffix", () => {
    expect(parseHumanInt("500K")).toBe(500_000)
    expect(parseHumanInt("1k")).toBe(1_000)
    expect(parseHumanInt("12.5K")).toBe(12_500)
  })

  test("parses M suffix", () => {
    expect(parseHumanInt("1.2M")).toBe(1_200_000)
    expect(parseHumanInt("1m")).toBe(1_000_000)
    expect(parseHumanInt("3.4M")).toBe(3_400_000)
  })

  test("parses B suffix", () => {
    expect(parseHumanInt("1.5B")).toBe(1_500_000_000)
    expect(parseHumanInt("2b")).toBe(2_000_000_000)
  })

  test("ignores surrounding whitespace", () => {
    expect(parseHumanInt("  1.2M  ")).toBe(1_200_000)
    expect(parseHumanInt("\t500K\n")).toBe(500_000)
  })

  test("is case-insensitive on the suffix", () => {
    expect(parseHumanInt("1.2M")).toBe(parseHumanInt("1.2m"))
    expect(parseHumanInt("500K")).toBe(parseHumanInt("500k"))
  })

  test("floors fractional results", () => {
    expect(parseHumanInt("1.2345K")).toBe(1234)
  })

  test("throws on empty input", () => {
    expect(() => parseHumanInt("")).toThrow()
    expect(() => parseHumanInt("   ")).toThrow()
  })

  test("throws on garbage input", () => {
    expect(() => parseHumanInt("abc")).toThrow()
    expect(() => parseHumanInt("1.2X")).toThrow()
    expect(() => parseHumanInt("1..2M")).toThrow()
    expect(() => parseHumanInt("M")).toThrow()
    expect(() => parseHumanInt("-5K")).toThrow()
  })
})
