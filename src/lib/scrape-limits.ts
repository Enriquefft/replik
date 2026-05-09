/**
 * Shared scrape-pipeline limits. Lives outside `server-only` modules so the
 * progress UI can import them for skeleton sizing without dragging Trigger.dev
 * imports into the client bundle.
 */

export const MAX_ADS = 20

/**
 * Pre-filter ceiling for ad discovery. Both Meta Ad Library substring
 * matching and Apify keyword search surface unrelated mass spenders
 * (DramaBox-class), so we over-fetch and let the blocklist + LLM
 * relevance gate + URL dedup trim back to `MAX_ADS`. Apify is the
 * de-facto primary path (Meta OAuth token broken at the integration
 * level), so this ceiling effectively governs Apify accumulation across
 * `APIFY_MAX_KEYWORDS` keyword calls.
 */
export const MAX_ADS_FETCH = 50
