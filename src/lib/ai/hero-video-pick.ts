/**
 * Hero video picker — Phase 2.
 *
 * The landing hero gets ONE video tile (not the full grid of selected
 * creatives). This module asks the LLM to rank the user's selected creatives
 * for hero-fit and returns the chosen creative's edited video URL.
 *
 * Design choice — text-only ranking. Anthropic does not ingest video, and
 * pulling first-frame thumbnails is overkill for a 1-week MVP. We feed the
 * model the creative's classified sales angle and a slice of the transcript;
 * that signal is sufficient to rank for hook quality and angle fit.
 *
 * The picker NEVER throws. On any unrecoverable error it falls back to the
 * first selected creative — the publish task already guarantees `candidates`
 * is non-empty (the action gates on `selectedBool = true` count > 0).
 */
import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import { generateText, Output } from "ai"
import { z } from "zod"

import { wrapUntrusted } from "@/lib/ai/guards.ts"
import { defaultTemperature, MODELS } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import type { InterestCategory, SalesAngle } from "@/lib/ai/taxonomies.ts"
import { withTiming } from "@/lib/observability/log.ts"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One candidate creative for the hero. The caller fans selected creatives +
 * their edited video assets + classified angles into this shape.
 */
export interface HeroVideoCandidate {
  creativeId: string
  editedVideoUrl: string
  /** Raw transcript text. Empty string for music-only ads. */
  transcriptText: string
  /** Classified sales angle (§12) or null when classification didn't run. */
  angle: SalesAngle | null
}

export interface HeroVideoPickInput {
  candidates: HeroVideoCandidate[]
  product: {
    name: string
    category: InterestCategory
  }
}

/**
 * Output of the picker. `pickedCreativeId` MUST be one of the input
 * `candidates[i].creativeId` values; out-of-set IDs trigger the bumped retry.
 */
export const HeroVideoPickResultSchema = z.object({
  pickedCreativeId: z.string().min(1),
})

// ─── Constants ────────────────────────────────────────────────────────────────

/** Per-candidate transcript char cap (keeps the prompt within budget). */
const TRANSCRIPT_CHAR_CAP = 800

// ─── System prompt ────────────────────────────────────────────────────────────

const HERO_VIDEO_PICK_SYSTEM_PROMPT = `Eres un experto en CRO para landings COD en LATAM. Recibes una lista de creativos publicitarios, cada uno con su transcripción y su ángulo de venta clasificado.

Tu tarea: elegir UN solo creativo que funcione mejor como video del hero. El video del hero es el primer impacto visual de la página de venta — debe enganchar sin sonido (la mayoría de las personas mira con audio apagado), tener un gancho rápido en los primeros 3 segundos, y reforzar el ángulo del producto.

Criterios de selección:
- Apertura fuerte: el inicio del transcript sugiere un gancho visual o pregunta directa.
- Ángulo coherente con el producto y la categoría.
- Claridad: transcripts concisos > transcripts dispersos.
- Evita creativos que dependen de audio (música sin diálogo) cuando hay otros con gancho hablado.

Devuelve un JSON exactamente con la forma {"pickedCreativeId": "<id>"}, donde <id> coincide LITERALMENTE con uno de los <candidate id="..."> que recibes. No inventes ids.`

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Render one candidate as an XML-ish block. Untrusted free-text wrapped per §5.
 * Pure function — exported for tests.
 */
export function renderCandidateBlock(candidate: HeroVideoCandidate): string {
  const transcriptSlice = candidate.transcriptText.slice(0, TRANSCRIPT_CHAR_CAP)
  const angleStr = candidate.angle ?? "null"
  return [
    `<candidate id="${candidate.creativeId}">`,
    `  Angle: ${angleStr}`,
    `  Transcript: ${wrapUntrusted(transcriptSlice)}`,
    `</candidate>`,
  ].join("\n")
}

/**
 * Build the user message for the hero-video picker.
 * Pure function — exported for tests.
 */
