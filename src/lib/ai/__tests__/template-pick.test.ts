/**
 * Snapshot + fixture tests for template-pick.ts (§8).
 *
 * LLM calls mocked via MockLanguageModelV3 from ai/test — injected via the
 * optional `model` parameter on `pickTemplate`.
 *
 * Tests:
 *   1. Discriminating-token snapshot: system prompt must contain vocab tokens
 *      from templates/{1,2,3}.json — the §8 snapshot contract.
 *   2. Prompt builder: free-text fields wrapped with wrapUntrusted per §5.
 *   3. Fixture size guard: 30 rows, 10 per template.
 *   4. Fixture-driven: mock returns expected templateId, assert function matches.
 *   5. Error fallback: mock throws → function returns 1 (Clean Classic).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"
import type { TemplatePickInput } from "@/lib/ai/schemas.ts"
import { TemplatePickInputSchema } from "@/lib/ai/schemas.ts"
import type { TemplateId as TemplateIdT } from "@/lib/ai/taxonomies.ts"
import { TemplateId } from "@/lib/ai/taxonomies.ts"
import {
  buildTemplatePickPrompt,
  pickTemplate,
  TEMPLATE_PICK_SYSTEM_PROMPT,
} from "@/lib/ai/template-pick.ts"
import { loadTemplate } from "@/lib/shopify/templates"

// ─── Fixture loader ───────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures")

const FixtureFileSchema = z.object({
  version: z.number(),
  rows: z.array(
    z.object({
      input: TemplatePickInputSchema,
      expectedTemplateId: TemplateId,
    }),
  ),
})

const fixtureFile = FixtureFileSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES_DIR, "template-pick.json"), "utf-8")),
)

// Source of truth: the actual rendered templates built in `blocks.ts` /
// `templates/index.ts`. Tests assert the system prompt mentions tokens that
// genuinely appear in the rendered HTML, so prompt drift surfaces immediately.
const t1 = loadTemplate(1)
const t2 = loadTemplate(2)
const t3 = loadTemplate(3)

// ─── Mock builder ─────────────────────────────────────────────────────────────

/**
 * Build a minimal `LanguageModelV3GenerateResult` for the mock.
 * Uses the full SDK type to satisfy the strict TypeScript checker.
 */
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

/**
 * Build a MockLanguageModelV3 that responds with a valid JSON payload
 * containing the given templateId. `Output.object` parses model text output
 * as JSON, so we return `{ type: "text", text: ... }` content.
 *
 * `finishReason` must be the V3 object form `{ unified, raw }` — not a plain
 * string. The SDK accesses `result.finishReason.unified` internally.
 *
 * `supportedUrls` is set to accept all image/* URLs so the SDK does NOT
 * attempt to download test fixture hero image URLs via HTTP.
 */
function buildMockModel(templateId: TemplateIdT): MockLanguageModelV3 {
  const jsonPayload = JSON.stringify({ templateId })
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => buildGenerateResult(jsonPayload),
  })
}

/**
 * Build a MockLanguageModelV3 that always throws — tests the error fallback path.
 * `supportedUrls` matches all images so the throw happens inside `doGenerate`,
 * not during image download.
 */
function buildThrowingModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => {
      throw new Error("simulated LLM failure")
    },
  })
}

// ─── Fixture size guard ───────────────────────────────────────────────────────

describe("template-pick fixture", () => {
  test("has exactly 30 rows", () => {
    expect(fixtureFile.rows).toHaveLength(30)
  })

  test("has 10 rows expecting templateId 1", () => {
    expect(fixtureFile.rows.filter((r) => r.expectedTemplateId === 1)).toHaveLength(10)
  })

  test("has 10 rows expecting templateId 2", () => {
    expect(fixtureFile.rows.filter((r) => r.expectedTemplateId === 2)).toHaveLength(10)
  })

  test("has 10 rows expecting templateId 3", () => {
    expect(fixtureFile.rows.filter((r) => r.expectedTemplateId === 3)).toHaveLength(10)
  })
})

// ─── §8 Snapshot: discriminating-token contract ───────────────────────────────

