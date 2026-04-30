import "server-only";

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Backwards-compat re-export shim. Earlier lanes (L3a / L4b / L5) import
 * function and type names from `@/lib/meta/endpoints`; we keep that surface
 * 1:1 by re-exporting from the per-domain modules. New imports should
 * prefer the barrel `@/lib/meta`.
 */

export { adLibrarySearch } from "./adLibrary";
export { campaignCreate, campaignList } from "./campaigns";
export { adsetCreate } from "./adsets";
export { creativeCreate } from "./creatives";
export { adCreate } from "./ads";
export { videoUploadResumable, imageUpload } from "./uploads";
export { insightsGet } from "./insights";

export { MetaError } from "./types";
export type {
  MetaCreds,
  AdLibrarySearchInput,
  AdLibraryAd,
  CampaignCreateInput,
  CampaignSummary,
  CampaignListFilter,
  AdSetCreateInput,
  AdSetSummary,
  CreativeCreateInput,
  CreativeSummary,
  AdCreateInput,
  AdSummary,
  VideoUploadResult,
  ImageUploadResult,
  InsightsFilter,
  Insight,
  Interest,
} from "./types";
