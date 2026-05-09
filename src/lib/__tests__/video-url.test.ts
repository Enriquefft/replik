import { describe, expect, test } from "bun:test"
import { normalizeVideoUrl } from "@/lib/video-url.ts"

describe("normalizeVideoUrl", () => {
  test("ignores query-string auth token churn", () => {
    const a =
      "https://video-atl3-1.xx.fbcdn.net/o1/v/t2/f2/m69/AQP90lpmdoUJ9xD1.mp4?oh=00_Af6abc&oe=6A054C77"
    const b =
      "https://video-atl3-1.xx.fbcdn.net/o1/v/t2/f2/m69/AQP90lpmdoUJ9xD1.mp4?oh=00_Af9zzz&oe=6A111111"
    expect(normalizeVideoUrl(a)).toBe(normalizeVideoUrl(b))
  })

  test("ignores CDN shard rotation when filename is identical", () => {
    const shardA = "https://video-atl3-1.xx.fbcdn.net/o1/v/t2/f2/m69/AQOWxGnds4T0.mp4"
    const shardB = "https://video-den2-1.xx.fbcdn.net/o1/v/t2/f2/m366/AQOWxGnds4T0.mp4"
    expect(normalizeVideoUrl(shardA)).toBe(normalizeVideoUrl(shardB))
  })

  test("preserves identity for genuinely different filenames", () => {
    const a = "https://video.example.com/path/aaa.mp4"
    const b = "https://video.example.com/path/bbb.mp4"
    expect(normalizeVideoUrl(a)).not.toBe(normalizeVideoUrl(b))
  })

  test("normalization is case-insensitive", () => {
    const a = "https://cdn.example.com/Path/Video.MP4"
    const b = "https://cdn.example.com/path/video.mp4"
    expect(normalizeVideoUrl(a)).toBe(normalizeVideoUrl(b))
  })

  test("malformed URL falls back to lowercased input without throwing", () => {
    expect(() => normalizeVideoUrl("not a url at all")).not.toThrow()
    expect(normalizeVideoUrl("Not A URL")).toBe("not a url")
  })

  test("returns the basename, not the full path", () => {
    const url = "https://cdn.example.com/a/b/c/d/asset123.mp4"
    expect(normalizeVideoUrl(url)).toBe("asset123.mp4")
  })
})
