import "server-only"

/**
 * Server-side reachability probe used by `/new` and the inline retry-with-edit
 * before any DB row is inserted. Same `User-Agent` and `Accept` headers as the
 * Stage A scraper (`src/lib/ai/scrape.ts`) so the probe and the real scrape
 * see the page identically — a 200 here means Stage A will at least see HTML.
 */

import type { ScrapeReasonCode } from "@/lib/scrape-reason.ts"

const PROBE_TIMEOUT_MS = 6_000

const PROBE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; ReplikScraper/1.0; +https://usereplik.com)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

/**
 * Subset of `ScrapeReasonCode` the probe can emit. Kept narrow on purpose —
 * scrape-pipeline-only codes (`stage-c-failed`, `no-keywords`, …) never come
 * out of here.
 */
export type ProbeFailureCode = Extract<
  ScrapeReasonCode,
  | "invalid-url"
  | "entry-fetch-failed"
  | "entry-fetch-http-4xx"
  | "entry-fetch-http-5xx"
  | "non-html"
>

export type ProbeResult =
  | { ok: true; finalUrl: string }
  | { ok: false; reason: ProbeFailureCode; status?: number }

/**
 * Probe a URL. Resolves once response headers arrive and aborts the body —
 * we only inspect status + content-type. Returns a typed failure code on any
 * problem; never throws.
 */
export async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "invalid-url" }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-url" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: PROBE_HEADERS,
    })

    if (response.status >= 500) {
      return { ok: false, reason: "entry-fetch-http-5xx", status: response.status }
    }
    if (response.status >= 400) {
      return { ok: false, reason: "entry-fetch-http-4xx", status: response.status }
    }

    const contentType = response.headers.get("content-type")
    if (contentType !== null && contentType.length > 0 && !isHtmlContentType(contentType)) {
      return { ok: false, reason: "non-html", status: response.status }
    }

    return { ok: true, finalUrl: response.url.length > 0 ? response.url : parsed.toString() }
  } catch {
    // DNS failure, connection refused, abort timeout — Node throws TypeError
    // for the first two and AbortError for timeout. Both collapse to the same
    // user-facing code: the URL didn't load.
    return { ok: false, reason: "entry-fetch-failed" }
  } finally {
    clearTimeout(timer)
    // Drain the body if the fetch did succeed — otherwise the connection
    // can leak. Cheap because the controller may already have aborted.
    controller.abort()
  }
}

function isHtmlContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase().trim()
  return lower.startsWith("text/html") || lower.startsWith("application/xhtml")
}
