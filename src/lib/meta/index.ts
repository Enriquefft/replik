/**
 * Meta wrapper barrel.
 *
 * P1 left only `accountsList` / `pixelsList` (used by `saveIntegration`).
 * P2 L4a expands this with the remaining 8 endpoints. Stub signatures are
 * exposed here so L3a / L4b / L5 can import-and-typecheck in parallel; L4a
 * replaces the bodies with real Zod-validated REST calls.
 */
export {
  MetaAuthError,
  accountsList,
  pixelsList,
} from "./accounts";
export type { MetaAccount, MetaPixel } from "./accounts";

export {
  adLibrarySearch,
  campaignCreate,
  campaignList,
  adsetCreate,
  creativeCreate,
  adCreate,
  videoUploadResumable,
  imageUpload,
  insightsGet,
} from "./endpoints";
export type {
  AdLibraryAd,
  AdLibrarySearchInput,
  CampaignCreateInput,
  CampaignSummary,
  AdSetCreateInput,
  AdSetSummary,
  CreativeCreateInput,
  CreativeSummary,
  AdCreateInput,
  AdSummary,
  MetaCreds,
  MetaError,
  VideoUploadResult,
  ImageUploadResult,
  InsightsFilter,
  Insight,
} from "./endpoints";
