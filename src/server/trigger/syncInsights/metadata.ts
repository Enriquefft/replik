import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the insights sync pipeline. SSOT.
 *
 * The task is mostly a linear API → upsert loop, but the UI needs a
 * per-product progress shape: `{ current: productId, done: n, total: m }`
 * so the dashboard can show "Sincronizando X de Y". Phases mirror that
 * shape rather than wall-clock segments.
 */
export const SYNC_INSIGHTS_PHASES = ["loading", "fetching", "upserting"] as const

export type SyncInsightsPhase = (typeof SYNC_INSIGHTS_PHASES)[number]

/** Per-phase progress weight (sums to 100). Meta fetch dominates. */
export const SYNC_INSIGHTS_PHASE_WEIGHTS: Record<SyncInsightsPhase, number> = {
  loading: 10,
  fetching: 60,
  upserting: 30,
}

export const SYNC_INSIGHTS_PHASE_LABELS_ES: Record<SyncInsightsPhase, PhaseLabel> = {
  loading: {
    label: "Preparando consulta",
    description: "Cargando campañas y ads activos.",
  },
  fetching: {
    label: "Consultando Meta",
    description: "Trayendo métricas de los últimos 7 días.",
  },
  upserting: {
    label: "Guardando resultados",
    description: "Actualizando spend, CPA y ROAS por anuncio.",
  },
}

/**
 * Known typed failure modes for the insights sync pipeline.
 *
 * - `meta_token_expired` — Meta long-lived token expired.
 * - `meta_quota`         — Meta API rate-limited.
 * - `meta_api_failure`   — Meta /insights returned 5xx.
 * - `no_active_ads`      — nothing to sync (empty result, not an error).
 * - `generic_fallback`   — anything else; routes to the LLM translator.
 */
export const SYNC_INSIGHTS_ERROR_CODES = [
  "meta_token_expired",
  "meta_quota",
  "meta_api_failure",
  "no_active_ads",
  "generic_fallback",
] as const

export const SyncInsightsErrorCodeSchema = z.enum(SYNC_INSIGHTS_ERROR_CODES)
export type SyncInsightsErrorCode = z.infer<typeof SyncInsightsErrorCodeSchema>

/**
 * Per-product progress block. The UI uses `done / total` for the bar,
 * `current` for the active row highlight on the dashboard, and
 * `currentName` for the Spanish status line ("Sincronizando 3 de 7
 * productos · Nike Pegasus").
 */
export const SyncInsightsProductProgressSchema = z.object({
  current: z.uuid().optional(),
  currentName: z.string().min(1).max(200).optional(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

export type SyncInsightsProductProgress = z.infer<typeof SyncInsightsProductProgressSchema>

/**
 * Realtime metadata published by `syncInsights`. Phase B will wire
 * `metadata.set` against this shape so the UI parses with Zod.
 */
export const SyncInsightsProgressMetadataSchema = z.object({
  phase: z.enum(SYNC_INSIGHTS_PHASES).optional(),
  product: SyncInsightsProductProgressSchema.optional(),
})

export type SyncInsightsProgressMetadata = z.infer<typeof SyncInsightsProgressMetadataSchema>
