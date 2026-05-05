import { z } from "zod"

export const SCRAPE_PHASES = ["scraping", "finding_ads", "transcribing", "classifying"] as const

export const ScrapeProgressMetadataSchema = z.object({
  phase: z.enum(SCRAPE_PHASES),
  ads_total: z.number().int().nonnegative().optional(),
  transcribed: z.number().int().nonnegative().optional(),
  classified: z.number().int().nonnegative().optional(),
  // Stage A signals — populated as soon as the scraper sees the page.
  productName: z.string().optional(),
  imageUrl: z.url().optional(),
  keywords: z.array(z.string()).optional(),
})

export type ScrapePhase = (typeof SCRAPE_PHASES)[number]
export type ScrapeProgressMetadata = z.infer<typeof ScrapeProgressMetadataSchema>
