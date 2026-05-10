import { z } from "zod"

export const BURN_PHASES = ["transcribe", "translate", "burn", "upload"] as const
export type BurnPhase = (typeof BURN_PHASES)[number]

/**
 * Realtime metadata published by `translateAndBurnSubsTask` via
 * `metadata.set("phase", ...)`. `bytes` is only set after `burn` completes
 * (size of the burned MP4 buffer); the realtime UI uses it as a "burn
 * finished, uploading now" hint.
 */
export const BurnProgressMetadataSchema = z.object({
  phase: z.enum(BURN_PHASES).optional(),
  bytes: z.number().int().nonnegative().optional(),
})
export type BurnProgressMetadata = z.infer<typeof BurnProgressMetadataSchema>
