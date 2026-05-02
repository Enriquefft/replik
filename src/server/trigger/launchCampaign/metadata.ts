export const LAUNCH_PHASES = [
  "copy",
  "upload_videos",
  "upload_image",
  "campaign",
  "adsets",
  "ads",
] as const
export type LaunchPhase = (typeof LAUNCH_PHASES)[number]
