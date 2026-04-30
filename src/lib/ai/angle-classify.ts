/**
 * Sales-angle self-consistency classifier — §12.
 *
 * Fires 5 parallel Sonnet 4.6 calls at temperature 0.3, then aggregates
 * per-creative votes. Skips creatives with transcript.trim().length < 15
 * (null sentinel, no LLM call). Null is the only "no value" result; no
 * magic-string sentinels.
 */
import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateObject } from "ai"
import { z } from "zod"

import { MODELS, runHash, salesAngleTemperature } from "@/lib/ai/models.ts"
import type { SalesAngleClassification } from "@/lib/ai/schemas.ts"
import { SalesAngleClassificationSchema } from "@/lib/ai/schemas.ts"
import { SalesAngle } from "@/lib/ai/taxonomies.ts"

// ─── Input schema ─────────────────────────────────────────────────────────────

export const AngleClassifyInputSchema = z.object({
  creatives: z.array(
    z.object({
      id: z.string(),
      transcript: z.string(),
      language: z.string(),
    }),
  ),
})

export type AngleClassifyInput = z.infer<typeof AngleClassifyInputSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

/** Transcript floor per §12 — shorter than this → skip LLM, emit null. */
const TRANSCRIPT_MIN_LENGTH = 15

/** Number of parallel self-consistency calls per §12. */
const PARALLEL_CALLS = 5

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un experto en marketing digital latinoamericano especializado en clasificar ángulos de venta.

Para cada creativo, clasifica su transcripción con UN ángulo de venta de los siguientes 8 valores posibles:
- precio: comparación de precio, ahorro, oferta económica
- demostracion: mostrar el producto en uso, resultados visuales
- testimonio: experiencia personal, reseña de usuario real
- urgencia: stock limitado, tiempo limitado, actuar ya
- dolor: problema del cliente, frustración, incomodidad
- aspiracional: visión futura positiva, estilo de vida ideal
- comparacion: comparar con competidores o alternativas
- regalo: producto gratis incluido, obsequio, promoción

Si la transcripción no encaja claramente en ningún ángulo, devuelve null para ese creativo.
Devuelve EXACTAMENTE un objeto por cada creativeId de entrada.`

// ─── Single LLM call ──────────────────────────────────────────────────────────

async function callOnce(
  creatives: AngleClassifyInput["creatives"],
  model: LanguageModelV3,
): Promise<SalesAngleClassification> {
  // Log run hash for variance tracking per §2 — Anthropic exposes no seed.
  void runHash(JSON.stringify(creatives))

  const prompt = JSON.stringify(
    creatives.map((c) => ({
      creativeId: c.id,
      transcript: c.transcript,
      language: c.language,
    })),
  )

  const result = await generateObject({
    model,
    schema: SalesAngleClassificationSchema,
    temperature: salesAngleTemperature,
    system: SYSTEM_PROMPT,
    prompt,
  })

  return result.object
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

type Vote = z.infer<typeof SalesAngle> | null

/**
 * Aggregate per-creative votes across surviving calls per §12:
 * - Majority (single value with most votes) → ship.
 * - No majority but ≥2 calls agree on a value → ship that pick.
 * - Tie between two values with equal counts → first call's pick.
 * - All 5 different (max count = 1) → null.
 * - All calls failed → null.
 * - Failed calls are dropped from the vote entirely (not substituted with null).
 */
function aggregateVotes(
  creativeIds: readonly string[],
  callResults: readonly SalesAngleClassification[],
  failedCallIndices: ReadonlySet<number>,
): SalesAngleClassification {
  const angles = creativeIds.map((creativeId) => {
    const votes: Vote[] = []

    for (let callIdx = 0; callIdx < PARALLEL_CALLS; callIdx++) {
      if (failedCallIndices.has(callIdx)) continue
      const callResult = callResults[callIdx]
      if (callResult === undefined) continue

      const entry = callResult.angles.find((a) => a.creativeId === creativeId)
      if (entry !== undefined) {
        votes.push(entry.angle)
      }
    }

    if (votes.length === 0) {
      return { creativeId, angle: null }
    }

    const counts = new Map<Vote, number>()
    for (const vote of votes) {
      const current = counts.get(vote) ?? 0
      counts.set(vote, current + 1)
    }

    let maxCount = 0
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count
    }

    if (maxCount < 2) {
      return { creativeId, angle: null }
    }

    const tied: Vote[] = []
    for (const [val, count] of counts.entries()) {
      if (count === maxCount) tied.push(val)
    }

    if (tied.length === 1) {
      const winner = tied[0] ?? null
      const parsed = SalesAngle.safeParse(winner)
      return { creativeId, angle: parsed.success ? parsed.data : null }
    }

    // Deterministic tie-break: first surviving call's pick that is in the tied set.
    for (let callIdx = 0; callIdx < PARALLEL_CALLS; callIdx++) {
      if (failedCallIndices.has(callIdx)) continue
      const callResult = callResults[callIdx]
      if (callResult === undefined) continue

      const entry = callResult.angles.find((a) => a.creativeId === creativeId)
      if (entry === undefined) continue

      if (tied.includes(entry.angle)) {
        const parsed = SalesAngle.safeParse(entry.angle)
        return { creativeId, angle: parsed.success ? parsed.data : null }
      }
    }

    return { creativeId, angle: null }
  })

  return { angles }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify sales angles for a batch of creatives using 5-call self-consistency.
 *
 * - Transcripts shorter than 15 chars (trimmed) are skipped: angle → null.
 * - Fires exactly 5 parallel Sonnet 4.6 calls at temperature 0.3.
 * - Aggregates per-creative votes; null is the only "no value" sentinel.
 *
 * @param input - Batch of creatives (id, transcript, language).
 * @param modelFactory - Optional model factory override (for tests).
 */
export async function classifyAngle(
  input: AngleClassifyInput,
  modelFactory: () => LanguageModelV3 = () => anthropic(MODELS.CLASSIFIER),
): Promise<SalesAngleClassification> {
  const { creatives } = input

  const skipped: Array<{ creativeId: string; angle: null }> = []
  const toClassify: AngleClassifyInput["creatives"] = []

  for (const c of creatives) {
    if (c.transcript.trim().length < TRANSCRIPT_MIN_LENGTH) {
      skipped.push({ creativeId: c.id, angle: null })
    } else {
      toClassify.push(c)
    }
  }

  if (toClassify.length === 0) {
    const angles = creatives.map((c) => ({ creativeId: c.id, angle: null }))
    return { angles }
  }

  const settled = await Promise.allSettled(
    Array.from({ length: PARALLEL_CALLS }, () => callOnce(toClassify, modelFactory())),
  )

  const callResults: SalesAngleClassification[] = []
  const failedCallIndices = new Set<number>()

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result === undefined || result.status === "rejected") {
      failedCallIndices.add(i)
      callResults.push({ angles: [] })
    } else {
      callResults.push(result.value)
    }
  }

  const classified = aggregateVotes(
    toClassify.map((c) => c.id),
    callResults,
    failedCallIndices,
  )

  const angleMap = new Map<string, Vote>()
  for (const entry of skipped) {
    angleMap.set(entry.creativeId, null)
  }
  for (const entry of classified.angles) {
    angleMap.set(entry.creativeId, entry.angle)
  }

  const angles = creatives.map((c) => ({
    creativeId: c.id,
    angle: angleMap.get(c.id) ?? null,
  }))

  return { angles }
}
