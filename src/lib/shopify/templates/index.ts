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
