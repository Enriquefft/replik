/**
 * Tests for `pickHeroVideo` (Phase 2 hero-video picker).
 *
 * Mirrors the structure of `template-pick.test.ts` — mock the Anthropic call
 * via `MockLanguageModelV3` and inject through the optional model parameters.
 *
 * Coverage:
 *   1. Happy path: 3 candidates, LLM picks the middle id → returned URL is
 *      the picked candidate's edited video URL.
 *   2. Schema mismatch / unknown id: primary returns an id not in the
 *      candidate set → bumped retry recovers.
 *   3. Both retries fail → fallback returns candidates[0].
 *   4. Empty candidate list → throws synchronously.
 *   5. Prompt builder: free-text product name + transcripts wrapped per §5.
 */

import { describe, expect, test } from "bun:test"

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"

import {
  buildHeroVideoPickPrompt,
  type HeroVideoCandidate,
  type HeroVideoPickInput,
  pickHeroVideo,
  renderCandidateBlock,
} from "@/lib/ai/hero-video-pick.ts"

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function buildGenerateResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: undefined, reasoning: undefined },
    },
    warnings: [],
  }
}

function buildMockModel(payload: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => buildGenerateResult(JSON.stringify(payload)),
  })
}

/**
 * Mock model that always throws — exercises the fallback path on primary.
 */
function buildThrowingModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => {
      throw new Error("simulated LLM failure")
    },
  })
}

/**
 * Mock that returns `firstPayload` on the first call and `secondPayload` on
 * subsequent calls. Used to drive the schema-mismatch → bumped-retry path.
 */
function buildSwitchingModel(firstPayload: unknown, secondPayload: unknown): LanguageModelV3 {
  let calls = 0
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async (_options: LanguageModelV3CallOptions) => {
      calls += 1
      const payload = calls === 1 ? firstPayload : secondPayload
      return buildGenerateResult(JSON.stringify(payload))
    },
  })
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const candidates: HeroVideoCandidate[] = [
  {
    creativeId: "creative-a",
    editedVideoUrl: "https://cdn.example.com/a.mp4",
    transcriptText: "¿Te cansaste de quemarte la mano cocinando?",
    angle: "dolor",
  },
  {
    creativeId: "creative-b",
    editedVideoUrl: "https://cdn.example.com/b.mp4",
    transcriptText: "Mira como esta olla cambia tu cocina en 30 segundos.",
    angle: "demostracion",
  },
  {
    creativeId: "creative-c",
    editedVideoUrl: "https://cdn.example.com/c.mp4",
    transcriptText: "Compré tres y son un regalo perfecto para mamá.",
    angle: "regalo",
  },
]

const baseInput: HeroVideoPickInput = {
  candidates,
  product: {
    name: "Set de ollas antiadherentes",
    category: "kitchen",
  },
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("pickHeroVideo — happy path", () => {
  test("returns the URL of the LLM-picked creative when id is in the candidate set", async () => {
    const model = buildMockModel({ pickedCreativeId: "creative-b" })
    const bumped = buildMockModel({ pickedCreativeId: "creative-b" })
    const result = await pickHeroVideo(baseInput, model, bumped)
    expect(result.pickedCreativeId).toBe("creative-b")
    expect(result.url).toBe("https://cdn.example.com/b.mp4")
  })

  test("primary success means bumped is not called", async () => {
    const primary = buildMockModel({ pickedCreativeId: "creative-a" })
    const bumped = buildMockModel({ pickedCreativeId: "creative-c" })
    await pickHeroVideo(baseInput, primary, bumped)
    expect(primary.doGenerateCalls.length).toBe(1)
    expect(bumped.doGenerateCalls.length).toBe(0)
  })
})

// ─── Schema / unknown-id retry ────────────────────────────────────────────────

describe("pickHeroVideo — schema mismatch", () => {
  test("unknown pickedCreativeId on primary → bumped retry recovers", async () => {
    const model = buildSwitchingModel(
      { pickedCreativeId: "not-in-the-list" },
      { pickedCreativeId: "creative-c" },
    )
    const result = await pickHeroVideo(baseInput, model, model)
    expect(result.pickedCreativeId).toBe("creative-c")
    expect(result.url).toBe("https://cdn.example.com/c.mp4")
  })

  test("malformed JSON shape on primary → bumped retry recovers", async () => {
    const model = buildSwitchingModel({ wrongField: "abc" }, { pickedCreativeId: "creative-a" })
    const result = await pickHeroVideo(baseInput, model, model)
    expect(result.pickedCreativeId).toBe("creative-a")
  })
})

// ─── Fallback ─────────────────────────────────────────────────────────────────

describe("pickHeroVideo — fallback", () => {
  test("LLM throws on primary AND bumped → falls back to candidates[0]", async () => {
    const model = buildThrowingModel()
    const result = await pickHeroVideo(baseInput, model, model)
    expect(result.pickedCreativeId).toBe("creative-a")
    expect(result.url).toBe("https://cdn.example.com/a.mp4")
  })

  test("both retries return invalid ids → falls back to candidates[0]", async () => {
    const invalid = buildMockModel({ pickedCreativeId: "ghost-creative" })
    const result = await pickHeroVideo(baseInput, invalid, invalid)
    expect(result.pickedCreativeId).toBe("creative-a")
  })
})

// ─── Empty candidate list ─────────────────────────────────────────────────────

describe("pickHeroVideo — invariants", () => {
  test("empty candidate list throws", async () => {
    const emptyInput: HeroVideoPickInput = {
      candidates: [],
      product: { name: "x", category: "kitchen" },
    }
    const model = buildMockModel({ pickedCreativeId: "any" })
    expect(pickHeroVideo(emptyInput, model, model)).rejects.toThrow(/candidates list is empty/)
  })
})

// ─── Prompt builder ───────────────────────────────────────────────────────────

describe("buildHeroVideoPickPrompt — wrapping rules", () => {
  test("wraps product name in UNTRUSTED tags", () => {
    const prompt = buildHeroVideoPickPrompt(baseInput)
    expect(prompt).toContain("<UNTRUSTED>Set de ollas antiadherentes</UNTRUSTED>")
  })

  test("includes product category verbatim", () => {
    const prompt = buildHeroVideoPickPrompt(baseInput)
    expect(prompt).toContain("kitchen")
  })

  test("includes a candidate block per input candidate", () => {
    const prompt = buildHeroVideoPickPrompt(baseInput)
    expect(prompt).toContain('<candidate id="creative-a">')
    expect(prompt).toContain('<candidate id="creative-b">')
    expect(prompt).toContain('<candidate id="creative-c">')
  })

  test("renders a single candidate block with angle + wrapped transcript", () => {
    const first = candidates[0]
    if (!first) throw new Error("test fixture: candidates[0] missing")
    const block = renderCandidateBlock(first)
    expect(block).toContain('<candidate id="creative-a">')
    expect(block).toContain("Angle: dolor")
    expect(block).toContain("<UNTRUSTED>¿Te cansaste de quemarte la mano cocinando?</UNTRUSTED>")
  })

  test("renders 'null' angle literal when angle is null", () => {
    const block = renderCandidateBlock({
      creativeId: "x",
      editedVideoUrl: "https://example.com/x.mp4",
      transcriptText: "",
      angle: null,
    })
    expect(block).toContain("Angle: null")
  })
})
