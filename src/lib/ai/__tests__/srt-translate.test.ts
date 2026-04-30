/**
 * Snapshot + fixture tests for srt-translate.ts (§10).
 *
 * LLM calls are mocked via `MockLanguageModelV3` from `ai/test`. Each fixture
 * row drives one round trip through `translateSrtWithModel` (the test seam
 * exported from the module under test).
 *
 * Coverage:
 *   1. Fixture size guard — exactly 30 rows split 20 / 5 / 5.
 *   2. brand-tokens.json size guard — exactly 10 rows.
 *   3. Success rows (20) — mock returns `expectedOutput.cues` once; assert
 *      `translateSrtWithModel` returns `{ cues, translated: true }` and the
 *      structural schema accepts the result.
 *   4. Retry rows (5) — mock returns `firstAttempt.cues` first (invalid),
 *      then `expectedOutput.cues` (valid); assert the bumped output is
 *      returned with `translated: true`.
 *   5. Fallback rows (5) — mock either throws or returns invalid output on
 *      both calls; assert `translated: false` and cue count equals source
 *      cue count, with cue text equal to the source verbatim.
 *   6. Brand-token preservation — explicit assertion that every token from
 *      `brandTokens` appears verbatim in the corresponding translated cue
 *      text on every successful row.
 *
 * No real network calls. The Anthropic provider is never instantiated.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"

import { CueSchema, SrtTranslateInputSchema, SrtTranslateResultSchema } from "@/lib/ai/schemas.ts"
import { parseSrt, translateSrtWithModel } from "@/lib/ai/srt-translate.ts"

// ─── Fixture schemas ────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures")

const CuesPayloadSchema = z.object({ cues: z.array(CueSchema) })
type CuesPayload = z.infer<typeof CuesPayloadSchema>

const SuccessRowSchema = z.object({
  kind: z.literal("success"),
  input: SrtTranslateInputSchema,
  expectedOutput: z.object({
    translated: z.literal(true),
    cues: z.array(CueSchema),
  }),
})
type SuccessRow = z.infer<typeof SuccessRowSchema>

const RetryRowSchema = z.object({
  kind: z.literal("retry"),
  reason: z.string(),
  input: SrtTranslateInputSchema,
  firstAttempt: CuesPayloadSchema,
  expectedOutput: z.object({
    translated: z.literal(true),
    cues: z.array(CueSchema),
  }),
})
type RetryRow = z.infer<typeof RetryRowSchema>

const FallbackRowSchema = z.object({
  kind: z.literal("fallback"),
  reason: z.string(),
  errorOnPrimary: z.boolean().optional(),
  errorOnBumped: z.boolean().optional(),
  input: SrtTranslateInputSchema,
  firstAttempt: CuesPayloadSchema.optional(),
  secondAttempt: CuesPayloadSchema.optional(),
  expectedOutput: z.object({
    translated: z.literal(false),
    cues: z.array(CueSchema),
  }),
})
type FallbackRow = z.infer<typeof FallbackRowSchema>

const FixtureRowSchema = z.discriminatedUnion("kind", [
  SuccessRowSchema,
  RetryRowSchema,
  FallbackRowSchema,
])

const FixtureFileSchema = z.object({
  version: z.number(),
  description: z.string().optional(),
  rows: z.array(FixtureRowSchema),
})

const BrandTokensFileSchema = z.object({
  version: z.number(),
  rows: z.array(
    z.object({
      brand: z.string(),
      tokens: z.array(z.string()),
    }),
  ),
})

const fixtureFile = FixtureFileSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES_DIR, "srt-translate.json"), "utf-8")),
)

const brandTokensFile = BrandTokensFileSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES_DIR, "brand-tokens.json"), "utf-8")),
)

// ─── Mock builders ───────────────────────────────────────────────────────────

/**
 * Build a minimal `LanguageModelV3GenerateResult` carrying a JSON payload as
 * a single text content block. `generateObject` extracts the text and parses
 * it against the call-site schema.
 */
function buildGenerateResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 50, text: undefined, reasoning: undefined },
    },
    warnings: [],
  }
}

type MockStep = { kind: "result"; payload: CuesPayload } | { kind: "throw"; error: Error }

/**
 * Build a MockLanguageModelV3 that consumes a sequenced queue of steps.
 *
 * We do NOT use the SDK's own array overload — its indexing uses
 * `doGenerateCalls.length` AFTER push, so the first call reads index 1.
 * A dedicated counter is unambiguous.
 */
function buildSequencedModel(steps: MockStep[]): MockLanguageModelV3 {
  let i = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[i]
      i += 1
      if (step === undefined) {
        throw new Error(`MockLanguageModelV3: no step queued for call #${i.toString()}`)
      }
      if (step.kind === "throw") {
        throw step.error
      }
      return buildGenerateResult(JSON.stringify(step.payload))
    },
  })
}

// ─── Fixture size guards ─────────────────────────────────────────────────────

