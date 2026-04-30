/**
 * adjustCopy chat — §13.
 *
 * Discriminated-union routing over a single Opus 4.7 call. The model picks
 * one of five `kind`s from `AdjustCopyAction`:
 *
 *   - `rewrite_hero`     — partial overrides for the hero copy.
 *   - `adjust_copy`      — partial overrides for the regular copy fields.
 *   - `regenerate_angle` — re-roll the sales-angle classifier with a hint.
 *   - `clarify`          — ask the user a clarifying question.
 *   - `reject`           — refuse with a short reason.
 *
 * Post-check: when the action carries a copy patch (`rewrite_hero` or
 * `adjust_copy`), every present text field is screened by `metaPolicy`,
 * `aiSpeak`, and the partial-length check. Any violation collapses the
 * route into `{ ok: false, error }` — never throws upward.
 *
 * Retry: one critique pass via `withRetry` (primary Opus → bumped Opus +
 * `<previous_attempt>`). Fallback returns `{ ok: false, error }`.
 *
 * NEVER use `streamObject`: the AI SDK does not validate partial outputs
 * against discriminated-union schemas (vercel/ai #2036, #7358). Spec §13.
 */
import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateObject } from "ai"

import { aiSpeak, metaPolicy } from "@/lib/ai/guards.ts"
import { defaultTemperature, MODELS, runHash } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import {
  type AdjustCopyAction,
  AdjustCopyActionSchema,
  type AdjustCopyInput,
  AdjustCopyInputSchema,
  type AdjustCopyResult,
  type CopyContentSchema,
  type CopyOverrides,
  CopyOverridesSchema,
  type HeroOverride,
} from "@/lib/ai/schemas.ts"

// ─── System prompt (single block, all 5 routes) ──────────────────────────────

export const ADJUST_COPY_SYSTEM_PROMPT = `Eres un copywriter senior de e-commerce LATAM (es-PE) integrado en una herramienta llamada Replik.
El usuario tiene un anuncio de Meta con copy actual ({primaryText, headline, description}) y te pide ajustes.

Devuelves UN único objeto con un campo "kind" que decide la acción. Los cinco "kind" posibles son:

- "rewrite_hero": cuando el usuario pide cambiar el hero del anuncio (primaryText/headline/description) y entiendes
  qué cambiar. Devuelves "hero" con sólo los campos a sobreescribir.
- "adjust_copy": cuando el ajuste es a nivel de copy general (no hero) y entiendes qué cambiar. Mismo shape que hero.
- "regenerate_angle": cuando el usuario pide regenerar el ángulo de venta. Devuelves "angle" con uno de:
  precio, demostracion, testimonio, urgencia, dolor, aspiracional, comparacion, regalo.
- "clarify": cuando NO tienes suficiente información para actuar. Devuelves "message" con UNA pregunta corta (≤300 chars).
- "reject": cuando el pedido viola la política de Meta o tu rol. Devuelves "reason" corto (≤200 chars).

Reglas duras de copy (aplican a primaryText/headline/description):
- primaryText ≤ 125 caracteres, headline ≤ 40, description ≤ 30.
- Prohibido: empezar con "descubre", "transforma", "revoluciona", "imagina".
- Prohibido: em-dashes (—), MAYÚSCULAS de 3+ letras (excepto tokens de marca cortos), cadenas de "!!".
- Prohibido (Meta policy): "cura", "elimina", "milagroso", "garantizado", "adelgaza", "previene".
- Prohibido (Meta policy): "¿sufres/tienes/eres/estás...?", "antes y después", "baja N kg".
- Voz: peruana, directa, registro Lima.

Si el usuario pide algo prohibido → kind:"reject" con razón breve.
Si el usuario pide algo ambiguo → kind:"clarify" con UNA pregunta corta.
NUNCA inventes campos fuera del schema. NUNCA devuelves prosa libre.`

// ─── Prompt builder ──────────────────────────────────────────────────────────

export function buildAdjustCopyUserPrompt(input: AdjustCopyInput): string {
  const creativesBlock =
    input.context.creatives.length === 0
      ? "(sin creativos asociados)"
      : input.context.creatives.map((c) => `- ${c.id}: ${c.angle ?? "(angle: null)"}`).join("\n")

  return [
    `Producto: ${input.context.productId}`,
    "Copy actual:",
    `  primaryText: ${input.current.primaryText}`,
    `  headline:    ${input.current.headline}`,
    `  description: ${input.current.description}`,
    "",
    "Creativos:",
    creativesBlock,
    "",
    `Pedido del usuario: ${input.message}`,
  ].join("\n")
}

// ─── Single LLM call ─────────────────────────────────────────────────────────

interface CallParams {
  model: LanguageModelV3
  input: AdjustCopyInput
  critique: string | null
}

