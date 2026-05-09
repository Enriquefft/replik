import "server-only"

/**
 * Meta ads copy generation — §11.
 *
 *   Stage 1 — 5 parallel Opus 4.7 framings (Hook / Benefit / Social-proof /
 *             Problem→Solution / Outcome). Each call runs at temperature 0.6
 *             with a distinct opening-verb instruction so the candidate set is
 *             structurally diverse.
 *   Stage 2 — 2 parallel Opus 4.7 judges. Judge A optimises for clarity,
 *             Judge B for hook strength. On disagreement, ship the Hook-led
 *             anchor (index 0) — deterministic.
 *   Stage 3 — Rule-based post-check via `metaPolicy`, `aiSpeak`, `lengthCheck`.
 *             Any failure triggers ONE row-targeted regenerate (Opus 4.7,
 *             temp 0.6) with a critique block. If the rewritten row still
 *             fails, return the merged candidate as-is and surface unresolved
 *             violations via the side-channel callback (§1.4 fail visible).
 *
 * Each individual LLM call (generator / judge / regenerate) is wrapped in
 * `withRetry`: primary Opus → bumped Opus + `<previous_attempt>` critique →
 * fallback throws so the parallel reducer can drop the framing or fail-soft.
 */

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateText, Output } from "ai"
import { z } from "zod"
import { type CopyContent, CopyContentSchema } from "@/lib/ai/copy-schema.ts"
import { aiSpeak, lengthCheck, metaPolicy, wrapUntrusted } from "@/lib/ai/guards.ts"
import { copyGenTemperature, MODELS, runHash } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import { type CopyGenCreative, type CopyGenInput, CopyGenInputSchema } from "@/lib/ai/schemas.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"

// ─── Framings (§11 Stage 1) ──────────────────────────────────────────────────

/**
 * The five framings are SSOT. Index 0 (Hook-led) is the deterministic anchor
 * the judges fall back to on disagreement.
 */
export const FRAMINGS = [
  {
    id: "hook-led",
    label: "Hook-led (provocative / curiosity opener)",
    openingVerb: "Mira",
    instruction:
      "Lidera con una pregunta provocadora o un dato que despierte curiosidad. La primera palabra del primaryText debe ser el verbo en imperativo «Mira».",
  },
  {
    id: "benefit-led",
    label: "Benefit-led (outcome-first)",
    openingVerb: "Ahorra",
    instruction:
      "Lidera con el beneficio cuantificable que recibe el comprador hoy mismo. La primera palabra del primaryText debe ser el verbo en imperativo «Ahorra».",
  },
  {
    id: "social-proof-led",
    label: "Social-proof-led (testimonial framing)",
    openingVerb: "Pregunta",
    instruction:
      "Lidera con voz de cliente real o validación de comunidad LATAM-PE. La primera palabra del primaryText debe ser el verbo en imperativo «Pregunta».",
  },
  {
    id: "problem-solution-led",
    label: "Problem→Solution (dolor pivot)",
    openingVerb: "Olvida",
    instruction:
      "Nombra una fricción concreta y pivota a la solución en una sola línea. La primera palabra del primaryText debe ser el verbo en imperativo «Olvida».",
  },
  {
    id: "outcome-aspiration-led",
    label: "Outcome / aspiration-led",
    openingVerb: "Vive",
    instruction:
      "Pinta el resultado aspiracional del comprador tras usar el producto. La primera palabra del primaryText debe ser el verbo en imperativo «Vive».",
  },
] as const

// ─── System prompt blocks ────────────────────────────────────────────────────

