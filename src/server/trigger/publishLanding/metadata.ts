export const PUBLISH_PHASES = [
  "picking_template",
  "shopify_publish",
  "render",
  "apply_theme",
] as const
export type PublishPhase = (typeof PUBLISH_PHASES)[number]
