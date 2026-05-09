import "server-only"

/**
 * Hostname of the Apify Key-Value Store API. The TikTok scraper
 * (clockworks/tiktok-scraper, run with `shouldDownloadVideos: true`)
 * rehosts videos there and emits URLs of the form
 * `https://api.apify.com/v2/key-value-stores/<id>/records/<key>.mp4`.
 * Records are private — anonymous fetch returns HTTP 403.
 *
 * Two server-only access patterns:
 *   1. `withApifyTokenIfKv(url)` — append `?token=<APIFY_TOKEN>` for
 *      callers that can only pass a URL (Whisper fetch, UploadThing
 *      `uploadFilesFromUrl`).
 *   2. The preview-proxy route at `/api/creative-preview/[id]` — uses
 *      `Authorization: Bearer <APIFY_TOKEN>` instead of a query-string
 *      token, so nothing token-bearing is ever exposed to the browser.
 *
 * Both paths import `APIFY_KVS_HOSTNAME` to keep the host check in one
 * place.
 */
export const APIFY_KVS_HOSTNAME = "api.apify.com"

/**
 * Append `?token=<APIFY_TOKEN>` to URLs whose host is the Apify KV
 * Store. Other hosts (fbcdn, etc.) pass through unchanged — they're
 * publicly fetchable and don't accept the token.
 *
 * Server-only: never call from a client component; never persist the
 * returned URL anywhere reachable by the browser.
 */
export function withApifyTokenIfKv(rawUrl: string): string {
  const token = process.env.APIFY_TOKEN
  if (token === undefined || token.length === 0) {
    throw new Error("APIFY_TOKEN is not set")
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  if (parsed.hostname !== APIFY_KVS_HOSTNAME) return rawUrl
  parsed.searchParams.set("token", token)
  return parsed.toString()
}
