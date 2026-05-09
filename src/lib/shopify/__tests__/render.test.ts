/**
 * Render tests for the new Phase 2 hero contract.
 *
 * Covers:
 *   1. Token substitution: `hero_image_urls_csv` and `hero_video_url` make
 *      it from `TemplateVars` into the rendered `custom_liquid` blob.
 *   2. Removed-token guard: the old `video_urls_csv` / `product_image_url`
 *      tokens no longer appear in any rendered template.
 *   3. Liquid pass-through: identifiers internal to the hero template
 *      (`replik_hero_imgs`, `replik_hero_main`, `replik_hero_video`, `u`,
 *      `img`) survive token substitution intact for Shopify to render.
 *   4. Stacked layout markup: required CSS classes are present in the
 *      hero `custom_liquid`.
 *   5. No raw template tokens leak past substitution: there is no `{{x}}`
 *      with a key that lives in `TemplateVars` left in the rendered output
 *      (Liquid identifiers are allowed to stay).
 */

import { describe, expect, test } from "bun:test"

import { renderTemplate, type TemplateVars } from "@/lib/shopify/render.ts"
import type { TemplateId } from "@/lib/shopify/templates"
import { loadTemplate } from "@/lib/shopify/templates"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildVars(overrides: Partial<TemplateVars> = {}): TemplateVars {
  return {
    title: "Set de ollas antiadherentes",
    subtitle: "Calidad garantizada. Entrega contra reembolso.",
    price: "59.90",
    bundle_2_price: "99.90",
    bundle_3_price: "129.90",
    hero_image_urls_csv: "https://cdn.example.com/a.jpg",
    hero_video_url: "https://cdn.example.com/v.mp4",
    whatsapp_number: "51999999999",
    pixel_id: "",
    shopify_page_handle: "set-ollas",
    benefit_1_title: "No se pega",
    benefit_1_body: "Cocina con menos aceite.",
    benefit_2_title: "Tres tamaños",
    benefit_2_body: "Una para cada plato.",
    benefit_3_title: "Tapa de vidrio",
    benefit_3_body: "Mira la cocción sin destapar.",
    faq_1_q: "¿Funciona en inducción?",
    faq_1_a: "Sí, funciona en gas, inducción y eléctrica.",
    faq_2_q: "¿Cómo se paga?",
    faq_2_a: "Pago contra entrega.",
    faq_3_q: "¿Cuándo llega?",
    faq_3_a: "Entre 2 y 4 días hábiles.",
    objection_1_text: "Devolución sin preguntas.",
    objection_2_text: "Sin pagos por adelantado.",
    ...overrides,
  }
}

function heroLiquid(rendered: ReturnType<typeof loadTemplate>): string {
  const hero = rendered.sections.hero
  if (!hero) throw new Error("hero section missing")
  const liquid = hero.settings.custom_liquid
  if (typeof liquid !== "string") throw new Error("hero custom_liquid must be a string")
  return liquid
}

const TEMPLATE_IDS: TemplateId[] = [1, 2, 3]

// ─── Token substitution ──────────────────────────────────────────────────────

describe("renderTemplate — Phase 2 hero token substitution", () => {
  test.each(TEMPLATE_IDS)("template %i substitutes hero_image_urls_csv into the hero", (id) => {
    const tpl = loadTemplate(id)
    const vars = buildVars({
      hero_image_urls_csv: "https://cdn.example.com/main.jpg,https://cdn.example.com/thumb.jpg",
    })
    const rendered = renderTemplate(tpl, vars)
    expect(heroLiquid(rendered)).toContain(
      "https://cdn.example.com/main.jpg,https://cdn.example.com/thumb.jpg",
    )
  })

  test.each(TEMPLATE_IDS)("template %i substitutes hero_video_url into the hero", (id) => {
    const tpl = loadTemplate(id)
    const vars = buildVars({ hero_video_url: "https://cdn.example.com/picked.mp4" })
    const rendered = renderTemplate(tpl, vars)
    expect(heroLiquid(rendered)).toContain("https://cdn.example.com/picked.mp4")
  })

  test.each(
    TEMPLATE_IDS,
  )("template %i never contains the dropped video_urls_csv / product_image_url tokens", (id) => {
    const tpl = loadTemplate(id)
    const vars = buildVars()
    const rendered = renderTemplate(tpl, vars)
    const liquid = heroLiquid(rendered)
    expect(liquid).not.toContain("{{video_urls_csv}}")
    expect(liquid).not.toContain("{{product_image_url}}")
  })
})

// ─── Liquid pass-through ──────────────────────────────────────────────────────

describe("renderTemplate — Liquid identifiers survive token replacement", () => {
  test("inner Liquid vars (replik_hero_main, replik_hero_video, u, img) pass through", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars()
    const rendered = renderTemplate(tpl, vars)
    const liquid = heroLiquid(rendered)
    expect(liquid).toContain("{% assign replik_hero_imgs")
    expect(liquid).toContain("{{ replik_hero_main }}")
    expect(liquid).toContain("{{ replik_hero_video }}")
    expect(liquid).toContain("{% for img in replik_hero_imgs")
    expect(liquid).toContain("{% assign u = img | strip %}")
    expect(liquid).toContain("{{ u }}")
  })
})

