import "server-only";

import template1 from "./1.json" with { type: "json" };
import template2 from "./2.json" with { type: "json" };
import template3 from "./3.json" with { type: "json" };

export type TemplateId = 1 | 2 | 3;

export type LandingTemplate = typeof template1;

const templates: Record<TemplateId, LandingTemplate> = {
  1: template1,
  2: template2,
  3: template3,
};

export function loadTemplate(id: TemplateId): LandingTemplate {
  return templates[id];
}

/**
 * Display metadata for the template picker UI. Decoupled from the JSON render
 * payloads in `./N.json` so editing copy/visuals does not require touching the
 * Shopify section definitions. The JSON files remain the source of truth for
 * what gets rendered onto the storefront page.
 */
export interface TemplateMeta {
  id: TemplateId;
  name: string;
  description: string;
  accent: string;
  headline: string;
  subheadline: string;
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
] as const;
