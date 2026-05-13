/**
 * Tests for `generateCopy` — §11 best-of-5 + Opus judge + post-check.
 *
 * The fixture `fixtures/copy-gen.json` is a curated table of 30 scenarios:
 *   - 18 happy rows: both judges agree on the same winner; post-check passes.
 *   - 6 judge-disagreement rows: judges return different winners → fallback
 *     to ANCHOR_INDEX (Hook-led, index 0).
 *   - 6 post-check-failure rows: the agreed winner trips a `metaPolicy` or
 *     `aiSpeak` rule → one row-targeted regenerate cycle.
 *
 * Test deps are injected directly via `CopyGenDeps` so the production
 * `withRetry`-wrapped Anthropic calls are bypassed entirely (no network /
 * provider in unit tests).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"
import {
  type CopyGenDeps,
  FRAMINGS,
  type GenerateCandidateFn,
  generateCopy,
  type JudgeFn,
  type RegenerateFn,
  runPostCheck,
} from "@/lib/ai/copy-gen.ts"
import type { CopyContent } from "@/lib/ai/copy-schema.ts"
import { aiSpeak, metaPolicy } from "@/lib/ai/guards.ts"
import { type CopyGenInput, CopyGenInputSchema } from "@/lib/ai/schemas.ts"

// ─── Fixture loader ──────────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "copy-gen.json")

const ScenarioSchema = z.enum(["happy", "judge-disagreement", "post-check-failure"])

/**
 * Stage-1 candidates may legitimately violate length / policy rules — they
 * are the raw LLM outputs the post-check is supposed to catch. Loosen the
 * structural shape relative to the production `CopyContentSchema`.
 */
