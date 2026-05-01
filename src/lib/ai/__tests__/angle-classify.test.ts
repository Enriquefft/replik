/**
 * Snapshot tests for classifyAngle — §12 self-consistency aggregation.
 *
 * LLM calls are mocked via MockLanguageModelV3 from `ai/test`. Each test
 * configures 5 parallel mock responses and asserts the aggregation result.
 *
 * Fixture: src/lib/ai/fixtures/sales-angles.json (50 rows, Phase 1 lock-gate).
 */

import { describe, expect, test } from "bun:test"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"

import { classifyAngle } from "@/lib/ai/angle-classify.ts"
import fixtureData from "@/lib/ai/fixtures/sales-angles.json"
import { SalesAngle } from "@/lib/ai/taxonomies.ts"

type SalesAngleT = z.infer<typeof SalesAngle>

const FixtureSchema = z.object({
  rows: z.array(
    z.object({
      creativeId: z.string(),
      transcript: z.string(),
      language: z.string(),
      angle: SalesAngle.nullable(),
    }),
  ),
})

const FIXTURE_ROWS = FixtureSchema.parse(fixtureData).rows

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal LanguageModelV3GenerateResult that contains a JSON text block.
 * This is the shape generateObject parses.
 */
function makeGenerateResult(object: unknown): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(object) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  }
}

type ClassificationEntry = { creativeId: string; angle: SalesAngleT | null }

function makeClassification(entries: ClassificationEntry[]): { angles: ClassificationEntry[] } {
  return { angles: entries }
}

/**
 * Create a mock model factory that rotates through the given 5 results
 * (one per call index). Each call to the factory returns a fresh
 * MockLanguageModelV3 that will return the next result.
 */
function makeModelFactory(
  results: [unknown, unknown, unknown, unknown, unknown],
): () => LanguageModelV3 {
  let callCount = 0
  return () => {
    const idx = callCount++
    const responseObject = results[idx] ?? results[4]
    return new MockLanguageModelV3({
      doGenerate: async () => makeGenerateResult(responseObject),
    })
  }
}

function makeFailingModelFactory(): () => LanguageModelV3 {
  return () =>
    new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("mock LLM failure")
      },
    })
}

function makeMixedModelFactory(results: Array<unknown | "FAIL">): () => LanguageModelV3 {
  let callCount = 0
  return () => {
    const idx = callCount++
    const result = results[idx] ?? "FAIL"
    if (result === "FAIL") {
      return new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("mock LLM failure")
        },
      })
    }
    return new MockLanguageModelV3({
      doGenerate: async () => makeGenerateResult(result),
    })
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("classifyAngle — skip rule", () => {
  test("transcript shorter than 15 chars → angle: null, no LLM call", async () => {
    let llmCalled = false
    const modelFactory: () => LanguageModelV3 = () => {
      llmCalled = true
      return new MockLanguageModelV3({
        doGenerate: async () => makeGenerateResult({ angles: [] }),
      })
    }

    const result = await classifyAngle(
      {
        creatives: [
          { id: "c1", transcript: "short", language: "es" },
          { id: "c2", transcript: "also short!", language: "es" },
          { id: "c3", transcript: "", language: "es" },
          { id: "c4", transcript: "   trim spaces   ".slice(0, 10), language: "es" },
        ],
      },
      modelFactory,
    )

    expect(llmCalled).toBe(false)
    expect(result.angles).toHaveLength(4)
    for (const entry of result.angles) {
      expect(entry.angle).toBeNull()
    }
  })

  test("transcript exactly at 15 chars → LLM is called", async () => {
    let llmCalled = false
    const id = "c-exactly-15"
    const transcript = "a".repeat(15)

    const modelFactory: () => LanguageModelV3 = () => {
      llmCalled = true
      return new MockLanguageModelV3({
        doGenerate: async () =>
          makeGenerateResult(makeClassification([{ creativeId: id, angle: "precio" }])),
      })
    }

    await classifyAngle({ creatives: [{ id, transcript, language: "es" }] }, modelFactory)

    expect(llmCalled).toBe(true)
  })
})

describe("classifyAngle — majority vote", () => {
  test("4 of 5 agree → ship majority angle", async () => {
    const id = "c1"
    const majority: SalesAngleT = "precio"
    const minority: SalesAngleT = "urgencia"

    const responses: [unknown, unknown, unknown, unknown, unknown] = [
      makeClassification([{ creativeId: id, angle: majority }]),
      makeClassification([{ creativeId: id, angle: majority }]),
      makeClassification([{ creativeId: id, angle: majority }]),
      makeClassification([{ creativeId: id, angle: majority }]),
      makeClassification([{ creativeId: id, angle: minority }]),
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript: "valid transcript that is long enough", language: "es" }] },
      makeModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(majority)
  })

  test("5 of 5 agree → ship that angle", async () => {
    const id = "c1"
    const angle: SalesAngleT = "testimonio"

    const one = makeClassification([{ creativeId: id, angle }])
    const responses: [unknown, unknown, unknown, unknown, unknown] = [one, one, one, one, one]

    const result = await classifyAngle(
      {
        creatives: [
          { id, transcript: "este es un transcript suficientemente largo", language: "es" },
        ],
      },
      makeModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(angle)
  })
})

