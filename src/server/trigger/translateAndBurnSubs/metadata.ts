import { z } from "zod"

export const BURN_PHASES = [
  "transcribe",
  "translate",
  "detect",
  "segment",
  "burn",
  "upload",
] as const
export type BurnPhase = (typeof BURN_PHASES)[number]

/**
 * Realtime metadata published by `translateAndBurnSubsTask` via
 * `metadata.set("phase", ...)`, consumed by the Paso 3 edit page.
 */
export const BurnProgressMetadataSchema = z.object({
  phase: z.enum(BURN_PHASES).optional(),
})
export type BurnProgressMetadata = z.infer<typeof BurnProgressMetadataSchema>
