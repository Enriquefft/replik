/**
 * Tests for scrapeProductInfo — §7 four-stage scrape pipeline.
 *
 * Stage A is deterministic and is exercised entirely via the
 * `fixtures/scrape.json` table. Stage B (gapList + gate) and the
 * registrable-suffix helper run as plain unit tests. Stage C is mocked
 * through `MockLanguageModelV3` (injected via the `deps` arg on
 * `scrapeProductInfo`) so the test suite does NOT touch the network or
 * any LLM provider.
 *
 * Coverage:
 *   1. Fixture size guard: 30 rows.
 *   2. Stage A — fixture-driven: every row's `expected` partial matches.
 *   3. gapList: derives missing mandatory fields from a partial.
 *   4. registrableSuffix / sameRegistrableSuffix: PSL multi-label TLDs.
 *   5. classifyEntryShape: PDP path / JSON-LD product / non-PDP fallthrough.
 *   6. checkGate: PDP gate vs non-PDP gate (productName allowed null on
 *      non-PDP).
 *   7. scrapeProductInfo happy path (READY): mocked LLM + image-pick mocks
 *      return a valid `ProductFinalLLM`; carry-forward fields preserved
 *      from Stage A.
 *   8. scrapeProductInfo SCRAPE_PARTIAL: both LLM tries throw → fallback
 *      with status === "SCRAPE_PARTIAL" and the Stage A partial intact.
 *   9. SCRAPE_PARTIAL on bad LLM JSON twice (post-validate fallback).
 *  10. SCRAPE_PARTIAL with reason `"image-hallucination"` when LLM picks
 *      URLs not present in the candidate set.
 *  11. SCRAPE_PARTIAL with reason `"non-pdp-synthesis-failed"` when a
 *      non-PDP synthesised name leaks the brand string.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"
import { ProductPartialSchema } from "@/lib/ai/schemas.ts"
import {
  checkGate,
  classifyEntryShape,
  extractStageA,
  gapList,
  registrableSuffix,
  sameRegistrableSuffix,
  scrapeProductInfo,
} from "@/lib/ai/scrape.ts"

// ─── Fixture loader ──────────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "scrape.json")

const FixtureFileSchema = z.object({
  version: z.number(),
  rows: z.array(
    z.object({
      name: z.string(),
      url: z.url(),
      html: z.string(),
      expected: ProductPartialSchema,
      expectedGaps: z.array(z.enum(["imageUrls", "productName", "category"])),
    }),
  ),
})

const fixtureFile = FixtureFileSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")))

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeGenerateResult(object: unknown): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(object) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 50, text: 50, reasoning: undefined },
    },
    warnings: [],
  }
}

/**
 * Build a model that responds with a sequence of payloads — first call uses
 * payload[0], second call payload[1], etc. After the array is exhausted the
 * model echoes the last entry. This lets a single test handle both Stage C
 * and the image-pick downstream call (in that order).
 */
function modelReturning(payload: unknown): LanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => makeGenerateResult(payload),
  })
}

function modelSequence(payloads: unknown[]): LanguageModelV3 {
  let i = 0
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => {
      const idx = Math.min(i, payloads.length - 1)
      i++
      return makeGenerateResult(payloads[idx])
    },
  })
}

function throwingModel(): LanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { "image/*": [/.*/] },
    doGenerate: async () => {
      throw new Error("simulated LLM failure")
    },
  })
}

// ─── Fixture size guard ──────────────────────────────────────────────────────

describe("scrape fixture", () => {
  test("has exactly 30 rows", () => {
    expect(fixtureFile.rows).toHaveLength(30)
  })
})

// ─── Stage A — fixture-driven ────────────────────────────────────────────────

describe("extractStageA — fixture-driven", () => {
  for (const row of fixtureFile.rows) {
    test(`row "${row.name}" matches expected partial`, () => {
      const partial = extractStageA({ url: row.url, html: row.html })
      expect(partial).toEqual(row.expected)
    })
  }
})

// ─── classifyEntryShape ──────────────────────────────────────────────────────

