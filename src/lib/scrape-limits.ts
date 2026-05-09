/**
 * Shared scrape-pipeline limits. Lives outside `server-only` modules so the
 * progress UI can import them for skeleton sizing without dragging Trigger.dev
 * imports into the client bundle.
 */

export const MAX_ADS = 20

/**
 * Pre-filter ceiling for ad discovery. Apify keyword search surfaces
 * unrelated mass spenders (DramaBox-class), so we over-fetch and let the
 * blocklist + LLM relevance gate + URL dedup trim back to `MAX_ADS`. Apify
 * is the sole creative source today; this ceiling governs accumulation
 * across `APIFY_MAX_QUERIES` ladder steps and is the circuit-breaker
 * threshold (the ladder stops walking tiers once we hit it).
 */
export const MAX_ADS_FETCH = 50
