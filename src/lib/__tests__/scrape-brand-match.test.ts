/**
 * Unit tests for the brand-match helpers (Phase P2.1).
 *
 * Cover normalization (case, diacritics, suffix-strip, punctuation), key-set
 * dedup + min-length filtering, and substring matching against page_name.
 */

import { describe, expect, test } from "bun:test"
import { buildBrandKeySet, matchBrandKey, normalizeBrandKey } from "@/lib/scrape-brand-match.ts"

describe("normalizeBrandKey", () => {
  test("lowercase + diacritic strip + punctuation collapse", () => {
    expect(normalizeBrandKey("Florería de Bloom")).toBe("floreria de bloom")
    expect(normalizeBrandKey("L'Oréal")).toBe("l oreal")
    expect(normalizeBrandKey("Café-Diem")).toBe("cafe diem")
  })

  test("trailing corporate suffix tokens are stripped", () => {
    expect(normalizeBrandKey("JoySpring Inc.")).toBe("joyspring")
    expect(normalizeBrandKey("Acme Corp")).toBe("acme")
    expect(normalizeBrandKey("Replik LLC")).toBe("replik")
    expect(normalizeBrandKey("Inca Glow S.A.")).toBe("inca glow")
  })

  test("preserves single-token brand even when it matches a suffix word", () => {
    expect(normalizeBrandKey("Co")).toBe("co")
    expect(normalizeBrandKey("Sa")).toBe("sa")
  })

  test("collapses repeated whitespace + punctuation runs", () => {
    expect(normalizeBrandKey("  Joy   Spring  ")).toBe("joy spring")
    expect(normalizeBrandKey("Joy --- Spring")).toBe("joy spring")
  })

  test("returns empty string when nothing usable remains", () => {
    expect(normalizeBrandKey("")).toBe("")
    expect(normalizeBrandKey("   ")).toBe("")
    expect(normalizeBrandKey("---")).toBe("")
  })
})

describe("buildBrandKeySet", () => {
  test("dedups normalized keys and drops short ones", () => {
    const keys = buildBrandKeySet(["JoySpring", "joyspring", "JoySpring Inc.", "Co"])
    expect(keys.size).toBe(1)
    expect(keys.has("joyspring")).toBe(true)
  })

  test("ignores null/undefined entries", () => {
    const keys = buildBrandKeySet(["JoySpring", null, undefined, ""])
    expect(keys.size).toBe(1)
    expect(keys.has("joyspring")).toBe(true)
  })

  test("multiple distinct brands → multiple keys", () => {
    const keys = buildBrandKeySet(["Lingolib", "JoySpring"])
    expect(keys.size).toBe(2)
    expect(keys.has("lingolib")).toBe(true)
    expect(keys.has("joyspring")).toBe(true)
  })
})

describe("matchBrandKey", () => {
  const keys = buildBrandKeySet(["JoySpring", "Inca Glow"])

  test("exact match (case-insensitive)", () => {
    expect(matchBrandKey("JoySpring", keys)).toBe("joyspring")
    expect(matchBrandKey("joyspring", keys)).toBe("joyspring")
  })

  test("page_name with corporate suffix → match", () => {
    expect(matchBrandKey("JoySpring Inc.", keys)).toBe("joyspring")
  })

  test("page_name with descriptor (Official Store) → match via substring", () => {
    expect(matchBrandKey("JoySpring - Official Store", keys)).toBe("joyspring")
    expect(matchBrandKey("JoySpring (Tienda Oficial)", keys)).toBe("joyspring")
  })

  test("multi-word brand match", () => {
    expect(matchBrandKey("Inca Glow Perú", keys)).toBe("inca glow")
  })

  test("unrelated advertiser → null", () => {
    expect(matchBrandKey("DramaBox", keys)).toBe(null)
    expect(matchBrandKey("Dr. João Migowski", keys)).toBe(null)
  })

  test("substring without token boundary → null (no false-positive)", () => {
    // Brand "Bee" should NOT match "BeeKeeper Honey" — that's a substring
    // match the customer would flag as wrong. Token-aligned containment
    // requires whole-word tokens.
    const beeKeys = buildBrandKeySet(["Bee"])
    expect(matchBrandKey("BeeKeeper Honey", beeKeys)).toBe(null)
    expect(matchBrandKey("Yankee Candle", beeKeys)).toBe(null)
    expect(matchBrandKey("Bee", beeKeys)).toBe("bee")
    expect(matchBrandKey("Bee Honey Co", beeKeys)).toBe("bee")
  })

  test("multi-token brand requires contiguous token run", () => {
    const incaKeys = buildBrandKeySet(["Inca Glow"])
    // Tokens out of order or with intruding tokens → null.
    expect(matchBrandKey("Glow Inca", incaKeys)).toBe(null)
    expect(matchBrandKey("Inca Premium Glow", incaKeys)).toBe(null)
    // Contiguous run, with surrounding context → match.
    expect(matchBrandKey("Inca Glow Perú", incaKeys)).toBe("inca glow")
    expect(matchBrandKey("Tienda Inca Glow", incaKeys)).toBe("inca glow")
  })

  test("null/undefined/empty page_name → null", () => {
    expect(matchBrandKey(null, keys)).toBe(null)
    expect(matchBrandKey(undefined, keys)).toBe(null)
    expect(matchBrandKey("", keys)).toBe(null)
  })

  test("empty key set → null", () => {
    const empty = buildBrandKeySet([])
    expect(matchBrandKey("JoySpring", empty)).toBe(null)
  })
})
