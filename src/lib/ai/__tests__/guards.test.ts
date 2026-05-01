/**
 * Tests for guards.ts — §5 AI-speak + Meta-policy rules.
 *
 * Coverage:
 *   1. aiSpeak — triple-adjective rule (AI_SPEAK_TRIPLE_ADJECTIVE)
 *   2. aiSpeak — existing 4 rules do not regress
 *   3. metaPolicy — existing 3 rules smoke-check
 */

import { describe, expect, test } from "bun:test"
import { aiSpeak, metaPolicy } from "@/lib/ai/guards.ts"

// ─── aiSpeak — triple-adjective rule ─────────────────────────────────────────

describe("aiSpeak — AI_SPEAK_TRIPLE_ADJECTIVE", () => {
  test("three comma-separated adjectives triggers fail (ASCII)", () => {
    const result = aiSpeak("facil, rapido, eficaz")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("AI_SPEAK_TRIPLE_ADJECTIVE")
    }
  })

  test("triple adjective embedded in a sentence triggers fail", () => {
    const result = aiSpeak("Producto suave, ligero, resistente para tu hogar.")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("AI_SPEAK_TRIPLE_ADJECTIVE")
    }
  })

  test("two adjectives separated by comma passes", () => {
    const result = aiSpeak("fácil, rápido")
    expect(result.ok).toBe(true)
  })

  test("two adjectives joined by 'y' passes", () => {
    const result = aiSpeak("rápido y eficaz")
    expect(result.ok).toBe(true)
  })

  test("clean copy with no adjective list passes", () => {
    const result = aiSpeak("Tres ollas a 89 soles, hoy nada más.")
    expect(result.ok).toBe(true)
  })
})

// ─── aiSpeak — existing 4 rules (regression) ─────────────────────────────────

describe("aiSpeak — existing rules do not regress", () => {
  test("AI_SPEAK_VERBS — 'Descubre' at start triggers fail", () => {
    const result = aiSpeak("Descubre el mejor producto")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("AI_SPEAK_VERBS")
  })

  test("AI_SPEAK_VERBS — 'Transforma' at start triggers fail", () => {
    const result = aiSpeak("Transforma tu vida hoy")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("AI_SPEAK_VERBS")
  })

  test("AI_SPEAK_VERBS — imperative verb mid-sentence does not trigger fail", () => {
    const result = aiSpeak("Mira cómo descubre el truco.")
    expect(result.ok).toBe(true)
  })

  test("AI_SPEAK_EM_DASH — em dash triggers fail", () => {
    const result = aiSpeak("Bueno, bonito — y barato")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("AI_SPEAK_EM_DASH")
  })

  test("AI_SPEAK_ALL_CAPS — all-caps word of 3+ letters triggers fail", () => {
    const result = aiSpeak("Precio INCREIBLE hoy")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("AI_SPEAK_ALL_CAPS")
  })

  test("AI_SPEAK_ALL_CAPS — short all-caps token TV passes", () => {
    const result = aiSpeak("Para tu TV y hogar.")
    expect(result.ok).toBe(true)
  })

  test("AI_SPEAK_EXCLAMATION_CHAIN — double exclamation triggers fail", () => {
    const result = aiSpeak("Compra ahora!!")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("AI_SPEAK_EXCLAMATION_CHAIN")
  })

  test("AI_SPEAK_EXCLAMATION_CHAIN — single exclamation passes", () => {
    const result = aiSpeak("Compra ahora!")
    expect(result.ok).toBe(true)
  })

  test("clean copy passes all checks", () => {
    const result = aiSpeak("Tres ollas a 89 soles. Mismo material, sin pagar la marquita.")
    expect(result.ok).toBe(true)
  })
})

// ─── metaPolicy — smoke-check existing 3 rules ───────────────────────────────

describe("metaPolicy — existing rules smoke-check", () => {
  test("META_POLICY_MEDICAL — 'cura' triggers fail", () => {
    const result = metaPolicy("Este producto cura el dolor de espalda.")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("META_POLICY_MEDICAL")
  })

  test("META_POLICY_PERSONAL_ATTR — '¿sufres' triggers fail", () => {
    const result = metaPolicy("¿sufres de dolor articular?")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("META_POLICY_PERSONAL_ATTR")
  })

  test("META_POLICY_BEFORE_AFTER — 'antes y después' triggers fail", () => {
    const result = metaPolicy("Mira el antes y después del tratamiento.")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("META_POLICY_BEFORE_AFTER")
  })

  test("clean copy passes metaPolicy", () => {
    const result = metaPolicy("Tres ollas a 89 soles. Mismo material, sin pagar la marquita.")
    expect(result.ok).toBe(true)
  })
})
