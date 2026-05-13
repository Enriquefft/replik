import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the publish-landing pipeline (Lane L4a). SSOT — the
 * orchestrator broadcasts these strings via `metadata.set("phase", …)`.
 */
export const PUBLISH_PHASES = [
  "picking_template",
  "shopify_publish",
  "generating_body",
  "picking_hero_video",
  "render",
  "apply_theme",
] as const

export type PublishPhase = (typeof PUBLISH_PHASES)[number]

/** Per-phase progress weight (sums to 100). Shopify + theme apply dominate. */
export const PUBLISH_PHASE_WEIGHTS: Record<PublishPhase, number> = {
  picking_template: 10,
  shopify_publish: 25,
  generating_body: 20,
  picking_hero_video: 10,
  render: 15,
  apply_theme: 20,
}

export const PUBLISH_PHASE_LABELS_ES: Record<PublishPhase, PhaseLabel> = {
  picking_template: {
    label: "Eligiendo plantilla",
    description: "Seleccionando el layout que mejor encaja con el producto.",
  },
  shopify_publish: {
    label: "Publicando en Shopify",
    description: "Creando el producto y la página en tu tienda.",
  },
  generating_body: {
    label: "Generando contenido",
    description: "Redactando beneficios y bloques de la landing.",
  },
  picking_hero_video: {
    label: "Eligiendo video principal",
    description: "Seleccionando el clip que abre la página.",
  },
  render: {
    label: "Renderizando plantilla",
    description: "Combinando texto, imágenes y video.",
  },
  apply_theme: {
    label: "Aplicando al tema",
    description: "Activando la plantilla sobre tu tema de Shopify.",
  },
}

/**
 * Known typed failure modes for the publish-landing pipeline.
 *
 * - `shopify_token_expired`  — long-lived token revoked / expired.
 * - `shopify_api_failure`    — Shopify admin API returned 5xx.
 * - `missing_creatives`      — no edited videos to pick a hero from.
 * - `landing_body_invalid`   — LLM body output failed schema validation.
 * - `template_render_failed` — handlebars-like render crashed.
 * - `integration_incomplete` — Shopify integration extras malformed.
 * - `generic_fallback`       — anything else; routes to the LLM translator.
 */
export const PUBLISH_ERROR_CODES = [
  "shopify_token_expired",
  "shopify_api_failure",
  "missing_creatives",
  "landing_body_invalid",
  "template_render_failed",
  "integration_incomplete",
  "generic_fallback",
] as const

export const PublishErrorCodeSchema = z.enum(PUBLISH_ERROR_CODES)
export type PublishErrorCode = z.infer<typeof PublishErrorCodeSchema>

/**
 * Realtime metadata published by `publishLandingTask`. Mirrors every
 * `metadata.set` site in the task body so the UI parses with Zod.
 */
export const PublishProgressMetadataSchema = z.object({
  phase: z.enum(PUBLISH_PHASES).optional(),
  templateId: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  storefrontUrl: z.string().url().optional(),
})

export type PublishProgressMetadata = z.infer<typeof PublishProgressMetadataSchema>
