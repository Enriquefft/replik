import { z } from "zod"

export const LAUNCH_PHASES = [
  "copy",
  "upload_videos",
  "upload_image",
  "campaign",
  "adsets",
  "ads",
] as const
export const LaunchProgressMetadataSchema = z.object({
  phase: z.enum(LAUNCH_PHASES),
  videosUploaded: z.number().int().nonnegative().optional(),
  videosTotal: z.number().int().nonnegative().optional(),
  adsCreated: z.number().int().nonnegative().optional(),
})
export type LaunchPhase = (typeof LAUNCH_PHASES)[number]
export type LaunchProgressMetadata = z.infer<typeof LaunchProgressMetadataSchema>
