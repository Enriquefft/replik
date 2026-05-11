import "server-only"

export type { BurnedSubsBand } from "@/lib/ai/taxonomies.ts"
export type { BurnSubsInput, BurnSubsMask, BurnSubsResult, VideoDimensionsInput } from "./burnSubs"
export { buildFilterChain, burnSubs } from "./burnSubs"
export type { ReSegmentOptions } from "./cue-segmenter"
export { reSegmentCues } from "./cue-segmenter"
export type { DetectBurnedSubsInput, DetectBurnedSubsResult } from "./detect-burned-subs"
export {
  BurnedSubsBandSchema,
  DetectBurnedSubsResultSchema,
  detectBurnedSubs,
} from "./detect-burned-subs"
export { resolveFontsDir, VIRAL_FONT_NAME } from "./fonts"
export type { MaskAction, MaskPlan } from "./mask-strategy"
export { resolveMaskPlan } from "./mask-strategy"
export type { VideoDimensions } from "./probe-dimensions"
export { probeDimensions, VideoDimensionsSchema } from "./probe-dimensions"
export type {
  OriginalUploadFailure,
  OriginalUploadInput,
  OriginalUploadOutcome,
  OriginalUploadResult,
  UploadedSrt,
  UploadedVideo,
} from "./upload"
export { uploadEditedVideo, uploadOriginalsFromUrl, uploadSrt } from "./upload"
