/**
 * Engagement-extraction tests for `normalise` (FB Ad Library) — verifies
 * startDate / isActive / totalActiveTime / eu_total_reach project onto
 * the canonical EngagementSignals shape and `activeDays` is derived
 * from seconds via `toActiveDays`.
 */

import { describe, expect, test } from "bun:test"

import { normalise } from "@/lib/apify/index.ts"

describe("normalise (facebook-ads-scraper) engagement extraction", () => {
  test("captures startDate, isActive, totalActiveTime → activeDays, eu_total_reach", () => {
    const out = normalise({
      adArchiveID: "1234567890",
      pageName: "JoySpring",
      snapshot: {
        videos: [{ videoHdUrl: "https://fb.cdn/video.mp4" }],
        body: { text: "Try our new supplement" },
      },
      startDate: "2025-03-15T00:00:00.000Z",
      isActive: true,
      totalActiveTime: 86_400 * 12, // 12 days
      eu_total_reach: 50_000,
    })
    expect(out?.engagement).toEqual({
      postedAt: "2025-03-15T00:00:00.000Z",
      isActive: true,
      activeDays: 12,
      euTotalReach: 50_000,
    })
  })

  test("activeDays null/omitted when totalActiveTime is missing or zero", () => {
    const a = normalise({
      adArchiveID: "id-a",
      snapshot: { videos: [{ videoHdUrl: "https://fb.cdn/a.mp4" }] },
      isActive: false,
    })
    expect(a?.engagement?.activeDays).toBeUndefined()
    expect(a?.engagement?.isActive).toBe(false)

    const b = normalise({
      adArchiveID: "id-b",
      snapshot: { videos: [{ videoHdUrl: "https://fb.cdn/b.mp4" }] },
      totalActiveTime: 0,
    })
    expect(b?.engagement).toBeUndefined()
  })

  test("activeDays floors fractional day windows", () => {
    const out = normalise({
      adArchiveID: "id-frac",
      snapshot: { videos: [{ videoHdUrl: "https://fb.cdn/x.mp4" }] },
      totalActiveTime: 86_400 * 3 + 3_600, // 3 days + 1 hour
    })
    expect(out?.engagement?.activeDays).toBe(3)
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
      isActive: true,
    })
    expect(out?.engagement?.postedAt).toBeUndefined()
    expect(out?.engagement?.isActive).toBe(true)
  })
})