export function buildHeroVideoPickPrompt(input: HeroVideoPickInput): string {
  const productLine = `Product name: ${wrapUntrusted(input.product.name)} | Category: ${input.product.category}`
  const candidateBlocks = input.candidates.map(renderCandidateBlock).join("\n")
  return [
    productLine,
    "",
    "Candidatos:",
    candidateBlocks,
    "",
    "Elige el creativo que mejor funcione como video del hero. Devuelve solo {pickedCreativeId}.",
  ].join("\n")
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callPrimary(input: HeroVideoPickInput, model: LanguageModel): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.json(),
    temperature: defaultTemperature,
    system: HERO_VIDEO_PICK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildHeroVideoPickPrompt(input) }],
      },
    ],
  })
  return result.output
}

async function callBumped(
  input: HeroVideoPickInput,
  critique: string,
  bumpedModel: LanguageModel,
): Promise<unknown> {
  const result = await generateText({
    model: bumpedModel,
    output: Output.json(),
    temperature: defaultTemperature,
    system: HERO_VIDEO_PICK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildHeroVideoPickPrompt(input) }],
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
            text: `<critique>${critique}</critique>\nDevuelve un JSON con pickedCreativeId que coincida con uno de los <candidate id="..."> ya enviados.`,
          },
        ],
      },
    ],
  })
  return result.output
}

// ─── Validate ─────────────────────────────────────────────────────────────────

/**
 * Validate the LLM output: shape via Zod + `pickedCreativeId` must be one of
 * the input candidate IDs (the LLM cannot invent a fresh ID).
 */
function makeValidator(
  candidateIds: ReadonlySet<string>,
): (output: unknown) => { ok: true } | { ok: false; critique: string } {
  return (output) => {
    const parsed = HeroVideoPickResultSchema.safeParse(output)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const critique = issue
        ? `pickedCreativeId must be a non-empty string. Issue: ${issue.message} at ${issue.path.join(".")}`
        : "pickedCreativeId must be a non-empty string."
      return { ok: false, critique }
    }
    if (!candidateIds.has(parsed.data.pickedCreativeId)) {
      return {
        ok: false,
        critique: `pickedCreativeId "${parsed.data.pickedCreativeId}" is not in the candidate list.`,
      }
    }
    return { ok: true }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pick the best hero video for the landing.
 *
 * Returns `{ pickedCreativeId, url }`. The URL is the candidate's
 * `editedVideoUrl` — i.e. the post-burn asset the publish task is about to
 * hand to the rendered template.
 *
 * Falls back to `candidates[0]` (deterministic — the action ranks selected
 * creatives by selection order) on any unrecoverable error. Throws iff
 * `candidates.length === 0` — `publishLanding` already gates on that case
 * upstream, so this is a defense-in-depth invariant.
 */
export async function pickHeroVideo(
  input: HeroVideoPickInput,
  model: LanguageModel = anthropic(MODELS.CLASSIFIER),
  bumpedModel: LanguageModel = anthropic(MODELS.CREATIVE),
): Promise<{ pickedCreativeId: string; url: string }> {
  if (input.candidates.length === 0) {
    throw new Error("pickHeroVideo: candidates list is empty")
  }
  const fallback = input.candidates[0]
  if (!fallback) {
    // Length-check above narrows this — keep as defensive narrowing.
    throw new Error("pickHeroVideo: candidates list is empty")
  }

  const candidateIds = new Set(input.candidates.map((c) => c.creativeId))
  const candidateById = new Map(input.candidates.map((c) => [c.creativeId, c] as const))
  const validate = makeValidator(candidateIds)

  const result = await withTiming(
    "ai.hero_video_pick",
    () =>
      withRetry<HeroVideoPickInput, unknown>(
        {
          primary: (inp) => callPrimary(inp, model),
          bumped: (inp, critique) => callBumped(inp, critique, bumpedModel),
          fallback: () => ({ pickedCreativeId: fallback.creativeId }),
          validate,
        },
        input,
      ),
    { category: input.product.category, candidateCount: input.candidates.length },
  )

  const parsed = HeroVideoPickResultSchema.parse(result)
  const picked = candidateById.get(parsed.pickedCreativeId) ?? fallback
  return { pickedCreativeId: picked.creativeId, url: picked.editedVideoUrl }
}