const SYSTEM_VOICE_RULES = `Eres un copywriter publicitario experto en Meta Ads para LATAM-PE.

Reglas de voz de marca:
- Tono cercano, conversacional, peruano. Habla de tú, no de usted.
- Cero clichés de marketing AI: prohibido empezar oraciones con «Descubre», «Transforma», «Revoluciona» o «Imagina» (variantes con tilde igual están prohibidas).
- Prohibido el em-dash «—». Usa coma o punto.
- Prohibido escribir palabras enteras en MAYÚSCULAS de tres o más letras (excepto siglas establecidas como TV).
- Prohibido encadenar signos de exclamación («!!»). Un solo «!» máximo y solo cuando aporta.

Reglas de política Meta (no ambiguo, no excepciones):
- Cero promesas médicas: prohibido «cura», «elimina», «milagroso», «garantizado», «adelgaza», «previene».
- Cero preguntas dirigidas a atributos personales: prohibido empezar con «¿Sufres…», «¿Tienes…», «¿Eres…», «¿Estás…».
- Cero antes-y-después ni cuantías de pérdida de peso («baja N kg», «antes y después»).

Restricciones estructurales (Meta Ads, sin negociación):
- primaryText: máximo 125 caracteres.
- headline: máximo 40 caracteres.
- description: máximo 30 caracteres.

El comprador es peruano de NSE B/C: cuida la plata, valora ahorro real, desconfía de promesas grandilocuentes.`

const SYSTEM_FEW_SHOTS = `Ejemplos válidos (LATAM-PE, voz aprobada):

[precio]
primaryText: «Mira, el set de tres ollas a 89 soles, hoy nada más. Mismo material, sin pagar la marquita.»
headline: «Tres ollas a 89 soles»
description: «Hoy, sin letra chica»

[demostracion]
primaryText: «Pregunta a quien ya lo tiene: una pasada y la alfombra queda como nueva. Sin pilas, sin recargas.»
headline: «Una pasada, alfombra limpia»
description: «Sin pilas ni recargas»

[dolor]
primaryText: «Olvida el cabello encrespado en las mañanas. Cinco minutos y listo, sin alisado de salón.»
headline: «Cabello listo en 5 minutos»
description: «Sin pasar por salón»

[testimonio]
primaryText: «Cambia lo que pensabas de los desodorantes naturales. Mis clientes repiten desde el primer mes.»
headline: «El que mis clientes repiten»
description: «Sin químicos, sin olor»

[urgencia]
primaryText: «Quedan 12 unidades al precio de lanzamiento. Después sube y ya no hay vuelta atrás.»
headline: «Precio de lanzamiento: hoy»
description: «Solo 12 unidades»

[aspiracional]
primaryText: «Vive el desayuno que siempre quisiste tener. Una licuadora silenciosa y lista en segundos.»
headline: «Desayuno sin ruido ni lío»
description: «Lista en segundos»

[comparacion]
primaryText: «Prueba la diferencia: mismo resultado que el salón, sin cita, sin espera, sin gastar el triple.»
headline: «Resultado salón, precio real»
description: «Sin cita ni espera»

[regalo]
primaryText: «Lleva el kit completo y sorprende sin gastar de más. Todo junto, empacado para regalar ya.»
headline: «Kit listo para regalar»
description: «Todo incluido, precio justo»

Regla adicional: evita la acumulación de tres o más adjetivos seguidos (p. ej. «suave, ligero y resistente»); elige el rasgo más relevante y descarta los demás.`

// ─── Internal schemas ────────────────────────────────────────────────────────

const JudgePickSchema = z.object({
  winnerIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
})

type JudgePick = z.infer<typeof JudgePickSchema>

const CANDIDATE_INDEXES = [0, 1, 2, 3, 4] as const
type CandidateIndex = (typeof CANDIDATE_INDEXES)[number]

const ANCHOR_INDEX: CandidateIndex = 0

// ─── Dependency seam (test injection) ────────────────────────────────────────

export type GenerateCandidateFn = (args: {
  framing: (typeof FRAMINGS)[number]
  userPrompt: string
}) => Promise<CopyContent>

export type JudgeFn = (args: {
  judgeId: "A" | "B"
  rubric: string
  candidates: readonly CopyContent[]
  userPrompt: string
}) => Promise<JudgePick>

export type RegenerateFn = (args: {
  framing: (typeof FRAMINGS)[number]
  userPrompt: string
  critique: string
}) => Promise<CopyContent>

