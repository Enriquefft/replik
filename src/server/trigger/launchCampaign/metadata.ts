import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the campaign launch pipeline (Lane L4b). SSOT — the
 * orchestrator broadcasts these strings via `metadata.set("phase", …)`.
 */
export const LAUNCH_PHASES = [
  "copy",
  "upload_videos",
  "upload_image",
  "campaign",
  "adsets",
  "ads",
] as const

export type LaunchPhase = (typeof LAUNCH_PHASES)[number]

/** Per-phase progress weight (sums to 100). Video upload dominates wall-clock. */
export const LAUNCH_PHASE_WEIGHTS: Record<LaunchPhase, number> = {
  copy: 10,
  upload_videos: 35,
  upload_image: 10,
  campaign: 10,
  adsets: 15,
  ads: 20,
}

export const LAUNCH_PHASE_LABELS_ES: Record<LaunchPhase, PhaseLabel> = {
  copy: {
    label: "Generando copy",
    description: "Redactando titulares y descripciones por ángulo.",
  },
  upload_videos: {
    label: "Subiendo videos",
    description: "Empujando los creativos editados a Meta.",
  },
  upload_image: {
    label: "Subiendo thumbnail",
    description: "Cargando la imagen del producto a Meta.",
  },
  campaign: {
    label: "Creando campaña",
    description: "Definiendo objetivo y presupuesto diario.",
  },
  adsets: {
    label: "Creando ad sets",
    description: "Configurando segmentación e intereses.",
  },
  ads: {
    label: "Creando ads",
    description: "Ensamblando cada creativo con su copy.",
  },
}

/**
 * Known typed failure modes for the launch pipeline.
 *
 * - `meta_token_expired`       — Meta long-lived token expired.
 * - `meta_quota`               — Meta API rate-limited.
 * - `meta_policy`              — ad rejected by Meta policy.
 * - `meta_video_upload`        — video upload to Meta failed.
 * - `meta_image_upload`        — image upload to Meta failed.
 * - `missing_creatives`        — no edited videos available.
 * - `landing_not_published`    — publish-landing must run first.
 * - `integration_incomplete`   — missing pixel / ad_account / page_id.
 * - `generic_fallback`         — anything else; routes to the LLM translator.
 */
export const LAUNCH_ERROR_CODES = [
  "meta_token_expired",
  "meta_quota",
  "meta_policy",
  "meta_video_upload",
  "meta_image_upload",
  "missing_creatives",
  "landing_not_published",
  "integration_incomplete",
  "generic_fallback",
] as const

export const LaunchErrorCodeSchema = z.enum(LAUNCH_ERROR_CODES)
export type LaunchErrorCode = z.infer<typeof LaunchErrorCodeSchema>

/**
 * Realtime metadata published by `launchCampaign` via `metadata.set(...)`.
 * Mirrors the existing `metadata.set` call sites in the task body — every
 * key the orchestrator broadcasts is enumerated here so the UI parses
 * with Zod instead of trusting `run.metadata` blindly.
 *
 * `adsManagerUrl` is emitted on the final phase so the UI can render a
 * deep-link CTA to Meta's Ads Manager once the campaign id is known. The
 * URL includes `act={ad_account_id}` whenever the integration extra has
 * the account id; otherwise we fall back to a campaign-only deep link
 * that Meta resolves against the currently logged-in business.
 */
export const LaunchProgressMetadataSchema = z.object({
  phase: z.enum(LAUNCH_PHASES).optional(),
  videosTotal: z.number().int().nonnegative().optional(),
  videosUploaded: z.number().int().nonnegative().optional(),
  adsCreated: z.number().int().nonnegative().optional(),
  adsManagerUrl: z.url().optional(),
})

export type LaunchProgressMetadata = z.infer<typeof LaunchProgressMetadataSchema>