// ─── Stacked layout DOM contract ──────────────────────────────────────────────

describe("hero markup — stacked layout DOM contract", () => {
  test("renders main image with replik-hero-main class", () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    expect(heroLiquid(rendered)).toContain('class="replik-hero-main"')
  })

  test("renders thumbnails wrapper with replik-hero-thumbs class", () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    expect(heroLiquid(rendered)).toContain('class="replik-hero-thumbs"')
  })

  test("renders video tile with replik-hero-video class", () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    expect(heroLiquid(rendered)).toContain('class="replik-hero-video"')
  })

  test("video tag carries autoplay+muted+playsinline+loop attributes", () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    const liquid = heroLiquid(rendered)
    expect(liquid).toContain("autoplay")
    expect(liquid).toContain("muted")
    expect(liquid).toContain("playsinline")
    expect(liquid).toContain("loop")
  })

  test('main image gates rendering via {% if replik_hero_main != "" %}', () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    const liquid = heroLiquid(rendered)
    expect(liquid).toMatch(/\{% if replik_hero_main != ""\s*%\}/)
  })

  test("thumb wrapper gates rendering via {% if replik_hero_imgs.size > 1 %}", () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    expect(heroLiquid(rendered)).toMatch(/\{% if replik_hero_imgs.size > 1\s*%\}/)
  })

  test('video tile gates rendering via {% if replik_hero_video != "" %}', () => {
    const tpl = loadTemplate(1)
    const rendered = renderTemplate(tpl, buildVars())
    expect(heroLiquid(rendered)).toMatch(/\{% if replik_hero_video != ""\s*%\}/)
  })
})

// ─── Graceful degradation per image-count ─────────────────────────────────────

describe("hero markup — image-count graceful degradation (CSV scenarios)", () => {
  test("1 image CSV — main only (Liquid still emits the thumb gate; the gate filters at runtime)", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars({ hero_image_urls_csv: "https://cdn.example.com/only.jpg" })
    const rendered = renderTemplate(tpl, vars)
    expect(heroLiquid(rendered)).toContain("https://cdn.example.com/only.jpg")
  })

  test("2 image CSV — main + 1 thumb URL substituted", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars({
      hero_image_urls_csv: "https://cdn.example.com/main.jpg,https://cdn.example.com/thumb.jpg",
    })
    const rendered = renderTemplate(tpl, vars)
    expect(heroLiquid(rendered)).toContain("https://cdn.example.com/main.jpg")
    expect(heroLiquid(rendered)).toContain("https://cdn.example.com/thumb.jpg")
  })

  test("3 image CSV — all three URLs survive substitution", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars({
      hero_image_urls_csv: ["a", "b", "c"].map((s) => `https://cdn.example.com/${s}.jpg`).join(","),
    })
    const rendered = renderTemplate(tpl, vars)
    const liquid = heroLiquid(rendered)
    expect(liquid).toContain("https://cdn.example.com/a.jpg")
    expect(liquid).toContain("https://cdn.example.com/b.jpg")
    expect(liquid).toContain("https://cdn.example.com/c.jpg")
  })

  test("empty hero_video_url substitutes as empty between quotes", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars({ hero_video_url: "" })
    const rendered = renderTemplate(tpl, vars)
    expect(heroLiquid(rendered)).toContain('"" | strip')
  })
})

// ─── End-to-end: no raw TemplateVars tokens leak ──────────────────────────────

describe("renderTemplate — no raw TemplateVars tokens remain", () => {
  /**
   * After substitution, no `{{key}}` should remain where `key` is in our
   * TemplateVars set. Liquid-internal identifiers (`u`, `img`, `replik_*`)
   * are left intact for Shopify, so we explicitly allow those.
   */
  test("no TemplateVars tokens leak in any rendered section", () => {
    const tpl = loadTemplate(1)
    const vars = buildVars()
    const rendered = renderTemplate(tpl, vars)
    const fullJson = JSON.stringify(rendered)
    const templateVarKeys: ReadonlyArray<keyof TemplateVars> = [
      "title",
      "subtitle",
      "price",
      "bundle_2_price",
      "bundle_3_price",
      "hero_image_urls_csv",
      "hero_video_url",
      "whatsapp_number",
      "pixel_id",
      "shopify_page_handle",
      "benefit_1_title",
      "benefit_1_body",
      "benefit_2_title",
      "benefit_2_body",
      "benefit_3_title",
      "benefit_3_body",
      "faq_1_q",
      "faq_1_a",
      "faq_2_q",
      "faq_2_a",
      "faq_3_q",
      "faq_3_a",
      "objection_1_text",
      "objection_2_text",
    ]
    for (const key of templateVarKeys) {
      expect(fullJson).not.toContain(`{{${key}}}`)
      expect(fullJson).not.toContain(`{{ ${key} }}`)
    }
  })
})
