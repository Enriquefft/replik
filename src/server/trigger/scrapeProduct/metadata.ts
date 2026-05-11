import { z } from "zod"

import type { PhaseLabel } from "@/lib/phase.ts"

/**
 * Phase IDs for the scrape pipeline. SSOT — the orchestrator broadcasts
 * exactly these strings via `metadata.set("phase", …)` and the UI rail
 * derives its order/weights from this tuple.
 */
export const SCRAPE_PHASES = [
  "scraping",
  "finding_ads",
  "relevance_gating",
  "transcribing",
  "classifying",
] as const

export type ScrapePhase = (typeof SCRAPE_PHASES)[number]

/**
 * Per-phase contribution to the progress bar (0-100, sums to 100). The
 * weights mirror typical wall-clock cost: ladder + transcribe dominate.
 */
export const SCRAPE_PHASE_WEIGHTS: Record<ScrapePhase, number> = {
  scraping: 10,
  finding_ads: 30,
  relevance_gating: 10,
  transcribing: 40,
  classifying: 10,
}

/**
 * Spanish UI strings for the phase rail + status line. LLM narration is
 * Phase D — these are hardcoded copy.
 */
export const SCRAPE_PHASE_LABELS_ES: Record<ScrapePhase, PhaseLabel> = {
  scraping: {
    label: "Producto",
    description: "Extrayendo nombre, imagen, categoría y keywords.",
  },
  finding_ads: {
    label: "Anuncios",
    description: "Buscando creativos en Meta Ad Library y TikTok.",
  },
  relevance_gating: {
    label: "Relevancia",
    description: "Descartando spam y categorías no relacionadas.",
  },
  transcribing: {
    label: "Transcripción",
    description: "Whisper está leyendo el audio de cada anuncio.",
  },
  classifying: {
    label: "Ángulos",
    description: "Clasificando ángulos creativos por mayoría.",
  },
}

/**
 * Known typed failure modes for the scrape pipeline. Used by
 * `translateError` to short-circuit the LLM fallback for codes we know
 * how to phrase deterministically.
 *
 * - `apify_quota`         — Apify rate-limited or out of credits.
 * - `target_unreachable`  — competitor URL blocked / 4xx / 5xx.
 * - `whisper_timeout`     — Whisper API call exceeded its budget.
 * - `video_oversize`      — every candidate ad's video exceeded 25 MB.
 * - `no_keywords`         — Stage A/B produced an empty keyword set.
 * - `no_ads`              — query ladder returned zero usable creatives.
 * - `generic_fallback`    — anything else; routes to the LLM translator.
 */
export const SCRAPE_ERROR_CODES = [
  "apify_quota",
  "target_unreachable",
  "whisper_timeout",
  "video_oversize",
  "no_keywords",
  "no_ads",
  "generic_fallback",
] as const

export const ScrapeErrorCodeSchema = z.enum(SCRAPE_ERROR_CODES)
export type ScrapeErrorCode = z.infer<typeof ScrapeErrorCodeSchema>

export const ScrapeProgressMetadataSchema = z.object({
  phase: z.enum(SCRAPE_PHASES),
  ads_fetched: z.number().int().nonnegative().optional(),
  ads_total: z.number().int().nonnegative().optional(),
  transcribed: z.number().int().nonnegative().optional(),
  classified: z.number().int().nonnegative().optional(),
  // Apify ladder progress — emitted per ladder step inside findAds() so the UI
  // can show "trying keyword K (n/m)" instead of a 3-5 min static spinner.
  ladder_total: z.number().int().nonnegative().optional(),
  ladder_done: z.number().int().nonnegative().optional(),
  ladder_current_keyword: z.string().optional(),
  // Stage A signals — populated as soon as the scraper sees the page.
  productName: z.string().optional(),
  imageUrls: z.array(z.url()).optional(),
  keywords: z.array(z.string()).optional(),
})

export type ScrapeProgressMetadata = z.infer<typeof ScrapeProgressMetadataSchema>
