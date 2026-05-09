import "server-only"

/**
 * Landing-body generator.
 *
 * Produces the structured "benefits / FAQ / objections" sections rendered
 * between the hero and the COD form on every Replik landing template. Single
 * Opus 4.7 call wrapped in `withRetry`: primary → bumped (with critique) →
 * fallback throws (publish task surfaces via `markProductFailed`).
 *
 * Inputs mirror copy-gen so the publish task can pass the same product +
 * selected-creatives view it builds for the digit whitelist gate. Output
 * shape is fixed (`length(3)/length(3)/length(2)`) so each landing template
 * binds exactly the same `{{benefit_N_*}}` / `{{faq_N_*}}` / `{{objection_N_text}}`
 * tokens regardless of which template the picker chose.
 */

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateText, Output } from "ai"
import { aiSpeak, metaPolicy, wrapUntrusted } from "@/lib/ai/guards.ts"
import {
  type LandingBody,
  type LandingBodyInput,
  LandingBodyInputSchema,
  LandingBodyLLMSchema,
  LandingBodySchema,
} from "@/lib/ai/landing-body-schema.ts"
import { defaultTemperature, MODELS, runHash } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"

// ─── Prompt ──────────────────────────────────────────────────────────────────

const TRANSCRIPT_CAP = 600

function clipTranscript(transcript: string): string {
  const trimmed = transcript.trim()
  if (trimmed.length <= TRANSCRIPT_CAP) return trimmed
  return `${trimmed.slice(0, TRANSCRIPT_CAP)}…`
}

function formatPriceCents(cents: number | null): string {
  if (cents === null) return "(sin precio)"
  return `S/ ${(cents / 100).toFixed(2)}`
}

const SYSTEM_VOICE_RULES = `Eres un copywriter de landing pages para LATAM-PE escribiendo el cuerpo de una página de producto que vende contra reembolso.

Voz:
- Tono cercano, conversacional, peruano. Habla de tú, no de usted.
- Cero clichés AI: prohibido empezar oraciones con «Descubre», «Transforma», «Revoluciona», «Imagina».
- Prohibido el em-dash «—». Usa coma o punto.
- Prohibido encadenar signos de exclamación («!!»).
- Prohibido escribir palabras enteras en MAYÚSCULAS de tres o más letras (excepto siglas como TV).

Política Meta (no ambiguo):
- Cero promesas médicas: prohibido «cura», «elimina», «milagroso», «garantizado», «adelgaza», «previene».
- Cero preguntas con atributos personales («¿Sufres…», «¿Tienes…», «¿Eres…», «¿Estás…»).
- Cero antes-y-después ni cuantías de pérdida de peso.

El comprador es peruano de NSE B/C: cuida la plata, valora ahorro real, desconfía de promesas grandilocuentes.`

const SECTION_INSTRUCTIONS = `Genera tres secciones para el cuerpo de la landing:

1) benefits (exactamente 3 ítems):
   - benefits[0]: el beneficio principal cuantificable o concreto, anclado a algo que aparezca en las transcripciones.
   - benefits[1]: un beneficio funcional secundario (uso, comodidad, durabilidad).
   - benefits[2]: un beneficio emocional o de estilo de vida.
   - title: 3-40 caracteres, sin punto final.
   - body: 10-120 caracteres, una sola idea, sin adjetivos triples.

2) faq (exactamente 3 ítems):
   - Preguntas que un comprador peruano realmente haría antes de un pago contra entrega.
   - Cubre: cómo se usa o entrega, garantía o devolución, precio o pago.
   - q: 5-80 caracteres terminando en "?".
   - a: 10-180 caracteres, respuesta directa, sin reabrir la pregunta.

3) objections (exactamente 2 ítems):
   - Cada objeción es una frase corta que reconoce una duda común y la resuelve en la misma oración.
   - 10-140 caracteres cada una.
   - Ejemplos de duda: "¿y si no me queda?", "¿pago antes o después?", "¿de verdad llega?".

Restricciones globales:
- No inventes precios, porcentajes, plazos de entrega ni cantidades que no vengan listados en los hechos del producto.
- No menciones marcas competidoras.
- Cada string es texto plano, sin emojis ni markdown.

Devuelve EXACTAMENTE el objeto con los campos benefits, faq, objections según el esquema.`

interface FormattedInput {
  product: LandingBodyInput["product"]
  creatives: LandingBodyInput["creatives"]
}

