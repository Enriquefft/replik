import "server-only"

/**
 * Lane L3a — Apify wrapper · Facebook Ads Library scraper.
 *
 * Primary today: Meta Ad Library API is unconfigured by policy, so this
 * actor (`apify/facebook-ads-scraper`) carries the L3 search lane.
 * Drives synchronously via `actor.call()` and pulls dataset items.
 *
 * Caller contract: pass keywords; we build PE Ad Library URLs, run the
 * actor, filter to items that have a video, and normalise to the small
 * `RawCreative` shape that `scrapeProduct` consumes.
 */

import { ApifyClient } from "apify-client"
import { z } from "zod"

const ACTOR_ID = "apify/facebook-ads-scraper"
const DEFAULT_COUNTRY = "PE"
const RUN_TIMEOUT_SECS = 300
const RESULT_CAP = 20

export interface RawCreative {
  ad_id: string
  page_name?: string
  video_url?: string
  ad_text?: string
}

const NonEmpty = z.string().min(1)

const VideoSchema = z.object({
  videoHdUrl: NonEmpty.optional(),
  videoSdUrl: NonEmpty.optional(),
})

const BodySchema = z.object({
  text: NonEmpty.optional(),
  markup: NonEmpty.optional(),
})

const SnapshotSchema = z.object({
  pageName: NonEmpty.optional(),
  videos: z.array(VideoSchema).optional(),
  body: BodySchema.optional(),
})

const ApifyAdItemSchema = z
  .object({
    adArchiveID: NonEmpty.optional(),
    pageName: NonEmpty.optional(),
    snapshot: SnapshotSchema.optional(),
  })
  .passthrough()

let cachedClient: ApifyClient | undefined

function getClient(): ApifyClient {
  if (cachedClient) return cachedClient
  const token = process.env.APIFY_TOKEN
  if (!token) {
    throw new Error("APIFY_TOKEN is not set")
  }
  cachedClient = new ApifyClient({ token })
  return cachedClient
}

function buildSearchUrl(keyword: string): string {
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: DEFAULT_COUNTRY,
    media_type: "video",
    q: keyword,
    search_type: "keyword_unordered",
  })
  return `https://www.facebook.com/ads/library/?${params.toString()}`
}

export function normalise(raw: unknown): RawCreative | null {
  const parsed = ApifyAdItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const adId = item.adArchiveID
  if (!adId) return null
  const firstVideo = item.snapshot?.videos?.find((v) => v.videoHdUrl ?? v.videoSdUrl)
  const videoUrl = firstVideo?.videoHdUrl ?? firstVideo?.videoSdUrl
  if (!videoUrl) return null
  const out: RawCreative = { ad_id: adId, video_url: videoUrl }
  const pageName = item.pageName ?? item.snapshot?.pageName
  if (pageName) out.page_name = pageName
  const body = item.snapshot?.body
  const adText = body?.text ?? body?.markup
  if (adText) out.ad_text = adText
  return out
}

/**
 * Run the public Facebook Ads Library actor against a list of keywords and
 * return up to 20 video creatives. Throws on credential or network failure;
 * the Trigger task catches and treats as an empty result.
 */
export async function searchFBAdsByKeywords(keywords: string[]): Promise<RawCreative[]> {
  if (keywords.length === 0) return []

  const client = getClient()
  const urls = keywords.slice(0, 5).map((kw) => ({ url: buildSearchUrl(kw) }))

  const run = await client.actor(ACTOR_ID).call(
    {
      startUrls: urls,
      resultsLimit: RESULT_CAP,
    },
    { waitSecs: RUN_TIMEOUT_SECS },
  )

  const dataset = client.dataset(run.defaultDatasetId)
  const { items } = await dataset.listItems({ limit: RESULT_CAP * 2 })

  const seen = new Set<string>()
  const results: RawCreative[] = []
  for (const item of items) {
    if (results.length >= RESULT_CAP) break
    const row = normalise(item)
    if (!row) continue
    if (seen.has(row.ad_id)) continue
    seen.add(row.ad_id)
    results.push(row)
  }
  return results
}
