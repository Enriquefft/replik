import { z } from "zod"

export const SCRAPE_PHASES = [
  "scraping",
  "finding_ads",
  "relevance_gating",
  "transcribing",
  "classifying",
] as const

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

export type ScrapePhase = (typeof SCRAPE_PHASES)[number]
export type ScrapeProgressMetadata = z.infer<typeof ScrapeProgressMetadataSchema>
