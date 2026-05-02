export const BURN_PHASES = ["transcribe", "translate", "burn", "upload"] as const
export type BurnPhase = (typeof BURN_PHASES)[number]
