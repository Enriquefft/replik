import { z } from "zod"

export const BURN_PHASES = ["transcribe", "translate", "burn", "upload"] as const
export const BurnProgressMetadataSchema = z.object({
  phase: z.enum(BURN_PHASES),
  bytes: z.number().int().nonnegative().optional(),
})
export type BurnPhase = (typeof BURN_PHASES)[number]
export type BurnProgressMetadata = z.infer<typeof BurnProgressMetadataSchema>
