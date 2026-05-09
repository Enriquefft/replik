/**
 * Shopify template picker — §8.
 *
 * Picks the best Replik landing template (1 | 2 | 3) for a product using
 * Sonnet 4.6 with a vision input (hero image). Defaults to templateId = 1
 * (Clean Classic) on any error. Never throws upward.
 */
import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import { generateText, Output } from "ai"

import { wrapUntrusted } from "@/lib/ai/guards.ts"
import { defaultTemperature, MODELS } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import type { TemplatePickInput } from "@/lib/ai/schemas.ts"
import { TemplatePickResultSchema } from "@/lib/ai/schemas.ts"
import type { TemplateId } from "@/lib/ai/taxonomies.ts"
import { withTiming } from "@/lib/observability/log.ts"

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * System prompt prose token-matches templates/blocks.ts per §8 snapshot
 * contract. Discriminating tokens per template:
 *
 * Template 1 — "Clean Classic": clean, classic, minimal, professional,
 *   "Calidad garantizada", "Pedido contra entrega", neutral trust signals.
 *
 * Template 2 — "Urgency / Sales": urgency, sales, "OFERTA LIMITADA", stock,
 *   "solo hoy", scarcity, discount, "máximo ahorro", red accent.
 *
 * Template 3 — "Lifestyle": lifestyle, warm, aspirational, "estilo de vida",
 *   "Para mí", "Para compartir", "Para regalar", emotional, "Quiero el mío",
 *   serif typography, soft gradient.
 */
export const TEMPLATE_PICK_SYSTEM_PROMPT = `You are a CRO expert specializing in COD landing pages for LATAM markets.

Analyze the product hero image together with the product name, category, description, and price. Select the single best Replik landing template from the three options below. Return ONLY the templateId (1, 2, or 3).

---

## Template 1 — Clean Classic
A clean, classic, minimal, and professional layout that builds trust through simplicity.
Subheading tone: "Calidad garantizada. Entrega contra reembolso." — neutral, reassuring.
Pricing labels: "1 unidad", "2 pack", "3 pack" — plain, no urgency language.
Order form heading: "Pedido contra entrega" — calm, institutional.
Best for: household utilities, gadgets, tools, health appliances, kitchen equipment,
fitness accessories with a functional/technical image. Products where professional
credibility and clarity close the sale.

## Template 2 — Urgency / Sales
An urgency-driven, sales-aggressive layout that highlights scarcity and discounts.
Hero heading prefix: "OFERTA LIMITADA:" — all-caps, high-impact, red accent (#c9472f).
Subheading: "Stock limitado — solo hoy con descuento exclusivo." — scarcity signal.
Pricing extras: "máximo ahorro" on the third tier; featured-card badge "Más popular".
Order form subtitle: "Oferta válida solo por hoy" — countdown framing.
CTA button: "¡Quiero mi oferta!" — exclamatory, impulse-driven.
Best for: beauty products, fashion accessories, supplements, impulse purchases, and any
product with a promotional angle. Hero image shows before/after, transformation, or
a heavily styled "sale" visual.

## Template 3 — Lifestyle
A warm, aspirational, lifestyle-oriented layout with emotional connection.
Visual mood: serif typography, soft warm gradient hero background — evokes a slow,
considered, lifestyle feel. Tone descriptor: "warm".
Subheading: "Hecho para tu estilo de vida. Disfrútalo desde el primer día." — lifestyle, warm.
Pricing labels: "Para mí", "Para compartir", "Para regalar" — relational, gift-oriented.
CTA button: "Quiero el mío" — soft desire, personal ownership.
Best for: home décor, gifts, pet products, wellness, aromatherapy, aspirational lifestyle
products. Hero image is warm, soft-lit, emotionally evocative, or shows a happy person/pet.

---

Rules:
- If the hero image is bright, clean, and product-on-white → prefer Template 1.
- If the hero image shows a sale badge, transformation, or aggressive styling → prefer Template 2.
- If the hero image is warm, lifestyle-scene, or gift-wrap styled → prefer Template 3.
- Product name/description/price reinforce but do NOT override the visual signal.
- Respond with ONLY the templateId integer (1, 2, or 3).`

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the user message for the template picker.
 * Free-text fields are wrapped with `wrapUntrusted` per §5.
 */
