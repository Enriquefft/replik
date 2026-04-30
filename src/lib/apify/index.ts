import "server-only"

/**
 * Lane L3a — Apify wrapper · Facebook Ads Library scraper.
 *
 * Fallback path for when `meta.adLibrarySearch` returns nothing or throws.
 * We drive the public actor `apify/facebook-ads-library-scraper` (the
 * actively maintained version) synchronously via `actor.call()` and pull
 * the dataset items.
 *
 * Caller contract: pass keywords; we build PE Ad Library URLs, run the
 * actor, filter to items that have a video, and normalise to the small
 * `RawCreative` shape that `scrapeProduct` consumes.
 */

import { ApifyClient } from "apify-client"

const ACTOR_ID = "apify/facebook-ads-library-scraper"
const DEFAULT_COUNTRY = "PE"
const RUN_TIMEOUT_SECS = 300
const RESULT_CAP = 20

export interface RawCreative {
  ad_id: string
  page_name?: string
  video_url?: string
  ad_text?: string
}

type ApifyAdItem = Record<string, unknown>

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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function videoFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (const entry of value) {
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>
      const url = asString(e.video_hd_url) ?? asString(e.video_sd_url) ?? asString(e.url)
      if (url) return url
    }
  }
  return undefined
}

function pickVideoUrl(item: ApifyAdItem): string | undefined {
  const direct = asString(item.video_url) ?? asString(item.videoUrl)
  if (direct) return direct
  const fromArr = videoFromArray(item.videos)
  if (fromArr) return fromArr
  const snapshot = item.snapshot
  if (snapshot && typeof snapshot === "object") {
    const snapVideos = (snapshot as Record<string, unknown>).videos
    const fromSnap = videoFromArray(snapVideos)
    if (fromSnap) return fromSnap
  }
  return undefined
}

function pickAdText(item: ApifyAdItem): string | undefined {
  const direct = asString(item.body) ?? asString(item.text)
  if (direct) return direct
  const bodies = item.ad_creative_bodies
  if (Array.isArray(bodies)) {
    const first = bodies.find((b): b is string => typeof b === "string" && b.length > 0)
    if (first) return first
  }
  return undefined
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

function normalise(item: ApifyAdItem): RawCreative | null {
  const adId = asString(item.ad_archive_id) ?? asString(item.adArchiveId)
  if (!adId) return null
  const videoUrl = pickVideoUrl(item)
  if (!videoUrl) return null
  const out: RawCreative = { ad_id: adId, video_url: videoUrl }
  const pageName = asString(item.page_name) ?? asString(item.pageName)
  if (pageName) out.page_name = pageName
  const adText = pickAdText(item)
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
      urls,
      count: RESULT_CAP,
      scrapeAdDetails: false,
      proxy: { useApifyProxy: true },
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