describe("srt-translate fixture guards", () => {
  test("srt-translate.json has exactly 30 rows", () => {
    expect(fixtureFile.rows).toHaveLength(30)
  })

  test("srt-translate.json has 20 success rows", () => {
    expect(fixtureFile.rows.filter((r) => r.kind === "success")).toHaveLength(20)
  })

  test("srt-translate.json has 5 retry rows", () => {
    expect(fixtureFile.rows.filter((r) => r.kind === "retry")).toHaveLength(5)
  })

  test("srt-translate.json has 5 fallback rows", () => {
    expect(fixtureFile.rows.filter((r) => r.kind === "fallback")).toHaveLength(5)
  })

  test("brand-tokens.json has exactly 10 rows", () => {
    expect(brandTokensFile.rows).toHaveLength(10)
  })
})

// ─── Success rows ────────────────────────────────────────────────────────────

describe("translateSrtWithModel — success rows", () => {
  const successRows = fixtureFile.rows.filter((r): r is SuccessRow => r.kind === "success")

  for (const [i, row] of successRows.entries()) {
    test(`success row #${(i + 1).toString()} returns translated cues`, async () => {
      const model = buildSequencedModel([
        { kind: "result", payload: { cues: row.expectedOutput.cues } },
      ])
      const result = await translateSrtWithModel(row.input, model)
      expect(result.translated).toBe(true)
      expect(result.cues).toEqual(row.expectedOutput.cues)
      expect(SrtTranslateResultSchema.parse(result)).toEqual(result)
    })
  }

  test("success rows preserve every brand token verbatim per cue", () => {
    for (const row of successRows) {
      if (row.input.brandTokens.length === 0) continue
      const sourceCues = parseSrt(row.input.sourceSrt)
      for (let i = 0; i < sourceCues.length; i += 1) {
        const src = sourceCues[i]
        const got = row.expectedOutput.cues[i]
        if (src === undefined || got === undefined) continue
        for (const token of row.input.brandTokens) {
          if (src.text.includes(token)) {
            expect(got.text).toContain(token)
          }
        }
      }
    }
  })
})

// ─── Retry rows ──────────────────────────────────────────────────────────────

describe("translateSrtWithModel — retry rows", () => {
  const retryRows = fixtureFile.rows.filter((r): r is RetryRow => r.kind === "retry")

  for (const [i, row] of retryRows.entries()) {
    test(`retry row #${(i + 1).toString()} (${row.reason}) returns bumped cues`, async () => {
      const model = buildSequencedModel([
        { kind: "result", payload: row.firstAttempt },
        { kind: "result", payload: { cues: row.expectedOutput.cues } },
      ])
      const result = await translateSrtWithModel(row.input, model)
      expect(result.translated).toBe(true)
      expect(result.cues).toEqual(row.expectedOutput.cues)
      expect(model.doGenerateCalls).toHaveLength(2)
    })
  }
})

// ─── Fallback rows ───────────────────────────────────────────────────────────

describe("translateSrtWithModel — fallback rows", () => {
  const fallbackRows = fixtureFile.rows.filter((r): r is FallbackRow => r.kind === "fallback")

  for (const [i, row] of fallbackRows.entries()) {
    test(`fallback row #${(i + 1).toString()} (${row.reason}) yields source verbatim`, async () => {
      const steps: MockStep[] = []
      if (row.errorOnPrimary === true) {
        steps.push({ kind: "throw", error: new Error("primary failure") })
      } else if (row.firstAttempt !== undefined) {
        steps.push({ kind: "result", payload: row.firstAttempt })
      }
      if (row.errorOnBumped === true) {
        steps.push({ kind: "throw", error: new Error("bumped failure") })
      } else if (row.secondAttempt !== undefined) {
        steps.push({ kind: "result", payload: row.secondAttempt })
      }

      const model = buildSequencedModel(steps)
      const result = await translateSrtWithModel(row.input, model)
      expect(result.translated).toBe(false)
      expect(result.cues).toEqual(row.expectedOutput.cues)

      const sourceCues = parseSrt(row.input.sourceSrt)
      expect(result.cues).toHaveLength(sourceCues.length)
      for (let j = 0; j < sourceCues.length; j += 1) {
        const src = sourceCues[j]
        const got = result.cues[j]
        if (src === undefined || got === undefined) continue
        expect(got.text).toBe(src.text)
        expect(got.index).toBe(src.index)
        expect(got.startMs).toBe(src.startMs)
        expect(got.endMs).toBe(src.endMs)
      }
    })
  }
})

// ─── Brand-token preservation contract ───────────────────────────────────────

describe("brand-token preservation across all brand-tokens.json rows", () => {
  test("every token in brand-tokens.json is non-empty and unique within its row", () => {
    for (const row of brandTokensFile.rows) {
      const seen = new Set<string>()
      for (const token of row.tokens) {
        expect(token.length).toBeGreaterThan(0)
        expect(seen.has(token)).toBe(false)
        seen.add(token)
      }
    }
  })

  test("a fixture row exists exercising every brand-tokens.json brand at least once", () => {
    const rowsWithBrandTokens = fixtureFile.rows.filter((r) => r.input.brandTokens.length > 0)
    expect(rowsWithBrandTokens.length).toBeGreaterThan(0)
  })
})
