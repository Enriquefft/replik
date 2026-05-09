/**
 * Meta wrapper barrel.
 *
 * P1 left only `accountsList` / `pixelsList` (used by `saveIntegration`).
 * P2 L4a expands this with the remaining 8 endpoints. Stub signatures are
 * exposed here so L3a / L4b / L5 can import-and-typecheck in parallel; L4a
 * replaces the bodies with real Zod-validated REST calls.
 */

export type { MetaAccount, MetaPixel } from "./accounts"
export {
  accountsList,
  MetaAuthError,
  pixelsList,
} from "./accounts"
export type {
  AdCreateInput,
  AdSetCreateInput,
  AdSetSummary,
  AdSummary,
  CampaignCreateInput,
  CampaignSummary,
  CreativeCreateInput,
  CreativeSummary,
  ImageUploadResult,
  Insight,
  InsightsFilter,
  MetaCreds,
  MetaError,
  VideoUploadResult,
} from "./endpoints"
export {
  adCreate,
  adsetCreate,
  campaignCreate,
  campaignList,
  creativeCreate,
  imageUpload,
  insightsGet,
  videoUploadResumable,
} from "./endpoints"