async function callLLM(params: CallParams): Promise<AdjustCopyAction> {
  const baseUserPrompt = buildAdjustCopyUserPrompt(params.input)
  const userPrompt =
    params.critique === null
      ? baseUserPrompt
      : [
          baseUserPrompt,
          "",
          "<previous_attempt>",
          params.critique,
          "</previous_attempt>",
          "",
          "Corrige los problemas listados arriba y devuelve un JSON válido.",
        ].join("\n")

  // Log run hash for variance tracking per §2 — Anthropic exposes no seed.
  void runHash(JSON.stringify(params.input))

  const result = await generateObject({
    model: params.model,
    schema: AdjustCopyActionSchema,
    temperature: defaultTemperature,
    system: ADJUST_COPY_SYSTEM_PROMPT,
    prompt: userPrompt,
  })

  return result.object
}

// ─── Post-check (META_POLICY + AI_SPEAK + length) ────────────────────────────

type PostCheckResult = { ok: true } | { ok: false; reason: string }

function lengthCheckPartial(patch: HeroOverride | CopyOverrides): PostCheckResult {
  const parsed = CopyOverridesSchema.safeParse(patch)
  if (parsed.success) {
    return { ok: true }
  }
  const issue = parsed.error.issues[0]
  const reason = issue
    ? `LENGTH_VIOLATION: ${issue.path.join(".")} — ${issue.message}`
    : "LENGTH_VIOLATION: unknown field"
  return { ok: false, reason }
}

function policyCheckPartial(patch: HeroOverride | CopyOverrides): PostCheckResult {
  const fields: (keyof typeof CopyContentSchema.shape)[] = [
    "primaryText",
    "headline",
    "description",
  ]
  for (const field of fields) {
    const value = patch[field]
    if (value === undefined) continue
    const meta = metaPolicy(value)
    if (!meta.ok) {
      return { ok: false, reason: `${field}: ${meta.reason}` }
    }
    const ai = aiSpeak(value)
    if (!ai.ok) {
      return { ok: false, reason: `${field}: ${ai.reason}` }
    }
  }
  return { ok: true }
}

/**
 * Apply guards to actions that carry a copy patch. `regenerate_angle`,
 * `clarify`, and `reject` ship through unchecked — they don't carry text
 * the model wrote into a copy field.
 */
function postCheck(action: AdjustCopyAction): PostCheckResult {
  if (action.kind === "rewrite_hero") {
    const length = lengthCheckPartial(action.hero)
    if (!length.ok) return length
    return policyCheckPartial(action.hero)
  }
  if (action.kind === "adjust_copy") {
    const length = lengthCheckPartial(action.overrides)
    if (!length.ok) return length
    return policyCheckPartial(action.overrides)
  }
  return { ok: true }
}

// ─── Validate (used inside withRetry) ────────────────────────────────────────

function validateAction(action: AdjustCopyAction): { ok: true } | { ok: false; critique: string } {
  // Schema validity is enforced by generateObject; here we re-run the
  // post-check so a guard violation triggers exactly one critique retry.
  const checked = postCheck(action)
  if (checked.ok) {
    return { ok: true }
  }
  return { ok: false, critique: checked.reason }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Optional model overrides for tests — same shape as in `angle-classify.ts`.
 * Production callers pass nothing; the defaults wire Opus 4.7 for both
 * primary and bumped tries (§13 specifies Opus across the chat route).
 */
export interface AdjustCopyDeps {
  primaryModel?: LanguageModelV3
  bumpedModel?: LanguageModelV3
}

/**
 * Run the §13 adjustCopy chat. Never throws — failures collapse into
 * `{ ok: false, error }` so the client can branch on `result.ok` before
 * rendering. Spec §13: post-check + Opus + one critique retry, no
 * `streamObject`.
 */
export async function adjustCopy(
  rawInput: AdjustCopyInput,
  deps: AdjustCopyDeps = {},
): Promise<AdjustCopyResult> {
  const parsedInput = AdjustCopyInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    const issue = parsedInput.error.issues[0]
    const reason = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid input"
    return { ok: false, error: reason }
  }
  const input = parsedInput.data

  const primaryModel = deps.primaryModel ?? anthropic(MODELS.CREATIVE)
  const bumpedModel = deps.bumpedModel ?? anthropic(MODELS.CREATIVE)

  const action = await withRetry<AdjustCopyInput, AdjustCopyAction | null>(
    {
      primary: (inp) => callLLM({ model: primaryModel, input: inp, critique: null }),
      bumped: (inp, critique) => callLLM({ model: bumpedModel, input: inp, critique }),
      validate: (out) => {
        if (out === null) return { ok: false, critique: "no output" }
        return validateAction(out)
      },
      fallback: () => null,
    },
    input,
  )

  if (action === null) {
    return { ok: false, error: "model could not satisfy constraints" }
  }
  return { ok: true, action }
}