export interface CopyGenDeps {
  generateCandidate: GenerateCandidateFn
  judge: JudgeFn
  regenerate: RegenerateFn
  /** Side-channel for fail-visible logging when post-check still fails post-regenerate. */
  onUnresolvedViolations?: (violations: readonly string[], candidate: CopyContent) => void
}

// ─── Prompt rendering ────────────────────────────────────────────────────────

const TRANSCRIPT_CAP = 800

function clipTranscript(transcript: string): string {
  const trimmed = transcript.trim()
  if (trimmed.length <= TRANSCRIPT_CAP) {
    return trimmed
  }
  return `${trimmed.slice(0, TRANSCRIPT_CAP)}…`
}

function formatCreative(creative: CopyGenCreative): string {
  const angle = creative.angle ?? "(sin clasificar)"
  const transcript = clipTranscript(creative.transcript) || "(transcripción vacía)"
  return [
    `- creativeId: ${creative.id}`,
    `  ángulo: ${angle}`,
    `  idioma: ${creative.language}`,
    `  transcripción: ${wrapUntrusted(transcript)}`,
  ].join("\n")
}

function formatPriceCents(cents: number | null): string {
  if (cents === null) {
    return "(sin precio)"
  }
  return `S/ ${(cents / 100).toFixed(2)}`
}

interface PricingFact {
  label: string
  cents: number
}

/**
 * Compute the savings-cents pair for the supplied bundle prices. Returns null
 * for bundles whose savings are non-positive (charity/loss-leader pricing) so
 * the prompt never advertises a "savings" of zero or negative.
 */
function computeBundleSavingsCents(
  unitCents: number | null,
  bundleCents: number | null,
  qty: 2 | 3,
): number | null {
  if (unitCents === null || bundleCents === null) return null
  const savings = unitCents * qty - bundleCents
  return savings > 0 ? savings : null
}

/**
 * Build the authorised pricing facts for this product. Any standalone digit
 * the model emits in copy must be one of these — the §11 post-check rejects
 * everything else as a hallucination.
 */
function buildPricingFacts(product: CopyGenInput["product"]): PricingFact[] {
  const facts: PricingFact[] = []
  if (product.pricingCents !== null) {
    facts.push({ label: "Precio unitario", cents: product.pricingCents })
  }
  if (product.bundle2PricingCents !== null) {
    facts.push({ label: "Precio bundle x2", cents: product.bundle2PricingCents })
  }
  if (product.bundle3PricingCents !== null) {
    facts.push({ label: "Precio bundle x3", cents: product.bundle3PricingCents })
  }
  const savings2 = computeBundleSavingsCents(product.pricingCents, product.bundle2PricingCents, 2)
  if (savings2 !== null) {
    facts.push({ label: "Ahorro pack 2", cents: savings2 })
  }
  const savings3 = computeBundleSavingsCents(product.pricingCents, product.bundle3PricingCents, 3)
  if (savings3 !== null) {
    facts.push({ label: "Ahorro pack 3", cents: savings3 })
  }
  return facts
}

/**
 * Build the digit whitelist consumed by `runPostCheck`. Always includes the
 * quantity literals 1/2/3 (legitimately referenced as pack sizes) and both
 * the integer and `.00` decimal forms of every pricing fact.
 */
function buildDigitWhitelist(facts: readonly PricingFact[]): readonly string[] {
  const out = new Set<string>(["1", "2", "3"])
  for (const fact of facts) {
    const integer = Math.floor(fact.cents / 100).toString()
    const decimal = (fact.cents / 100).toFixed(2)
    out.add(integer)
    out.add(decimal)
  }
  return [...out]
}

function formatPricingFactsBlock(facts: readonly PricingFact[]): string[] {
  if (facts.length === 0) return []
  const lines: string[] = []
  lines.push("Hechos numéricos AUTORIZADOS — los únicos números que puedes citar en el copy:")
  for (const fact of facts) {
    const integer = Math.floor(fact.cents / 100).toString()
    const decimal = (fact.cents / 100).toFixed(2)
    lines.push(`- ${fact.label}: ${integer} (S/ ${decimal})`)
  }
  lines.push("- Cantidades de pack: 1, 2, 3")
  lines.push("PROHIBIDO inventar otros números (precios, cantidades, porcentajes, duraciones).")
  return lines
}

