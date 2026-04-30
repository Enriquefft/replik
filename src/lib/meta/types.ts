import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Single source of truth for the Meta wrapper's public TypeScript types and
 * matching Zod schemas. The interface names mirror what L3a / L4b / L5 import
 * via `@/lib/meta`; renaming or dropping fields breaks them. Schemas are
 * exported alongside types so callers (and the wrapper itself) can validate
 * inputs with `zod` and we can derive runtime contracts from one place.
 */

import { z } from "zod"

// ---------- Credentials ----------

export const MetaCredsSchema = z.object({
  token: z.string().min(1),
  ad_account_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  pixel_id: z.string().min(1).optional(),
  /**
   * Optional internal user UUID. When present, calls hook
   * `markIntegrationExpired(userId, "meta")` on Meta error code 190.
   * Extends the contract from arquitectura.md so token-expiry can be a
   * pure side effect of the wrapper.
   */
  userId: z.string().min(1).optional(),
})
export type MetaCreds = z.infer<typeof MetaCredsSchema>

// ---------- Errors ----------

/**
 * Wrapper-level error. Wraps Meta's `{error: {code, error_subcode, message,
 * fbtrace_id}}` envelope into something with a friendly Spanish message.
 * `MetaAuthError` (in `accounts.ts`) is intentionally separate — it is the
 * public-facing surface used by the integrations form (P1).
 */
export class MetaError extends Error {
  readonly code: number
  readonly error_subcode: number | undefined
  readonly fbtrace_id: string | undefined
  readonly friendly: string

  constructor(args: {
    code: number
    error_subcode?: number | undefined
    fbtrace_id?: string | undefined
    friendly: string
    message?: string
  }) {
    super(args.message ?? args.friendly)
    this.name = "MetaError"
    this.code = args.code
    this.error_subcode = args.error_subcode
    this.fbtrace_id = args.fbtrace_id
    this.friendly = args.friendly
  }
}

// ---------- Ad Library ----------

export const AdLibrarySearchInputSchema = z.object({
  searchTerms: z.string().min(1),
  countries: z.array(z.string().length(2)).default(["PE"]),
  limit: z.number().int().min(1).max(100).default(20),
})
export type AdLibrarySearchInput = z.input<typeof AdLibrarySearchInputSchema>

export const AdLibraryAdSchema = z.object({
  ad_id: z.string(),
  page_name: z.string().optional(),
  page_id: z.string().optional(),
  ad_snapshot_url: z.url().optional(),
  ad_creative_bodies: z.array(z.string()).optional(),
  ad_creative_link_titles: z.array(z.string()).optional(),
  /** First scrape-ready video URL when available (FB CDN, expires). */
  video_url: z.url().optional(),
})
export type AdLibraryAd = z.infer<typeof AdLibraryAdSchema>

// ---------- Campaigns ----------

export const CampaignCreateInputSchema = z.object({
  name: z.string().min(1),
  objective: z.literal("OUTCOME_SALES"),
  status: z.enum(["PAUSED", "ACTIVE"]),
  daily_budget_cents: z.number().int().positive(),
  special_ad_categories: z.array(z.string()).default([]),
})
export type CampaignCreateInput = z.input<typeof CampaignCreateInputSchema>

export const CampaignSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
})
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>

export const CampaignListFilterSchema = z
  .object({
    status: z.array(z.string()).optional(),
  })
  .optional()
export type CampaignListFilter = z.infer<typeof CampaignListFilterSchema>

// ---------- Ad sets ----------

export const InterestSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type Interest = z.infer<typeof InterestSchema>

export const AdSetCreateInputSchema = z.object({
  campaign_id: z.string().min(1),
  name: z.string().min(1),
  daily_budget_cents: z.number().int().positive().optional(),
  optimization_goal: z.enum(["OFFSITE_CONVERSIONS", "PURCHASE"]),
  billing_event: z.literal("IMPRESSIONS"),
  promoted_object: z.object({
    pixel_id: z.string().min(1),
    custom_event_type: z.literal("PURCHASE"),
  }),
  targeting: z.object({
    geo_locations: z.object({ countries: z.array(z.string().length(2)) }),
    age_min: z.number().int().min(13).max(65).optional(),
    age_max: z.number().int().min(13).max(65).optional(),
    advantage_audience: z.union([z.literal(0), z.literal(1)]).optional(),
    flexible_spec: z.array(z.object({ interests: z.array(InterestSchema).optional() })).optional(),
  }),
  status: z.enum(["PAUSED", "ACTIVE"]),
})
export type AdSetCreateInput = z.input<typeof AdSetCreateInputSchema>

export const AdSetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
})
export type AdSetSummary = z.infer<typeof AdSetSummarySchema>

// ---------- Creatives ----------

export const CreativeCreateInputSchema = z.object({
  name: z.string().min(1),
  object_story_spec: z.object({
    page_id: z.string().min(1),
    video_data: z.object({
      video_id: z.string().min(1),
      image_hash: z.string().optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      call_to_action: z
        .object({
          type: z.string(),
          value: z.object({ link: z.url().optional() }).optional(),
        })
        .optional(),
    }),
  }),
})
export type CreativeCreateInput = z.input<typeof CreativeCreateInputSchema>

export const CreativeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type CreativeSummary = z.infer<typeof CreativeSummarySchema>

// ---------- Ads ----------

export const AdCreateInputSchema = z.object({
  adset_id: z.string().min(1),
  creative_id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["PAUSED", "ACTIVE"]),
})
export type AdCreateInput = z.input<typeof AdCreateInputSchema>

export const AdSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
})
export type AdSummary = z.infer<typeof AdSummarySchema>

// ---------- Uploads ----------

export const VideoUploadResultSchema = z.object({
  video_id: z.string(),
})
export type VideoUploadResult = z.infer<typeof VideoUploadResultSchema>

export const ImageUploadResultSchema = z.object({
  image_hash: z.string(),
  url: z.url(),
})
export type ImageUploadResult = z.infer<typeof ImageUploadResultSchema>

// ---------- Insights ----------

export const InsightsFilterSchema = z.object({
  level: z.enum(["campaign", "adset", "ad"]),
  ids: z.array(z.string().min(1)).min(1),
  date_preset: z.enum(["today", "yesterday", "last_7d", "last_30d"]).optional(),
})
export type InsightsFilter = z.input<typeof InsightsFilterSchema>

export const InsightSchema = z.object({
  object_id: z.string(),
  date_start: z.string(),
  date_stop: z.string(),
  spend_cents: z.number().int().nonnegative(),
  results: z.number().int().nonnegative(),
  cpa_cents: z.number().int().nonnegative().optional(),
  impressions: z.number().int().nonnegative(),
  ctr: z.number().nonnegative().optional(),
  roas: z.number().nonnegative().optional(),
})
export type Insight = z.infer<typeof InsightSchema>