describe("classifyEntryShape", () => {
  test("returns 'pdp' for /products/<slug> URL", () => {
    const shape = classifyEntryShape({
      url: "https://shop.example.com/products/widget",
      jsonLdProducts: [],
    })
    expect(shape).toBe("pdp")
  })

  test("returns 'pdp' for /p/<slug> URL", () => {
    const shape = classifyEntryShape({
      url: "https://shop.example.com/p/widget",
      jsonLdProducts: [],
    })
    expect(shape).toBe("pdp")
  })

  test("returns 'non_pdp' for bare host", () => {
    const shape = classifyEntryShape({
      url: "https://shop.example.com/",
      jsonLdProducts: [],
    })
    expect(shape).toBe("non_pdp")
  })

  test("returns 'non_pdp' for /collections/* URL", () => {
    const shape = classifyEntryShape({
      url: "https://shop.example.com/collections/all",
      jsonLdProducts: [],
    })
    expect(shape).toBe("non_pdp")
  })
})

// ─── Stage B — gap analysis + gating ────────────────────────────────────────

describe("checkGate — early validation", () => {
  test("PDP shape passes when imageUrls is non-empty and productName present", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: ["https://example.com/x.jpg"],
      productName: "Test Product",
      category: "kitchen",
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    const result = checkGate(partial, "pdp")
    expect(result.pass).toBe(true)
    expect(result.failReason).toBeUndefined()
  })

  test("fails with 'gate-no-image' when imageUrls is empty", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: [],
      productName: "Test Product",
      category: "kitchen",
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    const result = checkGate(partial, "pdp")
    expect(result.pass).toBe(false)
    expect(result.failReason).toBe("gate-no-image")
  })

  test("PDP fails with 'gate-no-product-name' when productName is null", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: ["https://example.com/x.jpg"],
      productName: null,
      category: "kitchen",
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    const result = checkGate(partial, "pdp")
    expect(result.pass).toBe(false)
    expect(result.failReason).toBe("gate-no-product-name")
  })

  test("non-PDP passes with productName=null (synthesis lives in Stage C)", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: ["https://example.com/x.jpg"],
      productName: null,
      category: "kitchen",
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    const result = checkGate(partial, "non_pdp")
    expect(result.pass).toBe(true)
  })

  test("passes even when category is null (soft gate)", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: ["https://example.com/x.jpg"],
      productName: "Test Product",
      category: null,
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    const result = checkGate(partial, "pdp")
    expect(result.pass).toBe(true)
    expect(result.failReason).toBeUndefined()
  })
})

describe("gapList — fixture-driven", () => {
  for (const row of fixtureFile.rows) {
    test(`row "${row.name}" derives the expected gaps`, () => {
      const gaps = gapList(row.expected)
      expect(gaps.sort()).toEqual([...row.expectedGaps].sort())
    })
  }

  test("returns empty when all three mandatory fields present", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: ["https://example.com/x.jpg"],
      productName: "X",
      category: "kitchen",
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    expect(gapList(partial)).toEqual([])
  })

  test("flags every mandatory field when all are null/empty", () => {
    const partial = ProductPartialSchema.parse({
      imageUrls: [],
      productName: null,
      category: null,
      priceText: null,
      description: null,
      locale: null,
      brand: null,
    })
    expect(gapList(partial).sort()).toEqual(["category", "imageUrls", "productName"])
  })
})

// ─── Registrable-suffix helper ───────────────────────────────────────────────

describe("registrableSuffix", () => {
  test("collapses subdomains down to the bare domain (.com)", () => {
    expect(registrableSuffix("shop.example.com")).toBe("example.com")
    expect(registrableSuffix("www.example.com")).toBe("example.com")
    expect(registrableSuffix("example.com")).toBe("example.com")
  })

  test("preserves multi-label TLDs (.com.pe, .co.uk, .com.mx, .com.br)", () => {
    expect(registrableSuffix("www.tienda.com.pe")).toBe("tienda.com.pe")
    expect(registrableSuffix("shop.example.co.uk")).toBe("example.co.uk")
    expect(registrableSuffix("ventas.demo.com.mx")).toBe("demo.com.mx")
    expect(registrableSuffix("loja.empresa.com.br")).toBe("empresa.com.br")
  })

  test("lowercases input", () => {
    expect(registrableSuffix("WWW.Example.COM")).toBe("example.com")
  })

  test("returns input verbatim for single-label hostnames", () => {
    expect(registrableSuffix("localhost")).toBe("localhost")
  })
})