export function buildUserPrompt(input: CopyGenInput): string {
  const { product, creatives } = input
  const lines: string[] = []
  lines.push("Producto:")
  lines.push(`- nombre: ${product.name ?? "(sin nombre)"}`)
  lines.push(`- categoría: ${product.category ?? "(sin categoría)"}`)
  lines.push(`- precio unitario: ${formatPriceCents(product.pricingCents)}`)
  lines.push(`- bundle x2: ${formatPriceCents(product.bundle2PricingCents)}`)
  lines.push(`- bundle x3: ${formatPriceCents(product.bundle3PricingCents)}`)
  const factsBlock = formatPricingFactsBlock(buildPricingFacts(product))
  if (factsBlock.length > 0) {
    lines.push("")
    lines.push(...factsBlock)
  }
  lines.push("")
  lines.push("Creativos seleccionados:")
  for (const creative of creatives) {
    lines.push(formatCreative(creative))
  }
  return lines.join("\n")
}

function framingSystemPrompt(framing: (typeof FRAMINGS)[number]): string {
  return [
    SYSTEM_VOICE_RULES,
    "",
    SYSTEM_FEW_SHOTS,
    "",
    `Marco de redacción para esta variante: ${framing.label}.`,
    framing.instruction,
    "Devuelve EXACTAMENTE un objeto con campos primaryText, headline, description en español neutral peruano.",
  ].join("\n")
}

function judgeSystemPrompt(rubric: string, judgeId: "A" | "B"): string {
  return [
    `Eres juez ${judgeId} de copy publicitario Meta Ads para LATAM-PE.`,
    "",
    "Recibes 5 candidatos numerados 0..4. Devuelve EXCLUSIVAMENTE el índice del ganador.",
    "",
    `Criterio de selección:\n${rubric}`,
    "",
    SYSTEM_VOICE_RULES,
  ].join("\n")
}

function renderCandidates(candidates: readonly CopyContent[]): string {
  return candidates
    .map((c, i) => {
      return [
        `Candidato ${i.toString()}:`,
        `  primaryText: ${c.primaryText}`,
        `  headline: ${c.headline}`,
        `  description: ${c.description}`,
      ].join("\n")
    })
    .join("\n\n")
}

const JUDGE_A_RUBRIC =
  "PRIORIDAD: claridad. Premia el candidato cuyo mensaje principal se entienda en una sola lectura, con sintaxis simple, sin ambigüedad. Penaliza adornos, frases largas, jergas oscuras."

const JUDGE_B_RUBRIC =
  "PRIORIDAD: fuerza del hook. Premia el candidato cuyo primaryText capture la atención en los primeros caracteres con un gancho diferenciado (curiosidad, beneficio tangible, voz cliente real). Penaliza aperturas planas o genéricas."

// ─── Production deps (Anthropic Opus 4.7 + withRetry) ────────────────────────

interface ProductionLLMDeps {
  primaryModel: LanguageModelV3
  bumpedModel: LanguageModelV3
}

async function callGenerator(
  framing: (typeof FRAMINGS)[number],
  userPrompt: string,
  model: LanguageModelV3,
  critique: string | null,
): Promise<CopyContent> {
  const baseSystem = framingSystemPrompt(framing)
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

  const hash = runHash(`${framing.id}|${userPrompt}`)
  logEvent("ai.copy_gen.candidate.start", { framingId: framing.id, runHash: hash })

  const result = await withTiming(
    "ai.copy_gen.candidate",
    () =>
      generateText({
        model,
        output: Output.object({ schema: CopyContentSchema }),
        system,
        prompt: userPrompt,
        temperature: copyGenTemperature,
      }),
    { framingId: framing.id, runHash: hash },
  )
  return CopyContentSchema.parse(result.output)
}

