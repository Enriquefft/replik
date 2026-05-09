import "server-only"

/**
 * Lane L3b — Apify wrapper · TikTok search.
 *
 * Companion to `searchFBAdsByKeyword`. The customer's manual flow checks
 * both Meta Ad Library AND TikTok before deciding what creative angles to
 * model. Same `RawCreative` shape so the calling pipeline can merge both
 * source pools through a single relevance + dedup path.
 *
 * Actor: `clockworks/tiktok-scraper`. We pass a single `searchQueries`
 * array, restrict to the video search section sorted by relevance, and
 * cap results at 20 per call. Country routing via `proxyCountryCode`.
 */

import { ApifyClient } from "apify-client"
import { z } from "zod"

import type { RawCreative } from "@/lib/apify"

const ACTOR_ID = "clockworks/tiktok-scraper"
const DEFAULT_COUNTRY = "PE"
const RUN_TIMEOUT_SECS = 300
const RESULT_CAP = 20
// Hard upper bound on per-run spend. clockworks/tiktok-scraper bills per
// dataset item; the 20-result cap × per-item charge is bounded below this
// ceiling. The SDK forwards `maxTotalChargeUsd` to the actor process.
const MAX_TOTAL_CHARGE_USD = 0.15

const NonEmpty = z.string().min(1)

const VideoMetaSchema = z.object({
  downloadAddr: NonEmpty.optional(),
  playAddr: NonEmpty.optional(),
})

const AuthorMetaSchema = z.object({
  name: NonEmpty.optional(),
  nickName: NonEmpty.optional(),
})

const TikTokItemSchema = z
  .object({
    id: NonEmpty.optional(),
    text: NonEmpty.optional(),
    webVideoUrl: NonEmpty.optional(),
    videoMeta: VideoMetaSchema.optional(),
    authorMeta: AuthorMetaSchema.optional(),
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

/**
 * Normalize a clockworks/tiktok-scraper item to the shared `RawCreative`
 * shape. Returns null when the item lacks an id or any usable video URL.
 *
 * Field mapping:
 *   ad_id     ← item.id
 *   page_name ← authorMeta.nickName ?? authorMeta.name (creator handle)
 *   video_url ← videoMeta.downloadAddr ?? videoMeta.playAddr
 *   ad_text   ← text (caption)
 */
export function normaliseTikTok(raw: unknown): RawCreative | null {
  const parsed = TikTokItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const id = item.id
  if (!id) return null
  const videoUrl = item.videoMeta?.downloadAddr ?? item.videoMeta?.playAddr
  if (!videoUrl) return null
  const out: RawCreative = { ad_id: id, video_url: videoUrl }
  const author = item.authorMeta?.nickName ?? item.authorMeta?.name
  if (author) out.page_name = author
  if (item.text) out.ad_text = item.text
  return out
}

/**
 * Run the public clockworks/tiktok-scraper actor for a single search
 * keyword. Returns up to 20 video creatives in the canonical `RawCreative`
 * shape. Caller fans out across the same query ladder used for FB; this
 * wrapper is one metered call per invocation.
 *
 * Spend is double-capped (`maxItems` + `maxTotalChargeUsd`). Throws on
 * credential or network failure; the Trigger task catches and treats as
 * an empty result.
 */
export async function searchTikTokByKeyword(keyword: string): Promise<RawCreative[]> {
  if (keyword.length === 0) return []

  const client = getClient()

  const run = await client.actor(ACTOR_ID).call(
    {
      searchQueries: [keyword],
      resultsPerPage: RESULT_CAP,
      searchSection: "/video",
      videoSearchSorting: "relevance",
      proxyCountryCode: DEFAULT_COUNTRY,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadMusicCovers: false,
    },
    {
      waitSecs: RUN_TIMEOUT_SECS,
      maxItems: RESULT_CAP,
      maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
    },
  )

  const dataset = client.dataset(run.defaultDatasetId)
  const { items } = await dataset.listItems({ limit: RESULT_CAP })

  const seen = new Set<string>()
  const results: RawCreative[] = []
  for (const item of items) {
    if (results.length >= RESULT_CAP) break
    const row = normaliseTikTok(item)
    if (!row) continue
    if (seen.has(row.ad_id)) continue
    seen.add(row.ad_id)
    results.push(row)
  }
  return results
}