describe("sameRegistrableSuffix", () => {
  test("returns true for sibling subdomains on .com", () => {
    expect(sameRegistrableSuffix("shop.example.com", "cdn.example.com")).toBe(true)
  })

  test("returns true for sibling subdomains on .com.pe", () => {
    expect(sameRegistrableSuffix("www.tienda.com.pe", "imagenes.tienda.com.pe")).toBe(true)
  })

  test("returns false for unrelated registrable domains", () => {
    expect(sameRegistrableSuffix("shop.example.com", "shop.attacker.com")).toBe(false)
  })

  test("returns false across multi-label TLDs", () => {
    expect(sameRegistrableSuffix("tienda.com.pe", "tienda.com.mx")).toBe(false)
  })
})

// ─── scrapeProductInfo — happy path with mocked Stage C ──────────────────────

describe("scrapeProductInfo — READY happy path (mocked LLM)", () => {
  // Use the JSON-LD fixture row that has all carry-forward fields populated.
  const seed = fixtureFile.rows.find((r) => r.name === "json-ld-full-product")
  if (!seed) throw new Error("seed fixture json-ld-full-product missing")

  const stageCOutput = {
    imageUrls: seed.expected.imageUrls,
    productName: seed.expected.productName,
    category: "kitchen" as const,
    brand: null,
    description: seed.expected.description,
    keywords: {
      broad: ["cafetera", "cafetera italiana", "moka"],
      narrow: [
        "cafetera italiana 6 tazas",
        "cafetera moka aluminio estufa",
        "cafetera italiana para gas",
      ],
    },
  }
  // Image-pick step always picks index 0 in this minimal fixture.
  const imagePickOutput = { selectedIndices: [0] }

  test("returns READY with merged ProductFinal — Stage A carry-forward preserved", async () => {
    // The pipeline calls Stage C first, then `pickProductImages` (vision).
    // Both share the same model handles, so we use a sequence so call 1 is
    // the Stage C JSON, calls 2..n are image-pick.
    const result = await scrapeProductInfo(
      { url: seed.url, html: seed.html },
      {
        primaryModel: modelSequence([stageCOutput, imagePickOutput]),
        bumpedModel: modelSequence([stageCOutput, imagePickOutput]),
      },
    )
    expect(result.status).toBe("READY")
    if (result.status === "READY") {
      expect(result.product.imageUrls).toEqual(seed.expected.imageUrls)
      expect(result.product.productName).toBe(seed.expected.productName ?? "")
      expect(result.product.category).toBe("kitchen")
      // Carry-forward fields come from Stage A:
      expect(result.product.priceText).toBe(seed.expected.priceText)
      expect(result.product.locale).toBe(seed.expected.locale)
      // Description now flows from the LLM, not Stage A — non-PDP path
      // could synthesise it, but here we feed the same value back.
      expect(result.product.description).toBe(seed.expected.description)
      // Keywords come from the LLM:
      expect(result.product.keywords.broad).toEqual(stageCOutput.keywords.broad)
      expect(result.product.keywords.narrow).toEqual(stageCOutput.keywords.narrow)
    }
  })
})

// ─── scrapeProductInfo — early gating ──────────────────────────────────────

describe("scrapeProductInfo — early gating (hard failures)", () => {
  test("SCRAPE_PARTIAL with 'gate-no-image' when Stage A finds no image", async () => {
    const emptyRow = fixtureFile.rows.find((r) => r.name === "empty-html-all-null")
    if (!emptyRow) throw new Error("seed fixture empty-html-all-null missing")
    const result = await scrapeProductInfo({
      url: emptyRow.url,
      html: emptyRow.html,
    })
    expect(result.status).toBe("SCRAPE_PARTIAL")
    if (result.status === "SCRAPE_PARTIAL") {
      expect(result.reason).toBe("gate-no-image")
    }
  })
})

// ─── scrapeProductInfo — SCRAPE_PARTIAL fallback paths ───────────────────────