describe("system prompt discriminating-token snapshot (§8 contract)", () => {
  // ── Template 1 — Clean Classic ─────────────────────────────────────────────
  test("contains 'Clean Classic' (Template 1 name)", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Clean Classic")
  })

  test("contains 'clean' token (Template 1 design descriptor)", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT.toLowerCase()).toContain("clean")
  })

  test("contains 'classic' token (Template 1 design descriptor)", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT.toLowerCase()).toContain("classic")
  })

  test("contains 'Calidad garantizada' — Template 1 subheading", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Calidad garantizada")
  })

  test("contains 'Pedido contra entrega' — Template 1 form heading from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Pedido contra entrega")
  })

  // ── Template 2 — Urgency / Sales ───────────────────────────────────────────
  test("contains 'Urgency' — from Template 2 name", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Urgency")
  })

  test("contains 'Sales' — from Template 2 name", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Sales")
  })

  test("contains 'OFERTA LIMITADA' — Template 2 hero heading prefix from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("OFERTA LIMITADA")
  })

  test("contains 'solo hoy' — Template 2 subheading", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("solo hoy")
  })

  test("contains 'máximo ahorro' — Template 2 third-tier label from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("máximo ahorro")
  })

  // ── Template 3 — Lifestyle ─────────────────────────────────────────────────
  test("contains 'Lifestyle' — Template 3 name", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Lifestyle")
  })

  test("contains 'warm' — Template 3 visual mood descriptor", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("warm")
  })

  test("contains 'estilo de vida' — Template 3 subheading", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("estilo de vida")
  })

  test("contains 'Para mí' — Template 3 bundle label from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Para mí")
  })

  test("contains 'Para regalar' — Template 3 bundle label from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Para regalar")
  })

  test("contains 'Quiero el mío' — Template 3 CTA button text from blocks.ts", () => {
    expect(TEMPLATE_PICK_SYSTEM_PROMPT).toContain("Quiero el mío")
  })

  test("t1.name contains 'Clean' and 'Classic'", () => {
    expect(t1.name).toContain("Clean")
    expect(t1.name).toContain("Classic")
  })

  test("t2.name contains 'Urgency' and 'Sales'", () => {
    expect(t2.name).toContain("Urgency")
    expect(t2.name).toContain("Sales")
  })

  test("t3.name contains 'Lifestyle'", () => {
    expect(t3.name).toContain("Lifestyle")
  })
})

// ─── SSOT contract: every prompt-cited token actually exists in blocks.ts ────

describe("rendered templates contain prompt tokens (SSOT contract)", () => {
  // Walk every string leaf in the section JSON tree (works whether the
  // section is `custom-liquid` or a Dawn-stock section with nested blocks).
  function rendered(t: typeof t1): string {
    return JSON.stringify(t.sections)
  }

  test("Template 1 rendered HTML contains 'Pedido contra entrega'", () => {
    expect(rendered(t1)).toContain("Pedido contra entrega")
  })

  test("Template 2 rendered HTML contains 'OFERTA LIMITADA'", () => {
    expect(rendered(t2)).toContain("OFERTA LIMITADA")
  })

  test("Template 2 rendered HTML contains 'máximo ahorro'", () => {
    expect(rendered(t2)).toContain("máximo ahorro")
  })

  test("Template 3 rendered HTML contains 'Para mí'", () => {
    expect(rendered(t3)).toContain("Para mí")
  })

  test("Template 3 rendered HTML contains 'Para regalar'", () => {
    expect(rendered(t3)).toContain("Para regalar")
  })

  test("Template 3 rendered HTML contains 'Quiero el mío'", () => {
    expect(rendered(t3)).toContain("Quiero el mío")
  })
})

// ─── Prompt builder: wrapUntrusted applied to free-text fields ────────────────

