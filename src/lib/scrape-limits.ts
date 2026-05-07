/**
 * Shared scrape-pipeline limits. Lives outside `server-only` modules so the
 * progress UI can import them for skeleton sizing without dragging Trigger.dev
 * imports into the client bundle.
 */

export const MAX_ADS = 20

/**
 * Pre-filter ceiling for ad discovery. Meta Ad Library substring matching
 * surfaces unrelated mass spenders (DramaBox-class), so we over-fetch and
 * let the blocklist + LLM relevance gate trim back to `MAX_ADS`. Bounded by
 * the Meta API per-call cap (100).
 */
export const MAX_ADS_FETCH = 50