describe("classifyAngle — ≥2 agree (no clear majority)", () => {
  test("[a, a, b, c, d] → ship a (2 votes, others have 1)", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar"
    const a: SalesAngleT = "dolor"
    const responses: [unknown, unknown, unknown, unknown, unknown] = [
      makeClassification([{ creativeId: id, angle: a }]),
      makeClassification([{ creativeId: id, angle: a }]),
      makeClassification([{ creativeId: id, angle: "urgencia" }]),
      makeClassification([{ creativeId: id, angle: "regalo" }]),
      makeClassification([{ creativeId: id, angle: "comparacion" }]),
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(a)
  })
})

describe("classifyAngle — tie-break", () => {
  test("2-2-1 split → ship first call's pick (deterministic)", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"
    const firstPick: SalesAngleT = "precio"
    const secondPick: SalesAngleT = "demostracion"

    const responses: [unknown, unknown, unknown, unknown, unknown] = [
      makeClassification([{ creativeId: id, angle: firstPick }]),
      makeClassification([{ creativeId: id, angle: secondPick }]),
      makeClassification([{ creativeId: id, angle: firstPick }]),
      makeClassification([{ creativeId: id, angle: secondPick }]),
      makeClassification([{ creativeId: id, angle: "aspiracional" }]),
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(firstPick)
  })
})

describe("classifyAngle — all different", () => {
  test("5 unique values → null", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"
    const responses: [unknown, unknown, unknown, unknown, unknown] = [
      makeClassification([{ creativeId: id, angle: "precio" }]),
      makeClassification([{ creativeId: id, angle: "demostracion" }]),
      makeClassification([{ creativeId: id, angle: "testimonio" }]),
      makeClassification([{ creativeId: id, angle: "urgencia" }]),
      makeClassification([{ creativeId: id, angle: "dolor" }]),
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBeNull()
  })
})

describe("classifyAngle — all failed", () => {
  test("all 5 calls throw → angle: null", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeFailingModelFactory(),
    )

    expect(result.angles[0]?.angle).toBeNull()
  })
})

describe("classifyAngle — partial failures", () => {
  test("1 of 5 fails → vote on surviving 4 (4-0 dominant wins)", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"
    const angle: SalesAngleT = "regalo"

    const responses: Array<unknown | "FAIL"> = [
      makeClassification([{ creativeId: id, angle }]),
      makeClassification([{ creativeId: id, angle }]),
      makeClassification([{ creativeId: id, angle }]),
      makeClassification([{ creativeId: id, angle }]),
      "FAIL",
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeMixedModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(angle)
  })

  test("3 fail, 2 succeed with same angle → ≥2 agree rule ships it", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"
    const angle: SalesAngleT = "aspiracional"

    const responses: Array<unknown | "FAIL"> = [
      makeClassification([{ creativeId: id, angle }]),
      makeClassification([{ creativeId: id, angle }]),
      "FAIL",
      "FAIL",
      "FAIL",
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeMixedModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBe(angle)
  })

  test("4 fail, 1 survives → only 1 vote (max 1) → null (all-different rule)", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar angle"
    const angle: SalesAngleT = "comparacion"

    const responses: Array<unknown | "FAIL"> = [
      makeClassification([{ creativeId: id, angle }]),
      "FAIL",
      "FAIL",
      "FAIL",
      "FAIL",
    ]

    const result = await classifyAngle(
      { creatives: [{ id, transcript, language: "es" }] },
      makeMixedModelFactory(responses),
    )

    expect(result.angles[0]?.angle).toBeNull()
  })
})

