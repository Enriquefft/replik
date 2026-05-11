import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the rehost pipeline (Lane L3b feeder). SSOT.
 *
 * The current task body does not broadcast metadata (it runs uploads then
 * blocks on a `batchTriggerAndWait` of `translateAndBurnSubs`). The phase
 * tuple is defined now so Phase B can wire `metadata.set` without inventing
 * new strings ad-hoc. Order matches the runtime sequence: uploads → batch
 * trigger of burn → wait for all burn runs.
 */
export const REHOST_PHASES = ["rehosting", "burning"] as const

export type RehostPhase = (typeof REHOST_PHASES)[number]

/** Per-phase progress weight (sums to 100). Burn fan-out dominates. */
export const REHOST_PHASE_WEIGHTS: Record<RehostPhase, number> = {
  rehosting: 30,
  burning: 70,
}

export const REHOST_PHASE_LABELS_ES: Record<RehostPhase, PhaseLabel> = {
  rehosting: {
    label: "Subiendo originales",
    description: "Copiando los videos seleccionados a nuestro almacenamiento.",
  },
  burning: {
    label: "Editando videos",
    description: "Traduciendo y quemando subtítulos en cada creativo.",
  },
}

/**
 * Known typed failure modes for the rehost pipeline.
 *
 * - `source_unavailable` — every scrape_url fetch failed.
 * - `uploadthing_failed` — UploadThing rejected the upload.
 * - `burn_batch_failed`  — the child burn batch reported zero successes.
 * - `generic_fallback`   — anything else; routes to the LLM translator.
 */
export const REHOST_ERROR_CODES = [
  "source_unavailable",
  "uploadthing_failed",
  "burn_batch_failed",
  "generic_fallback",
] as const

export const RehostErrorCodeSchema = z.enum(REHOST_ERROR_CODES)
export type RehostErrorCode = z.infer<typeof RehostErrorCodeSchema>

/**
 * Realtime metadata published by `rehostCreativesTask`. Phase B will wire
 * `metadata.set` against this shape so the UI parses with Zod.
 */
export const RehostProgressMetadataSchema = z.object({
  phase: z.enum(REHOST_PHASES).optional(),
  rehosted: z.number().int().nonnegative().optional(),
  alreadyHosted: z.number().int().nonnegative().optional(),
  burnTotal: z.number().int().nonnegative().optional(),
  burnDone: z.number().int().nonnegative().optional(),
})

export type RehostProgressMetadata = z.infer<typeof RehostProgressMetadataSchema>
