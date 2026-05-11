import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the burn-subs pipeline (Lane L3b). SSOT — the orchestrator
 * broadcasts these strings via `metadata.set("phase", …)`.
 */
export const BURN_PHASES = [
  "transcribe",
  "translate",
  "detect",
  "segment",
  "burn",
  "upload",
] as const

export type BurnPhase = (typeof BURN_PHASES)[number]

/** Per-phase progress-bar weight (sums to 100). Burn + upload dominate. */
export const BURN_PHASE_WEIGHTS: Record<BurnPhase, number> = {
  transcribe: 15,
  translate: 15,
  detect: 10,
  segment: 10,
  burn: 35,
  upload: 15,
}

export const BURN_PHASE_LABELS_ES: Record<BurnPhase, PhaseLabel> = {
  transcribe: {
    label: "Transcribiendo audio",
    description: "Whisper extrae el guion del video original.",
  },
  translate: {
    label: "Traduciendo subtítulos",
    description: "Adaptando el guion al español latino.",
  },
  detect: {
    label: "Analizando subtítulos del original",
    description: "Detectando subtítulos quemados para enmascararlos.",
  },
  segment: {
    label: "Preparando subtítulos virales",
    description: "Re-segmentando cues con ritmo de redes.",
  },
  burn: {
    label: "Quemando subtítulos",
    description: "Renderizando el overlay sobre el video.",
  },
  upload: {
    label: "Subiendo video final",
    description: "Publicando el MP4 a UploadThing.",
  },
}

/**
 * Known typed failure modes for the burn pipeline.
 *
 * - `source_unavailable` — original_video asset or scrape_url 4xx/5xx.
 * - `whisper_timeout`    — Whisper transcription exceeded its budget.
 * - `translate_failed`   — Claude SRT translate returned invalid output.
 * - `ffmpeg_failed`      — burn or probe step crashed.
 * - `upload_failed`      — UploadThing rejected the final MP4.
 * - `generic_fallback`   — anything else; routes to the LLM translator.
 */
export const BURN_ERROR_CODES = [
  "source_unavailable",
  "whisper_timeout",
  "translate_failed",
  "ffmpeg_failed",
  "upload_failed",
  "generic_fallback",
] as const

export const BurnErrorCodeSchema = z.enum(BURN_ERROR_CODES)
export type BurnErrorCode = z.infer<typeof BurnErrorCodeSchema>

/**
 * Realtime metadata published by `translateAndBurnSubsTask` via
 * `metadata.set("phase", ...)`, consumed by the Paso 3 edit page.
 */
export const BurnProgressMetadataSchema = z.object({
  phase: z.enum(BURN_PHASES).optional(),
})

export type BurnProgressMetadata = z.infer<typeof BurnProgressMetadataSchema>