describe("buildTemplatePickPrompt", () => {
  const sampleInput: TemplatePickInput = {
    name: "Organizador de cocina",
    category: "kitchen",
    description: "Un organizador muy útil.",
    priceText: "S/ 59.90",
    heroImageUrl: "https://example.com/img.jpg",
  }

  test("wraps name in UNTRUSTED tags", () => {
    const prompt = buildTemplatePickPrompt(sampleInput)
    expect(prompt).toContain("<UNTRUSTED>Organizador de cocina</UNTRUSTED>")
  })

  test("wraps description in UNTRUSTED tags", () => {
    const prompt = buildTemplatePickPrompt(sampleInput)
    expect(prompt).toContain("<UNTRUSTED>Un organizador muy útil.</UNTRUSTED>")
  })

  test("includes category verbatim (not wrapped — not free-text)", () => {
    const prompt = buildTemplatePickPrompt(sampleInput)
    expect(prompt).toContain("kitchen")
  })

  test("includes priceText verbatim", () => {
    const prompt = buildTemplatePickPrompt(sampleInput)
    expect(prompt).toContain("S/ 59.90")
  })
})

// ─── Fixture-driven tests ─────────────────────────────────────────────────────

describe("pickTemplate — fixture-driven (mocked LLM)", () => {
  test("returns templateId 1 when LLM responds with 1", async () => {
    const model = buildMockModel(1)
    const input = fixtureFile.rows.find((r) => r.expectedTemplateId === 1)?.input
    if (!input) throw new Error("no fixture with expectedTemplateId=1")
    const result = await pickTemplate(input, model)
    expect(result).toBe(1)
  })

  test("returns templateId 2 when LLM responds with 2", async () => {
    const model = buildMockModel(2)
    const input = fixtureFile.rows.find((r) => r.expectedTemplateId === 2)?.input
    if (!input) throw new Error("no fixture with expectedTemplateId=2")
    const result = await pickTemplate(input, model)
    expect(result).toBe(2)
  })

  test("returns templateId 3 when LLM responds with 3", async () => {
    const model = buildMockModel(3)
    const input = fixtureFile.rows.find((r) => r.expectedTemplateId === 3)?.input
    if (!input) throw new Error("no fixture with expectedTemplateId=3")
    const result = await pickTemplate(input, model)
    expect(result).toBe(3)
  })
})

// ─── Error fallback ───────────────────────────────────────────────────────────

describe("pickTemplate — error fallback", () => {
  test("returns 1 (Clean Classic) when LLM throws on both primary and bumped", async () => {
    const model = buildThrowingModel()
    const input: TemplatePickInput = {
      name: "Test Product",
      category: "kitchen",
      description: "A test product.",
      priceText: "S/ 99.00",
      heroImageUrl: "https://example.com/test.jpg",
    }
    const result = await pickTemplate(input, model)
    expect(result).toBe(1)
  })
})

// ─── §1.4 Bumped-tier model escalation ───────────────────────────────────────

describe("bumped-tier model escalation (§1.4)", () => {
  const escalationInput: TemplatePickInput = {
    name: "Gadget de Cocina",
    category: "kitchen",
    description: "Un gadget práctico.",
    priceText: "S/ 79.90",
    heroImageUrl: "https://example.com/gadget.jpg",
  }

  test("primary succeeds — only model is called, bumpedModel is not called", async () => {
    const model = buildMockModel(2)
    const bumpedModel = buildMockModel(3)
    await pickTemplate(escalationInput, model, bumpedModel)
    expect(model.doGenerateCalls.length).toBe(1)
    expect(bumpedModel.doGenerateCalls.length).toBe(0)
  })

  test("primary fails validation — model called once, bumpedModel called once, returns bumped result", async () => {
    // Return invalid JSON so schema validation fails → triggers bumped tier.
    const invalidModel = new MockLanguageModelV3({
      supportedUrls: { "image/*": [/.*/] },
      doGenerate: async () => buildGenerateResult(JSON.stringify({ templateId: 99 })),
    })
    const bumpedModel = buildMockModel(2)
    const result = await pickTemplate(escalationInput, invalidModel, bumpedModel)
    expect(invalidModel.doGenerateCalls.length).toBe(1)
    expect(bumpedModel.doGenerateCalls.length).toBe(1)
    expect(result).toBe(2)
  })
})
