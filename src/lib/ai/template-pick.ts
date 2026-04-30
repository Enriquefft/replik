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
import type { TemplatePickInput, TemplatePickResult } from "@/lib/ai/schemas.ts"
import { TemplatePickResultSchema } from "@/lib/ai/schemas.ts"
import type { TemplateId } from "@/lib/ai/taxonomies.ts"

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * System prompt prose token-matches templates/{1,2,3}.json per §8 snapshot
 * contract. Discriminating tokens per template:
 *
 * Template 1 — "Clean Classic": clean, classic, minimal, professional,
 *   "Calidad garantizada", "Pedido contra entrega", neutral trust signals.
 *
 * Template 2 — "Urgency / Sales": urgency, sales, "OFERTA LIMITADA", stock,
 *   "solo hoy", "Quedan pocas unidades", scarcity, discount, "más popular".
 *
 * Template 3 — "Lifestyle": lifestyle, warm, aspirational, "estilo de vida",
 *   "Para mí", "Para compartir", "Para regalar", emotional, "Quiero el mío".
 */
export const TEMPLATE_PICK_SYSTEM_PROMPT = `You are a CRO expert specializing in COD landing pages for LATAM markets.

Analyze the product hero image together with the product name, category, description, and price. Select the single best Replik landing template from the three options below. Return ONLY the templateId (1, 2, or 3).

---

## Template 1 — Clean Classic
A clean, classic, minimal, and professional layout that builds trust through simplicity.
Subheading tone: "Calidad garantizada. Entrega contra entrega." — neutral, reassuring.
Pricing labels: "1 unidad", "2 pack", "3 pack" — plain, no urgency language.
Order form heading: "Pedido contra entrega" — calm, institutional.
Best for: household utilities, gadgets, tools, health appliances, kitchen equipment,
fitness accessories with a functional/technical image. Products where professional
credibility and clarity close the sale.

## Template 2 — Urgency / Sales
An urgency-driven, sales-aggressive layout that highlights scarcity and discounts.
Hero heading prefix: "OFERTA LIMITADA:" — all-caps, high-impact.
Subheading: "Stock limitado — solo hoy con descuento exclusivo." — scarcity signal.
Pricing extras: "más popular", "máximo ahorro", urgency_text "Quedan pocas unidades en stock".
CTA button: "¡QUIERO MI OFERTA!" — exclamatory, impulse-driven.
Best for: beauty products, fashion accessories, supplements, impulse purchases, and any
product with a promotional angle. Hero image shows before/after, transformation, or
a heavily styled "sale" visual.

## Template 3 — Lifestyle
A warm, aspirational, lifestyle-oriented layout with emotional connection.
Subheading: "Hecho para tu estilo de vida. Disfrútalo desde el primer día." — lifestyle, warm.
lifestyle_mood: warm — CSS mood is warm and welcoming.
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

async function callLLM(
  input: TemplatePickInput,
  model: LanguageModel,
): Promise<TemplatePickResult> {
  const result = await generateText({
    model,
    output: Output.object({ schema: TemplatePickResultSchema }),
    temperature: defaultTemperature,
    system: TEMPLATE_PICK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: new URL(input.heroImageUrl),
          },
          {
            type: "text",
            text: buildTemplatePickPrompt(input),
          },
        ],
      },
    ],
  })
  return result.output
}

async function callLLMWithCritique(
  input: TemplatePickInput,
  critique: string,
  model: LanguageModel,
): Promise<TemplatePickResult> {
  const result = await generateText({
    model,
    output: Output.object({ schema: TemplatePickResultSchema }),
    temperature: defaultTemperature,
    system: TEMPLATE_PICK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: new URL(input.heroImageUrl),
          },
          {
            type: "text",
            text: buildTemplatePickPrompt(input),
          },
        ],
      },
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

function validateResult(
  result: TemplatePickResult,
): { ok: true } | { ok: false; critique: string } {
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
 * Retries once with critique on schema mismatch per §6.
 * Returns `1` (Clean Classic) on any unrecoverable error — never throws.
 */
export async function pickTemplate(
  input: TemplatePickInput,
  model: LanguageModel = anthropic(MODELS.CLASSIFIER),
): Promise<TemplateId> {
  const result = await withRetry(
    {
      primary: (inp) => callLLM(inp, model),
      bumped: (inp, critique) => callLLMWithCritique(inp, critique, model),
      fallback: () => ({ templateId: 1 as const }),
      validate: validateResult,
    },
    input,
  )
  return result.templateId
}
