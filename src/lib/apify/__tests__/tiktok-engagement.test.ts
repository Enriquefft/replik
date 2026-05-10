/**
 * Engagement-extraction tests for `normaliseTikTok` — verifies the
 * engagement block is populated for both numeric and human-formatted
 * counts, hashtags collapse to string[], and authorMeta projects onto
 * the canonical EngagementSignals shape.
 */

import { describe, expect, test } from "bun:test"

import { normaliseTikTok } from "@/lib/apify/tiktok.ts"

describe("normaliseTikTok engagement extraction", () => {
  test("captures numeric engagement counts", () => {
    const out = normaliseTikTok({
      id: "7531000000000000001",
      videoMeta: { downloadAddr: "https://tiktok.cdn/abc.mp4" },
      playCount: 120_000,
      diggCount: 5_400,
      shareCount: 800,
      commentCount: 230,
      createTimeISO: "2025-04-01T12:34:56.000Z",
    })
    expect(out?.engagement).toEqual({
      playCount: 120_000,
      likeCount: 5_400,
      shareCount: 800,
      commentCount: 230,
      postedAt: "2025-04-01T12:34:56.000Z",
    })
  })

  test("coerces human-formatted string counts (1.2M, 500K)", () => {
    const out = normaliseTikTok({
      id: "7531000000000000002",
      videoMeta: { downloadAddr: "https://tiktok.cdn/abc.mp4" },
      playCount: "1.2M",
      diggCount: "500K",
      shareCount: "1.5K",
    })
    expect(out?.engagement?.playCount).toBe(1_200_000)
    expect(out?.engagement?.likeCount).toBe(500_000)
    expect(out?.engagement?.shareCount).toBe(1_500)
  })

  test("captures hashtags as string[]", () => {
    const out = normaliseTikTok({
      id: "7531000000000000003",
      videoMeta: { downloadAddr: "https://tiktok.cdn/abc.mp4" },
      hashtags: [{ name: "skincare" }, { name: "perú" }],
    })
    expect(out?.engagement?.hashtags).toEqual(["skincare", "perú"])
  })

  test("captures authorMeta (uniqueId, verified)", () => {
    const out = normaliseTikTok({
      id: "7531000000000000004",
      videoMeta: { downloadAddr: "https://tiktok.cdn/abc.mp4" },
      authorMeta: {
        name: "joyspring_pe",
        nickName: "JoySpring Perú",
        uniqueId: "joyspring_pe",
        verified: true,
      },
    })
    expect(out?.engagement?.authorHandle).toBe("joyspring_pe")
    expect(out?.engagement?.authorVerified).toBe(true)
  })

  test("falls back to authorMeta.name for handle when uniqueId missing", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
      authorMeta: { name: "creator123" },
    })
    expect(out?.engagement?.authorHandle).toBe("creator123")
  })

  test("omits engagement entirely when no signal fields are present", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
    })
    expect(out?.engagement).toBeUndefined()
  })

  test("does not regress existing happy-path mapping", () => {
    const out = normaliseTikTok({
      id: "7531000000000000000",
      text: "Mira este suplemento para niños",
      videoMeta: { downloadAddr: "https://tiktok.cdn/abc.mp4" },
      authorMeta: { name: "joyspring_pe", nickName: "JoySpring Perú" },
      playCount: 999,
    })
    expect(out?.ad_id).toBe("7531000000000000000")
    expect(out?.video_url).toBe("https://tiktok.cdn/abc.mp4")
    expect(out?.page_name).toBe("JoySpring Perú")
    expect(out?.ad_text).toBe("Mira este suplemento para niños")
    expect(out?.engagement?.playCount).toBe(999)
  })
})