async function callJudge(
  judgeId: "A" | "B",
  rubric: string,
  candidates: readonly CopyContent[],
  userPrompt: string,
  model: LanguageModelV3,
  critique: string | null,
): Promise<JudgePick> {
  const baseSystem = judgeSystemPrompt(rubric, judgeId)
  const system =
    critique === null
      ? baseSystem
      : [
          baseSystem,
          "",
          "<previous_attempt>",
          critique,
          "</previous_attempt>",
          "Devuelve un winnerIndex válido (0..4).",
        ].join("\n")

  const result = await withTiming(
    "ai.copy_gen.judge",
    () =>
      generateText({
        model,
        output: Output.object({ schema: JudgePickSchema }),
        system,
        prompt: [userPrompt, "", "Candidatos:", "", renderCandidates(candidates)].join("\n"),
        temperature: 0,
      }),
    { judgeId },
  )
  return JudgePickSchema.parse(result.output)
}

async function callRegenerate(
  framing: (typeof FRAMINGS)[number],
  userPrompt: string,
  critique: string,
  model: LanguageModelV3,
  extraCritique: string | null,
): Promise<CopyContent> {
  const blocks: string[] = [
    framingSystemPrompt(framing),
    "",
    "REVISIÓN DIRIGIDA: el candidato anterior violó las reglas. Corrige específicamente:",
    critique,
    "Mantén el resto del copy lo más cercano posible al original; solo arregla la violación.",
  ]
  if (extraCritique !== null) {
    blocks.push("", "<previous_attempt>", extraCritique, "</previous_attempt>")
  }
  const result = await withTiming(
    "ai.copy_gen.regenerate",
    () =>
      generateText({
        model,
        output: Output.object({ schema: CopyContentSchema }),
        system: blocks.join("\n"),
        prompt: userPrompt,
        temperature: copyGenTemperature,
      }),
    { framingId: framing.id },
  )
  return CopyContentSchema.parse(result.output)
}

function validateCopyContent(out: CopyContent): { ok: true } | { ok: false; critique: string } {
  const parsed = CopyContentSchema.safeParse(out)
  if (parsed.success) return { ok: true }
  const issue = parsed.error.issues[0]
  const critique = issue ? `${issue.path.join(".")}: ${issue.message}` : "schema validation failed"
  return { ok: false, critique }
}

function validateJudgePick(out: JudgePick): { ok: true } | { ok: false; critique: string } {
  const parsed = JudgePickSchema.safeParse(out)
  if (parsed.success) return { ok: true }
  const issue = parsed.error.issues[0]
  const critique = issue ? `winnerIndex: ${issue.message}` : "winnerIndex must be 0..4"
  return { ok: false, critique }
}

function makeProductionDeps(llm: ProductionLLMDeps): CopyGenDeps {
  return {
    generateCandidate: async ({ framing, userPrompt }) =>
      withRetry<{ framing: (typeof FRAMINGS)[number]; userPrompt: string }, CopyContent>(
        {
          primary: (inp) => callGenerator(inp.framing, inp.userPrompt, llm.primaryModel, null),
          bumped: (inp, critique) =>
            callGenerator(inp.framing, inp.userPrompt, llm.bumpedModel, critique),
          validate: validateCopyContent,
          fallback: (_inp, lastError) => {
            const message = lastError instanceof Error ? lastError.message : String(lastError)
            throw new Error(`copy-gen generator failed: ${message}`)
          },
        },
        { framing, userPrompt },
      ),
    judge: async ({ judgeId, rubric, candidates, userPrompt }) =>
      withRetry<
        {
          judgeId: "A" | "B"
          rubric: string
          candidates: readonly CopyContent[]
          userPrompt: string
        },
        JudgePick
      >(
        {
          primary: (inp) =>
            callJudge(
              inp.judgeId,
              inp.rubric,
              inp.candidates,
              inp.userPrompt,
              llm.primaryModel,
              null,
            ),
          bumped: (inp, critique) =>
            callJudge(
              inp.judgeId,
              inp.rubric,
              inp.candidates,
              inp.userPrompt,
              llm.bumpedModel,
              critique,
            ),
          validate: validateJudgePick,
          fallback: () => ({ winnerIndex: ANCHOR_INDEX }),
        },
        { judgeId, rubric, candidates, userPrompt },
      ),
    regenerate: async ({ framing, userPrompt, critique }) =>
      withRetry<
        { framing: (typeof FRAMINGS)[number]; userPrompt: string; critique: string },
        CopyContent
      >(
        {
          primary: (inp) =>
            callRegenerate(inp.framing, inp.userPrompt, inp.critique, llm.primaryModel, null),
          bumped: (inp, extraCritique) =>
            callRegenerate(
              inp.framing,
              inp.userPrompt,
              inp.critique,
              llm.bumpedModel,
              extraCritique,
            ),
          validate: validateCopyContent,
          fallback: (_inp, lastError) => {
            const message = lastError instanceof Error ? lastError.message : String(lastError)
            throw new Error(`copy-gen regenerate failed: ${message}`)
          },
        },
        { framing, userPrompt, critique },
      ),
  }
}

