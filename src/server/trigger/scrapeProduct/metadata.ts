import { z } from "zod"

export const SCRAPE_PHASES = ["scraping", "finding_ads", "transcribing", "classifying"] as const

export const ScrapeProgressMetadataSchema = z.object({
  phase: z.enum(SCRAPE_PHASES),
  ads_total: z.number().int().nonnegative().optional(),
  transcribed: z.number().int().nonnegative().optional(),
  classified: z.number().int().nonnegative().optional(),
})

export type ScrapePhase = (typeof SCRAPE_PHASES)[number]
export type ScrapeProgressMetadata = z.infer<typeof ScrapeProgressMetadataSchema>