describe("classifyAngle — fixture ground truth", () => {
  test("first 3 fixture precio rows → mock returns precio → ships precio", async () => {
    const precioRows = FIXTURE_ROWS.filter((r) => r.angle === "precio").slice(0, 3)
    expect(precioRows.length).toBeGreaterThan(0)

    const inputs = precioRows.map((r) => ({
      id: r.creativeId,
      transcript: r.transcript,
      language: r.language,
    }))

    const responseEntries: ClassificationEntry[] = precioRows.map((r) => ({
      creativeId: r.creativeId,
      angle: r.angle,
    }))
    const one = makeClassification(responseEntries)
    const factory = makeModelFactory([one, one, one, one, one])

    const result = await classifyAngle({ creatives: inputs }, factory)

    for (const row of precioRows) {
      const entry = result.angles.find((a) => a.creativeId === row.creativeId)
      expect(entry?.angle).toBe(row.angle)
    }
  })

  test("fixture null-angle rows → mock returns null → ships null", async () => {
    const nullRows = FIXTURE_ROWS.filter((r) => r.angle === null)
    expect(nullRows.length).toBeGreaterThan(0)

    const inputs = nullRows.map((r) => ({
      id: r.creativeId,
      transcript: r.transcript,
      language: r.language,
    }))

    const nullClassification = makeClassification(
      nullRows.map((r) => ({ creativeId: r.creativeId, angle: null })),
    )
    const factory = makeModelFactory([
      nullClassification,
      nullClassification,
      nullClassification,
      nullClassification,
      nullClassification,
    ])

    const result = await classifyAngle({ creatives: inputs }, factory)

    for (const row of nullRows) {
      const entry = result.angles.find((a) => a.creativeId === row.creativeId)
      expect(entry?.angle).toBeNull()
    }
  })

  test("fixture covers all 8 angles — validates skip rule does not trigger for long transcripts", () => {
    const ANGLES: SalesAngleT[] = [
      "precio",
      "demostracion",
      "testimonio",
      "urgencia",
      "dolor",
      "aspiracional",
      "comparacion",
      "regalo",
    ]
    for (const angle of ANGLES) {
      const rows = FIXTURE_ROWS.filter((r) => r.angle === angle)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.transcript.trim().length).toBeGreaterThanOrEqual(15)
      }
    }
  })
})

describe("classifyAngle — output contract", () => {
  test("output length always equals input length", async () => {
    const id1 = "c1"
    const id2 = "c2"
    const shortTranscript = "hi"
    const longTranscript = "este es un transcript suficientemente largo"

    const one = makeClassification([{ creativeId: id2, angle: "precio" }])
    const factory = makeModelFactory([one, one, one, one, one])

    const result = await classifyAngle(
      {
        creatives: [
          { id: id1, transcript: shortTranscript, language: "es" },
          { id: id2, transcript: longTranscript, language: "es" },
        ],
      },
      factory,
    )

    expect(result.angles).toHaveLength(2)
    expect(result.angles[0]?.creativeId).toBe(id1)
    expect(result.angles[0]?.angle).toBeNull()
    expect(result.angles[1]?.creativeId).toBe(id2)
    expect(result.angles[1]?.angle).toBe("precio")
  })

  test("no magic-string sentinels in output — only null for missing angle", async () => {
    const id = "c1"
    const factory = makeFailingModelFactory()

    const result = await classifyAngle(
      {
        creatives: [
          { id, transcript: "este es un transcript suficientemente largo", language: "es" },
        ],
      },
      factory,
    )

    const angle = result.angles[0]?.angle
    expect(angle).toBeNull()
  })
})

// ─── UNTRUSTED wrapping (§3 prompt-injection hardening) ───────────────────────

describe("classifyAngle — UNTRUSTED wrapping", () => {
  test("prompt sent to LLM contains <UNTRUSTED> around transcript", async () => {
    const id = "c1"
    const transcript = "este es un transcript suficientemente largo para clasificar"
    let capturedPrompt: LanguageModelV3CallOptions["prompt"] | undefined

    const modelFactory: () => LanguageModelV3 = () =>
      new MockLanguageModelV3({
        doGenerate: async (options: LanguageModelV3CallOptions) => {
          capturedPrompt = options.prompt
          return makeGenerateResult(makeClassification([{ creativeId: id, angle: "precio" }]))
        },
      })

    await classifyAngle({ creatives: [{ id, transcript, language: "es" }] }, modelFactory)

    expect(capturedPrompt).toBeDefined()
    const promptText = JSON.stringify(capturedPrompt)
    expect(promptText).toContain("<UNTRUSTED>")
    expect(promptText).toContain("</UNTRUSTED>")
    expect(promptText).toContain(transcript)
  })

  test("UNTRUSTED tags wrap transcript value, not other fields", async () => {
    const id = "c1"
    const transcript = "producto increible con resultados visibles"
    let capturedPrompt: LanguageModelV3CallOptions["prompt"] | undefined

    const modelFactory: () => LanguageModelV3 = () =>
      new MockLanguageModelV3({
        doGenerate: async (options: LanguageModelV3CallOptions) => {
          capturedPrompt = options.prompt
          return makeGenerateResult(makeClassification([{ creativeId: id, angle: "demostracion" }]))
        },
      })

    await classifyAngle({ creatives: [{ id, transcript, language: "es" }] }, modelFactory)

    expect(capturedPrompt).toBeDefined()
    const promptText = JSON.stringify(capturedPrompt)
    // The transcript is wrapped
    expect(promptText).toContain(`<UNTRUSTED>${transcript}</UNTRUSTED>`)
    // The creativeId is NOT wrapped
    expect(promptText).not.toContain(`<UNTRUSTED>${id}</UNTRUSTED>`)
  })
})
