/**
 * Tests for `generateLandingBody` (Fix 5).
 *
 * Single-pass generator. We mock the Anthropic call via MockLanguageModelV3
 * and assert:
 *   1. Happy path → returns the parsed LandingBody verbatim.
 *   2. Schema violation (wrong array count) → throws on retry exhaustion.
 *   3. Post-check violation (META_POLICY hit) → throws on retry exhaustion.
 */

import { describe, expect, test } from "bun:test"

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { generateLandingBody } from "@/lib/ai/landing-body.ts"
import type { LandingBody, LandingBodyInput } from "@/lib/ai/landing-body-schema.ts"

// ─── Mock helpers ────────────────────────────────────────────────────────────

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

function buildMockModel(payload: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => buildGenerateResult(JSON.stringify(payload)),
  })
}

/**
 * Mock that returns `firstPayload` on the first call and `secondPayload` on
 * subsequent calls. Used to simulate a successful critique retry.
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseInput: LandingBodyInput = {
  product: {
    id: "11111111-1111-4111-8111-000000000001",
    userId: "11111111-1111-4111-8111-000000000065",
    sourceUrl: "https://shop.example.com/p/1",
    name: "Set de ollas antiadherentes",
    imageUrls: ["https://cdn.example.com/x.jpg"],
    brand: null,
    canonicalBrand: null,
    category: "kitchen",
    pricingCents: 4500,
    bundle2PricingCents: 8000,
    bundle3PricingCents: 11300,
    brandTokens: [],
    keywords: [],
    status: "READY",
    shopifyProductId: null,
    shopifyPageHandle: "set-ollas",
    shopifyTemplateId: 1,
    description: "Set de tres ollas antiadherentes con tapa de vidrio.",
    scrapeReason: null,
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
  },
  creatives: [
    {
      id: "11111111-1111-4111-8111-0000000000d2",
      angle: "precio",
      transcript: "Hola, mira el set de ollas, dura años y no se pega.",
      language: "es",
    },
  ],
}

type Benefit = LandingBody["benefits"][number]

const benefit1: Benefit = {
  title: "No se pega",
  body: "Cocina con menos aceite y limpia rápido al final.",
}
const benefit2: Benefit = {
  title: "Tres tamaños",
  body: "Una para arroz, una para guiso, una para sopa.",
}
const benefit3: Benefit = {
  title: "Tapa de vidrio",
  body: "Mira la cocción sin destapar y sin perder calor.",
}

const validBody: LandingBody = {
  benefits: [benefit1, benefit2, benefit3],
  faq: [
    {
      q: "¿Sirve para cocina a gas e inducción?",
      a: "Sí, funciona en gas, inducción, eléctrica y vitrocerámica.",
    },
    {
      q: "¿Cómo se paga?",
      a: "Pago contra entrega. Recibes el set y pagas al delivery, sin adelantos.",
    },
    {
      q: "¿En cuánto tiempo llega?",
      a: "Llega entre 2 y 4 días hábiles, según tu ciudad.",
    },
  ],
  objections: [
    "Si no estás satisfecho, te devolvemos el dinero al recibir el producto en buen estado.",
    "Pagas solo cuando lo recibes, sin adelantar nada por internet.",
  ],
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generateLandingBody", () => {
  test("happy path → returns parsed LandingBody", async () => {
    const model = buildMockModel(validBody)
    const result = await generateLandingBody(baseInput, {
      primaryModel: model,
      bumpedModel: model,
    })
    expect(result).toEqual(validBody)
  })

  test("schema violation (wrong benefits count) → primary fails, bumped recovers", async () => {
    // Send a payload with only 2 benefits to trigger LandingBodySchema.length(3).
    const wrongCount = {
      ...validBody,
      benefits: [benefit1, benefit2],
    }

    const primary = buildMockModel(wrongCount)
    const bumped = buildMockModel(validBody)
    const result = await generateLandingBody(baseInput, {
      primaryModel: primary,
      bumpedModel: bumped,
    })
    expect(result).toEqual(validBody)
  })

  test("post-check violation (META_POLICY) on primary → bumped recovers", async () => {
    const policyViolation: LandingBody = {
      ...validBody,
      benefits: [
        { title: "Antes y después", body: "Mira el antes y después en cada uso, sin excepciones." },
        benefit2,
        benefit3,
      ],
    }
    const primary = buildMockModel(policyViolation)
    const bumped = buildMockModel(validBody)
    const result = await generateLandingBody(baseInput, {
      primaryModel: primary,
      bumpedModel: bumped,
    })
    expect(result).toEqual(validBody)
  })

  test("both primary + bumped invalid → throws", async () => {
    const policyViolation: LandingBody = {
      ...validBody,
      benefits: [
        { title: "Antes y después", body: "Mira el antes y después en cada uso, sin excepciones." },
        benefit2,
        benefit3,
      ],
    }
    const model = buildSwitchingModel(policyViolation, policyViolation)
    expect(
      generateLandingBody(baseInput, {
        primaryModel: model,
        bumpedModel: model,
      }),
    ).rejects.toThrow(/landing-body generator failed/)
  })
})