// ─── Post-check ──────────────────────────────────────────────────────────────

type CopyField = "primaryText" | "headline" | "description"

interface FieldViolation {
  field: CopyField
  reason: string
}

const COPY_FIELDS = [
  "primaryText",
  "headline",
  "description",
] as const satisfies readonly CopyField[]

/**
 * Numeric tokens (integer or decimal) anywhere in the string. Unanchored on
 * purpose: embedded digits inside tokens like "Top10" still match, since
 * fabricated digits are equally suspect when the model is supposed to cite
 * only authorised pricing facts.
 */
const DIGIT_TOKEN_RE = /\d+(?:[.,]\d+)?/g

/**
 * Reject any standalone digit-token in `text` that is not present in
 * `whitelist`. The whitelist is built from the product's authorised pricing
 * facts (`buildDigitWhitelist`) plus quantity literals 1/2/3. Empty whitelist
 * disables the check (used by tests that don't care about pricing facts).
 */
function digitWhitelistViolations(text: string, whitelist: readonly string[]): string[] {
  if (whitelist.length === 0) return []
  const allowed = new Set(whitelist)
  const offenders: string[] = []
  for (const match of text.matchAll(DIGIT_TOKEN_RE)) {
    const token = match[0].replace(",", ".")
    if (!allowed.has(token)) {
      offenders.push(match[0])
    }
  }
  return offenders
}

/**
 * Run the rule-based deterministic post-check on a candidate.
 * Returns the list of failed fields (empty list = pass).
 *
 * `digitWhitelist` (optional) constrains which numeric tokens may appear in
 * the copy. Pass an empty array (or omit) to skip the digit check — the
 * production path always supplies the whitelist via `buildDigitWhitelist`.
 */
export function runPostCheck(
  candidate: CopyContent,
  digitWhitelist: readonly string[] = [],
): FieldViolation[] {
  const violations: FieldViolation[] = []

  const length = lengthCheck(candidate)
  if (!length.ok) {
    const match = length.reason.match(/LENGTH_VIOLATION:\s+(primaryText|headline|description)/)
    const captured = match ? match[1] : null
    const field: CopyField =
      captured === "primaryText" || captured === "headline" || captured === "description"
        ? captured
        : "primaryText"
    violations.push({ field, reason: length.reason })
  }

  for (const field of COPY_FIELDS) {
    const text = candidate[field]
    const policy = metaPolicy(text)
    if (!policy.ok) {
      violations.push({ field, reason: `META_POLICY: ${policy.reason}` })
    }
    const speak = aiSpeak(text)
    if (!speak.ok) {
      violations.push({ field, reason: `AI_SPEAK: ${speak.reason}` })
    }
    const offenders = digitWhitelistViolations(text, digitWhitelist)
    if (offenders.length > 0) {
      violations.push({
        field,
        reason: `DIGIT_HALLUCINATION: ${offenders.join(", ")}`,
      })
    }
  }

  return violations
}