const FixtureCandidateSchema = z.object({
  primaryText: z.string(),
  headline: z.string(),
  description: z.string(),
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Mirrors the production `CopyGenInputSchema` but coerces `createdAt`
 * from an ISO string (JSON has no Date type) to a real Date.
 */
const FixtureInputSchema = z.preprocess((value) => {
  if (!isPlainObject(value)) return value
  const product = value.product
  if (!isPlainObject(product)) return value
  if (typeof product.createdAt !== "string") return value
  return {
    ...value,
    product: { ...product, createdAt: new Date(product.createdAt) },
  }
}, CopyGenInputSchema)

const FixtureFileSchema = z.object({
  version: z.number(),
  rows: z.array(
    z.object({
      scenario: ScenarioSchema,
      input: FixtureInputSchema,
      stage1: z.array(FixtureCandidateSchema).length(5),
      stage2JudgeA: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      stage2JudgeB: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      expectedFinal: FixtureCandidateSchema,
      expectedPostCheck: z.object({
        metaPolicy: z.string(),
        aiSpeak: z.string(),
        lengthCheck: z.string(),
      }),
    }),
  ),
})

const fixtureFile = FixtureFileSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")))

// ─── FRAMINGS contract ───────────────────────────────────────────────────────

describe("FRAMINGS", () => {
  test("declares exactly 5 framings in spec order", () => {
    expect(FRAMINGS).toHaveLength(5)
    expect(FRAMINGS.map((f) => f.id)).toEqual([
      "hook-led",
      "benefit-led",
      "social-proof-led",
      "problem-solution-led",
      "outcome-aspiration-led",
    ])
  })

  test("each framing carries a unique opening verb", () => {
    const verbs = FRAMINGS.map((f) => f.openingVerb)
    expect(new Set(verbs).size).toBe(verbs.length)
  })
})

// ─── runPostCheck unit tests ─────────────────────────────────────────────────

describe("runPostCheck", () => {
  test("returns empty list for valid copy", () => {
    const ok: CopyContent = {
      primaryText: "Mira, set de tres ollas a 89 soles. Mismo material, sin pagar la marquita.",
      headline: "Tres ollas a 89 soles",
      description: "Hoy, sin letra chica",
    }
    expect(runPostCheck(ok)).toEqual([])
  })

  test("flags META_POLICY_BEFORE_AFTER on primaryText", () => {
    const candidate: CopyContent = {
      primaryText: "Mira el antes y después en una semana.",
      headline: "Hoy ahorras plata",
      description: "Llega a tu puerta",
    }
    const violations = runPostCheck(candidate)
    expect(
      violations.some((v) => v.field === "primaryText" && v.reason.includes("META_POLICY")),
    ).toBe(true)
  })

  test("flags AI_SPEAK_VERBS at start", () => {
    const candidate: CopyContent = {
      primaryText: "Descubre cómo simplificar tu día con este accesorio peruano.",
      headline: "Más simple cada día",
      description: "Para tu rutina",
    }
    const violations = runPostCheck(candidate)
    expect(violations.some((v) => v.reason.includes("AI_SPEAK"))).toBe(true)
  })

  test("flags LENGTH_VIOLATION when primaryText exceeds 125 chars", () => {
    const candidate: CopyContent = {
      primaryText: "x".repeat(200),
      headline: "Hoy ahorras plata",
      description: "Llega a tu puerta",
    }
    const violations = runPostCheck(candidate)
    expect(violations.some((v) => v.reason.startsWith("LENGTH_VIOLATION"))).toBe(true)
  })

  test("flags DIGIT_HALLUCINATION on numbers absent from whitelist", () => {
    // Whitelist mirrors a product priced 45 / bundle2 80 / bundle3 113 →
    // savings2=10, savings3=22. Plus quantity literals 1/2/3.
    const whitelist = [
      "45",
      "45.00",
      "80",
      "80.00",
      "113",
      "113.00",
      "10",
      "10.00",
      "22",
      "22.00",
      "1",
      "2",
      "3",
    ]
    const candidate: CopyContent = {
      primaryText: "Llévate 2 a 80 soles y ahorra 27 hoy.",
      headline: "Pack 2 a 80",
      description: "Llega a tu puerta",
    }
    const violations = runPostCheck(candidate, whitelist)
    const offending = violations.filter((v) => v.reason.startsWith("DIGIT_HALLUCINATION"))
    expect(offending.length).toBeGreaterThan(0)
    expect(offending[0]?.reason).toContain("27")
  })

  test("accepts comma-decimal forms equivalent to whitelist (80,00 ≡ 80.00)", () => {
    const whitelist = ["45", "45.00", "80", "80.00", "1", "2", "3"]
    const candidate: CopyContent = {
      primaryText: "Llévate 2 packs a 80,00 soles hoy mismo.",
      headline: "Pack 2 a 80",
      description: "Sin recargo",
    }
    const violations = runPostCheck(candidate, whitelist)
    const offending = violations.filter((v) => v.reason.startsWith("DIGIT_HALLUCINATION"))
    expect(offending).toEqual([])
  })

  test("empty whitelist disables digit check (back-compat for pre-Fix-4 callers)", () => {
    const candidate: CopyContent = {
      primaryText: "Llévate 2 a 999 soles hoy.",
      headline: "Pack a 999",
      description: "Sin recargo",
    }
    const violations = runPostCheck(candidate)
    expect(violations.some((v) => v.reason.startsWith("DIGIT_HALLUCINATION"))).toBe(false)
  })
})

// ─── Mock dep factory ────────────────────────────────────────────────────────

interface BuildDepsArgs {
  candidates: readonly CopyContent[]
  judgeAIndex: 0 | 1 | 2 | 3 | 4
  judgeBIndex: 0 | 1 | 2 | 3 | 4
  regenerateOutput?: CopyContent
  regenerateThrows?: boolean
  generateCandidateThrowsAt?: number
  onUnresolvedViolations?: (violations: readonly string[], candidate: CopyContent) => void
}

interface MockState {
  generateCalls: number
  judgeCalls: number
  regenerateCalls: number
}

function buildDeps(args: BuildDepsArgs): { deps: CopyGenDeps; state: MockState } {
  const state: MockState = { generateCalls: 0, judgeCalls: 0, regenerateCalls: 0 }
  const generateCandidate: GenerateCandidateFn = async ({ framing }) => {
    state.generateCalls += 1
    const idx = FRAMINGS.findIndex((f) => f.id === framing.id)
    if (args.generateCandidateThrowsAt === idx) {
      throw new Error(`generateCandidate intentionally threw at index ${idx.toString()}`)
    }
    const candidate = args.candidates[idx]
    if (!candidate) {
      throw new Error(`mock missing candidate for framing ${framing.id}`)
    }
    return candidate
  }
  const judge: JudgeFn = async ({ judgeId }) => {
    state.judgeCalls += 1
    return { winnerIndex: judgeId === "A" ? args.judgeAIndex : args.judgeBIndex }
  }
  const regenerate: RegenerateFn = async () => {
    state.regenerateCalls += 1
    if (args.regenerateThrows) {
      throw new Error("regenerate intentionally threw")
    }
    if (!args.regenerateOutput) {
      throw new Error("mock regenerate called without regenerateOutput configured")
    }
    return args.regenerateOutput
  }
  const deps: CopyGenDeps = { generateCandidate, judge, regenerate }
  if (args.onUnresolvedViolations) {
    deps.onUnresolvedViolations = args.onUnresolvedViolations
  }
  return { deps, state }
}

// ─── Fixture size guard ──────────────────────────────────────────────────────

describe("copy-gen fixture", () => {
  test("has exactly 30 rows", () => {
    expect(fixtureFile.rows).toHaveLength(30)
  })

  test("partitions into 18 happy / 6 judge-disagreement / 6 post-check-failure", () => {
    const counts = fixtureFile.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.scenario] = (acc[r.scenario] ?? 0) + 1
      return acc
    }, {})
    expect(counts.happy).toBe(18)
    expect(counts["judge-disagreement"]).toBe(6)
    expect(counts["post-check-failure"]).toBe(6)
  })
})