describe("scrapeProductInfo — SCRAPE_PARTIAL fallback paths", () => {
  const seed = fixtureFile.rows.find((r) => r.name === "json-ld-full-product")
  if (!seed) throw new Error("seed fixture json-ld-full-product missing")

  test("both LLM tries throw → SCRAPE_PARTIAL with Stage A partial intact", async () => {
    const result = await scrapeProductInfo(
      { url: seed.url, html: seed.html },
      {
        primaryModel: throwingModel(),
        bumpedModel: throwingModel(),
      },
    )
    expect(result.status).toBe("SCRAPE_PARTIAL")
    if (result.status === "SCRAPE_PARTIAL") {
      expect(result.partial).toEqual(seed.expected)
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  test("both LLM tries return invalid output → SCRAPE_PARTIAL", async () => {
    const invalidOutput = {
      imageUrls: ["not-a-url"],
      productName: "",
      category: "electronics", // not in the InterestCategory enum
      brand: null,
      description: null,
      keywords: { broad: [], narrow: [] },
    }
    const result = await scrapeProductInfo(
      { url: seed.url, html: seed.html },
      {
        primaryModel: modelReturning(invalidOutput),
        bumpedModel: modelReturning(invalidOutput),
      },
    )
    expect(result.status).toBe("SCRAPE_PARTIAL")
    if (result.status === "SCRAPE_PARTIAL") {
      expect(result.partial).toEqual(seed.expected)
    }
  })

  test("LLM picks URL not in candidate set → SCRAPE_PARTIAL with 'image-hallucination'", async () => {
    const hallucinated = {
      imageUrls: ["https://hallucinated.example.com/x.jpg"],
      productName: seed.expected.productName,
      category: "kitchen" as const,
      brand: null,
      description: seed.expected.description,
      keywords: {
        broad: ["a", "b", "c"],
        narrow: ["aa aa aa", "bb bb bb", "cc cc cc"],
      },
    }
    const result = await scrapeProductInfo(
      { url: seed.url, html: seed.html },
      {
        primaryModel: modelReturning(hallucinated),
        bumpedModel: modelReturning(hallucinated),
      },
    )
    expect(result.status).toBe("SCRAPE_PARTIAL")
    if (result.status === "SCRAPE_PARTIAL") {
      expect(result.reason).toBe("image-hallucination")
    }
  })
})

// ─── Brand-clean post-validate (non-PDP synthesis guard) ─────────────────────

describe("scrapeProductInfo — brand-clean post-validate", () => {
  const homepageHtml = [
    "<html><head>",
    "<title>Florería Bloom — Delivery de flores en Lima</title>",
    '<meta property="og:title" content="Florería Bloom" />',
    '<meta property="og:image" content="https://cdn.bloom.example.com/hero.jpg" />',
    '<meta property="og:site_name" content="Florería Bloom" />',
    '</head><body><img src="https://cdn.bloom.example.com/hero.jpg"/></body></html>',
  ].join("")

  test("non-PDP synthesis containing brand → SCRAPE_PARTIAL 'non-pdp-synthesis-failed'", async () => {
    const leakyOutput = {
      imageUrls: ["https://cdn.bloom.example.com/hero.jpg"],
      productName: "Florería Bloom flores premium",
      category: "home_garden" as const,
      brand: "Florería Bloom",
      description: "Ramos artesanales para toda ocasión.",
      keywords: {
        broad: ["flores", "ramos", "delivery"],
        narrow: [
          "ramo de flores premium lima",
          "delivery de rosas en lima",
          "arreglo floral para regalo",
        ],
      },
    }
    const imagePickOutput = { selectedIndices: [0] }
    const result = await scrapeProductInfo(
      { url: "https://bloom.example.com/", html: homepageHtml },
      {
        primaryModel: modelSequence([leakyOutput, imagePickOutput]),
        bumpedModel: modelSequence([leakyOutput, imagePickOutput]),
      },
    )
    expect(result.status).toBe("SCRAPE_PARTIAL")
    if (result.status === "SCRAPE_PARTIAL") {
      expect(result.reason).toBe("non-pdp-synthesis-failed")
    }
  })

  test("non-PDP synthesis without brand leak → READY", async () => {
    const cleanOutput = {
      imageUrls: ["https://cdn.bloom.example.com/hero.jpg"],
      productName: "Ramo de flores premium",
      category: "home_garden" as const,
      brand: "Florería Bloom",
      description: "Arreglo artesanal para toda ocasión.",
      keywords: {
        broad: ["flores", "ramos", "delivery"],
        narrow: [
          "ramo de flores premium lima",
          "delivery de rosas en lima",
          "arreglo floral para regalo",
        ],
      },
    }
    const imagePickOutput = { selectedIndices: [0] }
    const result = await scrapeProductInfo(
      { url: "https://bloom.example.com/", html: homepageHtml },
      {
        primaryModel: modelSequence([cleanOutput, imagePickOutput]),
        bumpedModel: modelSequence([cleanOutput, imagePickOutput]),
      },
    )
    expect(result.status).toBe("READY")
    if (result.status === "READY") {
      expect(result.product.brand).toBe("Florería Bloom")
      expect(result.product.productName).toBe("Ramo de flores premium")
    }
  })
})