function buildCritique(violations: readonly FieldViolation[]): string {
  return violations.map((v) => `- ${v.field}: ${v.reason}`).join("\n")
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Optional model overrides for tests; production callers pass nothing.
 */
export interface CopyGenLLMDeps {
  primaryModel?: LanguageModelV3
  bumpedModel?: LanguageModelV3
}

export type GenerateCopyDeps = CopyGenDeps | CopyGenLLMDeps

function isInjectedDeps(deps: GenerateCopyDeps): deps is CopyGenDeps {
  return "generateCandidate" in deps
}

/**
 * Generate the final Meta ad copy for a launch. Implements §11 in full.
 * Never throws on validation failures — surfaces unresolved violations via
 * `deps.onUnresolvedViolations` and returns the best candidate available.
 */
export async function generateCopy(
  rawInput: CopyGenInput,
  deps: GenerateCopyDeps = {},
): Promise<CopyContent> {
  const input = CopyGenInputSchema.parse(rawInput)
  return withTiming(
    "ai.copy_gen",
    async () => {
      const userPrompt = buildUserPrompt(input)
      const digitWhitelist = buildDigitWhitelist(buildPricingFacts(input.product))

      const realDeps: CopyGenDeps = isInjectedDeps(deps)
        ? deps
        : makeProductionDeps({
            primaryModel: deps.primaryModel ?? anthropic(MODELS.CREATIVE),
            bumpedModel: deps.bumpedModel ?? anthropic(MODELS.CREATIVE),
          })

      // ── Stage 1 — 5 parallel framings ────────────────────────────────────
      const candidatesArr = await Promise.all(
        FRAMINGS.map((framing) => realDeps.generateCandidate({ framing, userPrompt })),
      )
      if (candidatesArr.length !== 5) {
        throw new Error(`copy-gen: expected 5 candidates, got ${candidatesArr.length.toString()}`)
      }
      const candidates: readonly CopyContent[] = candidatesArr

      // ── Stage 2 — 2 parallel judges ──────────────────────────────────────
      const [pickA, pickB] = await Promise.all([
        realDeps.judge({ judgeId: "A", rubric: JUDGE_A_RUBRIC, candidates, userPrompt }),
        realDeps.judge({ judgeId: "B", rubric: JUDGE_B_RUBRIC, candidates, userPrompt }),
      ])

      const winnerIndex: CandidateIndex =
        pickA.winnerIndex === pickB.winnerIndex ? pickA.winnerIndex : ANCHOR_INDEX

      const winnerCandidate = candidates[winnerIndex]
      if (!winnerCandidate) {
        throw new Error(`copy-gen: candidate index ${winnerIndex.toString()} missing`)
      }

      // ── Stage 3 — rule-based post-check (one regenerate cycle) ──────────
      const initialViolations = runPostCheck(winnerCandidate, digitWhitelist)
      if (initialViolations.length === 0) {
        return winnerCandidate
      }

      const winningFraming = FRAMINGS[winnerIndex]
      const critique = buildCritique(initialViolations)
      let regenerated: CopyContent
      try {
        regenerated = await realDeps.regenerate({
          framing: winningFraming,
          userPrompt,
          critique,
        })
      } catch {
        realDeps.onUnresolvedViolations?.(
          initialViolations.map((v) => `${v.field}: ${v.reason}`),
          winnerCandidate,
        )
        return winnerCandidate
      }

      const failedFields = new Set(initialViolations.map((v) => v.field))
      const merged: CopyContent = {
        primaryText: failedFields.has("primaryText")
          ? regenerated.primaryText
          : winnerCandidate.primaryText,
        headline: failedFields.has("headline") ? regenerated.headline : winnerCandidate.headline,
        description: failedFields.has("description")
          ? regenerated.description
          : winnerCandidate.description,
      }

      const postRegenViolations = runPostCheck(merged, digitWhitelist)
      if (postRegenViolations.length === 0) {
        return merged
      }

      realDeps.onUnresolvedViolations?.(
        postRegenViolations.map((v) => `${v.field}: ${v.reason}`),
        merged,
      )
      return merged
    },
    { creativeCount: input.creatives.length },
  )
}
