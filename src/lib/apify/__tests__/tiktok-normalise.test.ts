/**
 * Fixture-free tests for `normaliseTikTok()` — the boundary between
 * clockworks/tiktok-scraper dataset items and the shared `RawCreative`
 * shape. Inline cases keep the schema-mapping rules visible at review time.
 */

import { describe, expect, test } from "bun:test"
import { normaliseTikTok } from "@/lib/apify/tiktok.ts"

describe("normaliseTikTok", () => {
  test("happy path → maps id, downloadAddr, authorMeta.nickName, text", () => {
    const out = normaliseTikTok({
      id: "7531000000000000000",
      text: "Mira este suplemento para niños 💪",
      videoMeta: {
        downloadAddr: "https://tiktok.cdn/abc.mp4",
      },
      authorMeta: {
        name: "joyspring_pe",
        nickName: "JoySpring Perú",
      },
    })
    // authorHandle falls back to authorMeta.name when uniqueId is absent —
    // dedicated coverage in `tiktok-engagement.test.ts`. Assert each
    // top-level field individually so this test stays focused on
    // base-mapping rules and additive engagement growth doesn't break it.
    expect(out?.ad_id).toBe("7531000000000000000")
    expect(out?.video_url).toBe("https://tiktok.cdn/abc.mp4")
    expect(out?.page_name).toBe("JoySpring Perú")
    expect(out?.ad_text).toBe("Mira este suplemento para niños 💪")
  })

  test("falls back to playAddr when downloadAddr missing", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { playAddr: "https://tiktok.cdn/play.mp4" },
    })
    expect(out?.video_url).toBe("https://tiktok.cdn/play.mp4")
  })

  test("falls back to authorMeta.name when nickName missing", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
      authorMeta: { name: "creator123" },
    })
    expect(out?.page_name).toBe("creator123")
  })

  test("rejects when id missing", () => {
    expect(
      normaliseTikTok({
        videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
      }),
    ).toBe(null)
  })

  test("rejects when no video URL at all", () => {
    expect(
      normaliseTikTok({
        id: "abc",
        text: "no video",
      }),
    ).toBe(null)
  })

  test("rejects non-object root", () => {
    expect(normaliseTikTok(null)).toBe(null)
    expect(normaliseTikTok("string")).toBe(null)
    expect(normaliseTikTok(42)).toBe(null)
  })

  test("omits page_name when authorMeta is absent", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
    })
    expect(out).toEqual({
      ad_id: "abc",
      video_url: "https://tiktok.cdn/x.mp4",
    })
  })

  test("omits ad_text when text is absent or empty", () => {
    const out = normaliseTikTok({
      id: "abc",
      videoMeta: { downloadAddr: "https://tiktok.cdn/x.mp4" },
    })
    expect(out?.ad_text).toBeUndefined()
  })
})
