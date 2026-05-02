/**
 * Fixture-driven tests for `normalise()` — the boundary between Apify's
 * loosely-typed `apify/facebook-ads-scraper` dataset items and the small
 * `RawCreative` shape consumed by `scrapeProduct`.
 *
 * Fixture: src/lib/apify/fixtures/normalise.json
 *   - Verified accept paths (HD, SD fallback, markup body fallback, top-level
 *     vs snapshot pageName, multi-video skip-empty).
 *   - Reject paths (missing adArchiveID, no video, non-object root).
 */

import { describe, expect, test } from "bun:test"
import fixtureData from "@/lib/apify/fixtures/normalise.json"
import { normalise } from "@/lib/apify/index.ts"

interface Case {
  name: string
  input: unknown
  expected: ReturnType<typeof normalise>
}

const cases = fixtureData as Case[]

describe("normalise (apify facebook-ads-scraper)", () => {
  test("fixture covers ≥9 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(9)
  })

  for (const c of cases) {
    test(c.name, () => {
      expect(normalise(c.input)).toEqual(c.expected)
    })
  }
})