function buildUserPrompt(input: FormattedInput): string {
  const { product, creatives } = input
  const lines: string[] = []
  lines.push("Producto:")
  lines.push(`- nombre: ${product.name ?? "(sin nombre)"}`)
  lines.push(`- categoría: ${product.category ?? "(sin categoría)"}`)
  if (product.description !== null && product.description.trim().length > 0) {
    lines.push(`- descripción: ${wrapUntrusted(product.description.trim())}`)
  }
  lines.push("")
  lines.push("Hechos numéricos AUTORIZADOS — los únicos números que puedes citar en el cuerpo:")
  lines.push(`- precio unitario: ${formatPriceCents(product.pricingCents)}`)
  lines.push(`- pack 2: ${formatPriceCents(product.bundle2PricingCents)}`)
  lines.push(`- pack 3: ${formatPriceCents(product.bundle3PricingCents)}`)
  lines.push("PROHIBIDO inventar otros números (precios, porcentajes, plazos, cantidades).")
  lines.push("")
  lines.push("Creativos seleccionados (ancla los beneficios y la FAQ a estas voces de cliente):")
  for (const creative of creatives) {
    const angle = creative.angle ?? "(sin clasificar)"
    const transcript = clipTranscript(creative.transcript) || "(transcripción vacía)"
    lines.push(`- ángulo: ${angle}`)
    lines.push(`  idioma: ${creative.language}`)
    lines.push(`  transcripción: ${wrapUntrusted(transcript)}`)
  }
  return lines.join("\n")
}

function systemPrompt(): string {
  return [SYSTEM_VOICE_RULES, "", SECTION_INSTRUCTIONS].join("\n")
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callGenerator(
  userPrompt: string,
  model: LanguageModelV3,
  critique: string | null,
): Promise<unknown> {
  const baseSystem = systemPrompt()
  const system =
    critique === null
      ? baseSystem
      : [
          baseSystem,
          "",
          "<previous_attempt>",
          critique,
          "</previous_attempt>",
          "Corrige los problemas listados arriba.",
        ].join("\n")

  const hash = runHash(`landing-body|${userPrompt}`)
  logEvent("ai.landing_body.candidate.start", { runHash: hash })

  const result = await withTiming(
    "ai.landing_body.candidate",
    () =>
      generateText({
        model,
        output: Output.object({ schema: LandingBodyLLMSchema }),
        system,
        prompt: userPrompt,
        temperature: defaultTemperature,
      }),
    { runHash: hash },
  )
  return result.output
}

// ─── Post-check ──────────────────────────────────────────────────────────────

type Violation = { path: string; reason: string }

function leafStrings(body: LandingBody): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  for (const [i, b] of body.benefits.entries()) {
    out.push({ path: `benefits[${i.toString()}].title`, text: b.title })
    out.push({ path: `benefits[${i.toString()}].body`, text: b.body })
  }
  for (const [i, f] of body.faq.entries()) {
    out.push({ path: `faq[${i.toString()}].q`, text: f.q })
    out.push({ path: `faq[${i.toString()}].a`, text: f.a })
  }
  for (const [i, o] of body.objections.entries()) {
    out.push({ path: `objections[${i.toString()}]`, text: o })
  }
  return out
}

function runPostCheck(body: LandingBody): Violation[] {
  const violations: Violation[] = []
  for (const { path, text } of leafStrings(body)) {
    const speak = aiSpeak(text)
    if (!speak.ok) violations.push({ path, reason: `AI_SPEAK: ${speak.reason}` })
    const policy = metaPolicy(text)
    if (!policy.ok) violations.push({ path, reason: `META_POLICY: ${policy.reason}` })
  }
  return violations
}

function validate(out: unknown): { ok: true } | { ok: false; critique: string } {
  const parsed = LandingBodySchema.safeParse(out)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const critique = issue
      ? `${issue.path.join(".")}: ${issue.message}`
      : "schema validation failed"
    return { ok: false, critique }
  }
  const violations = runPostCheck(parsed.data)
  if (violations.length === 0) return { ok: true }
  const critique = violations.map((v) => `- ${v.path}: ${v.reason}`).join("\n")
  return { ok: false, critique }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface LandingBodyDeps {
  primaryModel?: LanguageModelV3
  bumpedModel?: LanguageModelV3
}

/**
 * Generate the landing-body sections for a published product.
 *
 * Single LLM call with one critique retry. Throws on unrecoverable failure;
 * the publish task catches and routes the error through `markProductFailed`.
 */
export async function generateLandingBody(
  rawInput: LandingBodyInput,
  deps: LandingBodyDeps = {},
): Promise<LandingBody> {
  const input = LandingBodyInputSchema.parse(rawInput)
  return withTiming(
    "ai.landing_body",
    async () => {
      const userPrompt = buildUserPrompt(input)
      const primaryModel = deps.primaryModel ?? anthropic(MODELS.CREATIVE)
      const bumpedModel = deps.bumpedModel ?? anthropic(MODELS.CREATIVE)

      // primary/bumped return the raw LLM output (unknown) so validate() can
      // inspect it; if we parsed inside primary, a count mismatch would throw
      // and `withRetry` skips the critique pass on exceptions.
      const raw = await withRetry<{ userPrompt: string }, unknown>(
        {
          primary: (inp) => callGenerator(inp.userPrompt, primaryModel, null),
          bumped: (inp, critique) => callGenerator(inp.userPrompt, bumpedModel, critique),
          validate,
          fallback: (_inp, lastError) => {
            const message = lastError instanceof Error ? lastError.message : String(lastError)
            throw new Error(`landing-body generator failed: ${message}`)
          },
        },
        { userPrompt },
      )
      return LandingBodySchema.parse(raw)
    },
    { creativeCount: input.creatives.length },
  )
}
