/**
 * Shared scrape-pipeline limits. Lives outside `server-only` modules so the
 * progress UI can import them for skeleton sizing without dragging Trigger.dev
 * imports into the client bundle.
 */

export const MAX_ADS = 20
