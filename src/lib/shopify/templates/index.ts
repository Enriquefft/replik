import "server-only"

import {
  benefitsSection,
  bundleSection,
  faqSection,
  formCodSection,
  heroSection,
  objectionsSection,
  type SectionDef,
  type TemplateVariant,
} from "./blocks.ts"

export type TemplateId = 1 | 2 | 3

export interface LandingTemplate {
  name: string
  sections: Record<string, SectionDef>
  order: string[]
}

const VARIANT_BY_ID: Record<TemplateId, TemplateVariant> = {
  1: "clean",
  2: "urgency",
  3: "lifestyle",
}

const VARIANT_NAMES: Record<TemplateVariant, string> = {
  clean: "Replik Landing 1 — Clean Classic",
  urgency: "Replik Landing 2 — Urgency / Sales",
  lifestyle: "Replik Landing 3 — Lifestyle",
}

const SECTION_ORDER: readonly string[] = [
  "hero",
  "bundle_pricing",
  "benefits",
  "faq",
  "objections",
  "form_cod",
] as const

function buildTemplate(variant: TemplateVariant): LandingTemplate {
  return {
    name: VARIANT_NAMES[variant],
    sections: {
      hero: heroSection(variant),
      bundle_pricing: bundleSection(variant),
      benefits: benefitsSection(variant),
      faq: faqSection(variant),
      objections: objectionsSection(variant),
      form_cod: formCodSection(variant),
    },
    order: [...SECTION_ORDER],
  }
}

const TEMPLATES_BY_ID: Record<TemplateId, LandingTemplate> = {
  1: buildTemplate(VARIANT_BY_ID[1]),
  2: buildTemplate(VARIANT_BY_ID[2]),
  3: buildTemplate(VARIANT_BY_ID[3]),
}

export function loadTemplate(id: TemplateId): LandingTemplate {
  return TEMPLATES_BY_ID[id]
}

/**
 * Display metadata for the template picker UI. Decoupled from the rendered
 * sections so editing copy/visuals does not require touching Shopify section
 * definitions. The block builders in `./blocks.ts` are the source of truth
 * for what gets rendered onto the storefront page.
 */
export interface TemplateMeta {
  id: TemplateId
  name: string
  description: string
  accent: string
  headline: string
  subheadline: string
}

export const TEMPLATES: readonly TemplateMeta[] = [
  {
    id: 1,
    name: "Clean Classic",
    description: "Hero limpio, packs verticales, CTA contundente.",
    accent: "#ff453a",
    headline: "Calidad que sentirás desde el primer uso",
    subheadline: "Garantía contra entrega · Envío en 24h",
  },
  {
    id: 2,
    name: "Vibrant Bundle",
    description: "Énfasis en packs y descuentos. Para productos de impulso.",
    accent: "#ff9f0a",
    headline: "Llévate más, paga menos",
    subheadline: "Pack × 3 al mejor precio del mercado",
  },
  {
    id: 3,
    name: "Modern Minimal",
    description: "Look premium, copy técnico, conversión racional.",
    accent: "#0a84ff",
    headline: "Diseño preciso. Resultados reales.",
    subheadline: "Garantía total. Pago contra entrega.",
  },
] as const