// ─── Fixture-driven generateCopy ─────────────────────────────────────────────

describe("generateCopy — fixture-driven", () => {
  for (const row of fixtureFile.rows) {
    test(`scenario "${row.scenario}" → product ${row.input.product.name ?? "?"} returns expected final`, async () => {
      const winnerIndex = row.stage2JudgeA === row.stage2JudgeB ? row.stage2JudgeA : 0
      const winnerCandidate = row.stage1[winnerIndex]
      if (!winnerCandidate) throw new Error("fixture inconsistent: missing winner candidate")

      const winnerHasViolation =
        runPostCheck(winnerCandidate).length > 0 || row.scenario === "post-check-failure"

      const buildArgs: BuildDepsArgs = {
        candidates: row.stage1,
        judgeAIndex: row.stage2JudgeA,
        judgeBIndex: row.stage2JudgeB,
      }
      if (winnerHasViolation) buildArgs.regenerateOutput = row.expectedFinal
      const { deps } = buildDeps(buildArgs)

      const result = await generateCopy(row.input, deps)
      expect(result).toEqual(row.expectedFinal)
    })
  }
})

// ─── generateCopy — happy path explicit ──────────────────────────────────────

describe("generateCopy — explicit semantics", () => {
  const c0: CopyContent = {
    primaryText: "Mira, hoy ahorras plata sin chamba extra. Llega rápido y listo.",
    headline: "Hoy ahorras plata real",
    description: "Llega a tu puerta",
  }
  const c1: CopyContent = {
    primaryText: "Ahorra hasta 50 soles llevando el bundle de dos. Mismo material.",
    headline: "50 soles menos hoy",
    description: "Bundle de dos",
  }
  const c2: CopyContent = {
    primaryText: "Pregunta a quien ya lo tiene. Tres meses usándolo y sigue como nuevo.",
    headline: "Tres meses sin recargas",
    description: "Voz de cliente real",
  }
  const c3: CopyContent = {
    primaryText: "Olvida la chamba de buscar repuestos. Un solo accesorio resuelve el día.",
    headline: "Un accesorio, todo el día",
    description: "Sin repuestos extra",
  }
  const c4: CopyContent = {
    primaryText: "Vive tu cocina sin estrés. Cinco minutos y la mesa lista para todos.",
    headline: "Mesa lista en 5 minutos",
    description: "Cocina sin estrés",
  }
  const cleanCandidates: readonly [
    CopyContent,
    CopyContent,
    CopyContent,
    CopyContent,
    CopyContent,
  ] = [c0, c1, c2, c3, c4]

  const baseInput: CopyGenInput = {
    product: {
      id: "11111111-1111-4111-8111-000000000001",
      userId: "11111111-1111-4111-8111-000000000065",
      sourceUrl: "https://shop.example.com/p/1",
      name: "Producto X",
      imageUrls: ["https://cdn.example.com/x.jpg"],
      brand: null,
      canonicalBrand: null,
      category: "kitchen",
      pricingCents: 5000,
      bundle2PricingCents: 9000,
      bundle3PricingCents: 13000,
      brandTokens: [],
      keywords: [],
      status: "READY",
      shopifyProductId: null,
      shopifyPageHandle: "producto-x",
      shopifyTemplateId: 1,
      description: null,
      scrapeReason: null,
      storefrontUrl: null,
      createdAt: new Date("2026-04-30T00:00:00.000Z"),
    },
    creatives: [
      {
        id: "11111111-1111-4111-8111-0000000000d2",
        angle: "precio",
        transcript: "Transcripción sintética en español neutral peruano.",
        language: "es",
      },
    ],
  }

  test("agreed winner with clean post-check returns the winner verbatim", async () => {
    const { deps, state } = buildDeps({
      candidates: cleanCandidates,
      judgeAIndex: 1,
      judgeBIndex: 1,
    })
    const result = await generateCopy(baseInput, deps)
    expect(result).toEqual(c1)
    expect(state.generateCalls).toBe(5)
    expect(state.judgeCalls).toBe(2)
    expect(state.regenerateCalls).toBe(0)
  })

  test("judge disagreement falls back to ANCHOR_INDEX (Hook-led, index 0)", async () => {
    const { deps, state } = buildDeps({
      candidates: cleanCandidates,
      judgeAIndex: 1,
      judgeBIndex: 3,
    })
    const result = await generateCopy(baseInput, deps)
    expect(result).toEqual(c0)
    expect(state.regenerateCalls).toBe(0)
  })

  test("post-check failure triggers ONE regenerate; merges only failed fields", async () => {
    const violatingWinner: CopyContent = {
      primaryText: "Mira el antes y después en una semana, sin esfuerzo extra.",
      headline: "Antes y después claro",
      description: "Sin riesgos",
    }
    const candidates: readonly CopyContent[] = [c0, violatingWinner, c2, c3, c4]
    expect(metaPolicy(violatingWinner.primaryText).ok).toBe(false)
    expect(metaPolicy(violatingWinner.headline).ok).toBe(false)

    const fixed: CopyContent = {
      primaryText: "Mira lo que cambia con descanso real, sin promesas exageradas.",
      headline: "Resultado posible",
      description: "Sin riesgos",
    }
    const { deps, state } = buildDeps({
      candidates,
      judgeAIndex: 1,
      judgeBIndex: 1,
      regenerateOutput: fixed,
    })
    const result = await generateCopy(baseInput, deps)

    expect(state.regenerateCalls).toBe(1)
    expect(result.primaryText).toBe(fixed.primaryText)
    expect(result.headline).toBe(fixed.headline)
    expect(result.description).toBe(violatingWinner.description)
  })

  test("regenerate throw → onUnresolvedViolations called and original winner returned", async () => {
    const violatingWinner: CopyContent = {
      primaryText: "Descubre cómo arreglar el problema en un día sin esfuerzo extra.",
      headline: "Cambio rápido",
      description: "Sin esfuerzo",
    }
    expect(aiSpeak(violatingWinner.primaryText).ok).toBe(false)

    const candidates: readonly CopyContent[] = [c0, violatingWinner, c2, c3, c4]
    const captures: { violations: readonly string[]; candidate: CopyContent }[] = []
    const { deps } = buildDeps({
      candidates,
      judgeAIndex: 1,
      judgeBIndex: 1,
      regenerateThrows: true,
      onUnresolvedViolations: (violations, candidate) => {
        captures.push({ violations, candidate })
      },
    })
    const result = await generateCopy(baseInput, deps)

    expect(result).toEqual(violatingWinner)
    expect(captures).toHaveLength(1)
    const captured = captures[0]
    if (!captured) throw new Error("captured undefined")
    expect(captured.violations.length).toBeGreaterThan(0)
    expect(captured.candidate).toEqual(violatingWinner)
  })

  test("regenerate output still failing → onUnresolvedViolations called with merged candidate", async () => {
    const violatingWinner: CopyContent = {
      primaryText: "Mira el antes y después en una noche sin esfuerzo extra.",
      headline: "Hoy ahorras plata",
      description: "Sin riesgos",
    }
    const stillBad: CopyContent = {
      primaryText: "Mira el antes y después comprobado por todos los clientes.",
      headline: "Hoy ahorras plata",
      description: "Sin riesgos",
    }
    const candidates: readonly CopyContent[] = [c0, violatingWinner, c2, c3, c4]
    const captures: { violations: readonly string[]; candidate: CopyContent }[] = []
    const { deps } = buildDeps({
      candidates,
      judgeAIndex: 1,
      judgeBIndex: 1,
      regenerateOutput: stillBad,
      onUnresolvedViolations: (violations, candidate) => {
        captures.push({ violations, candidate })
      },
    })
    const result = await generateCopy(baseInput, deps)

    expect(result.primaryText).toBe(stillBad.primaryText)
    expect(result.headline).toBe(violatingWinner.headline)
    expect(captures).toHaveLength(1)
    const captured = captures[0]
    if (!captured) throw new Error("captured undefined")
    expect(captured.violations.length).toBeGreaterThan(0)
  })
})