export function buildTemplatePickPrompt(input: TemplatePickInput): string {
  return [
    `Product name: ${wrapUntrusted(input.name)}`,
    `Category: ${input.category}`,
    `Description: ${wrapUntrusted(input.description)}`,
    `Price: ${input.priceText}`,
    `Select the best template (1, 2, or 3) for this product.`,
  ].join("\n")
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

/**
 * Shared message builder for both primary and critique calls.
 * Returns the initial user turn containing the hero image + text prompt.
 */
function buildUserMessage(input: TemplatePickInput): {
  role: "user"
  content: [{ type: "image"; image: URL }, { type: "text"; text: string }]
} {
  return {
    role: "user",
    content: [
      { type: "image", image: new URL(input.heroImageUrl) },
      { type: "text", text: buildTemplatePickPrompt(input) },
    ],
  }
}

async function callLLM(input: TemplatePickInput, model: LanguageModel): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.json(),
    temperature: defaultTemperature,
    system: TEMPLATE_PICK_SYSTEM_PROMPT,
    messages: [buildUserMessage(input)],
  })
  return result.output
}

async function callLLMWithCritique(
  input: TemplatePickInput,
  critique: string,
  bumpedModel: LanguageModel,
): Promise<unknown> {
  const result = await generateText({
    model: bumpedModel,
    output: Output.json(),
    temperature: defaultTemperature,
    system: TEMPLATE_PICK_SYSTEM_PROMPT,
    messages: [
      buildUserMessage(input),
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "<previous_attempt>Output failed schema validation.</previous_attempt>",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<critique>${critique}</critique>\nPlease retry and return a valid templateId (1, 2, or 3).`,
          },
        ],
      },
    ],
  })
  return result.output
}

// ─── Validate ─────────────────────────────────────────────────────────────────

/**
 * Validate the raw LLM output against `TemplatePickResultSchema`.
 *
 * `Output.json()` (rather than `Output.object({ schema })`) defers Zod
 * validation to this function. This keeps the bumped-tier retry path
 * reachable when the primary call returns valid JSON whose `templateId`
 * fails the schema's literal-union constraint.
 */
function validateResult(result: unknown): { ok: true } | { ok: false; critique: string } {
  const parsed = TemplatePickResultSchema.safeParse(result)
  if (parsed.success) {
    return { ok: true }
  }
  const issue = parsed.error.issues[0]
  const critique = issue
    ? `templateId must be 1, 2, or 3. Issue: ${issue.message} at ${issue.path.join(".")}`
    : "templateId must be 1, 2, or 3."
  return { ok: false, critique }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pick the best Replik Shopify template for a product.
 *
 * Uses Sonnet 4.6 with a vision input (hero image URL) and product metadata.
 * Wraps free-text fields in `<UNTRUSTED>` tags per §5.
 * Retries once with critique on schema mismatch per §6 using `bumpedModel`
 * (Opus by default) to escalate to a stronger model on the bumped tier per §1.4.
 * Returns `1` (Clean Classic) on any unrecoverable error — never throws.
 */
export async function pickTemplate(
  input: TemplatePickInput,
  model: LanguageModel = anthropic(MODELS.CLASSIFIER),
  bumpedModel: LanguageModel = anthropic(MODELS.CREATIVE),
): Promise<TemplateId> {
  const result = await withTiming(
    "ai.template_pick",
    () =>
      withRetry<TemplatePickInput, unknown>(
        {
          primary: (inp) => callLLM(inp, model),
          bumped: (inp, critique) => callLLMWithCritique(inp, critique, bumpedModel),
          fallback: () => ({ templateId: 1 as const }),
          validate: validateResult,
        },
        input,
      ),
    { category: input.category },
  )
  return TemplatePickResultSchema.parse(result).templateId
}
