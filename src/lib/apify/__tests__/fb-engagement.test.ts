/**
 * Engagement-extraction tests for `normalise` (FB Ad Library) — verifies
 * `startDate` projects onto the canonical `engagement.postedAt`. FB Ad
 * Library doesn't expose play/like counts at the API boundary, so
 * `postedAt` is the only signal we lift from FB rows.
 */

import { describe, expect, test } from "bun:test"

import { normalise } from "@/lib/apify/index.ts"

describe("normalise (facebook-ads-scraper) engagement extraction", () => {
  test("captures startDate as postedAt", () => {
    const out = normalise({
      adArchiveID: "1234567890",
      pageName: "JoySpring",
      snapshot: {
        videos: [{ videoHdUrl: "https://fb.cdn/video.mp4" }],
        body: { text: "Try our new supplement" },
      },
      startDate: "2025-03-15T00:00:00.000Z",
    })
    expect(out?.engagement).toEqual({ postedAt: "2025-03-15T00:00:00.000Z" })
  })

  test("omits engagement entirely when no signal fields are present", () => {
    const out = normalise({
      adArchiveID: "id-bare",
      snapshot: { videos: [{ videoHdUrl: "https://fb.cdn/x.mp4" }] },
    })
    expect(out?.engagement).toBeUndefined()
  })

  test("does not regress existing happy-path mapping", () => {
    const out = normalise({
      adArchiveID: "1234567890",
      pageName: "JoySpring",
      snapshot: {
        videos: [{ videoHdUrl: "https://fb.cdn/video.mp4" }],
        body: { text: "Try our new supplement" },
      },
    })
    expect(out?.ad_id).toBe("1234567890")
    expect(out?.video_url).toBe("https://fb.cdn/video.mp4")
    expect(out?.page_name).toBe("JoySpring")
    expect(out?.ad_text).toBe("Try our new supplement")
  })

  test("tolerates startDate=null without crashing", () => {
    const out = normalise({
      adArchiveID: "id-null",
      snapshot: { videos: [{ videoHdUrl: "https://fb.cdn/x.mp4" }] },
      startDate: null,
    })
    expect(out?.engagement).toBeUndefined()
  })
})
