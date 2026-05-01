import { z } from "zod"

export const PUBLISH_PHASES = [
  "picking_template",
  "shopify_publish",
  "render",
  "apply_theme",
] as const
export const PublishProgressMetadataSchema = z.object({
  phase: z.enum(PUBLISH_PHASES),
  templateId: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
})
export type PublishPhase = (typeof PUBLISH_PHASES)[number]
export type PublishProgressMetadata = z.infer<typeof PublishProgressMetadataSchema>
