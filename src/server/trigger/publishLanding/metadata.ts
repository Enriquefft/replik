export const PUBLISH_PHASES = [
  "picking_template",
  "shopify_publish",
  "generating_body",
  "picking_hero_video",
  "render",
  "apply_theme",
] as const
export type PublishPhase = (typeof PUBLISH_PHASES)[number]
