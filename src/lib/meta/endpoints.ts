import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Backwards-compat re-export shim. Earlier lanes (L3a / L4b / L5) import
 * function and type names from `@/lib/meta/endpoints`; we keep that surface
 * 1:1 by re-exporting from the per-domain modules. New imports should
 * prefer the barrel `@/lib/meta`.
 */

export { adLibrarySearch } from "./adLibrary"
export { adCreate } from "./ads"
export { adsetCreate } from "./adsets"
export { campaignCreate, campaignList } from "./campaigns"
export { creativeCreate } from "./creatives"
export { insightsGet } from "./insights"
export type {
  AdCreateInput,
  AdLibraryAd,
  AdLibrarySearchInput,
  AdSetCreateInput,
  AdSetSummary,
  AdSummary,
  CampaignCreateInput,
  CampaignListFilter,
  CampaignSummary,
  CreativeCreateInput,
  CreativeSummary,
  ImageUploadResult,
  Insight,
  InsightsFilter,
  Interest,
  MetaCreds,
  VideoUploadResult,
} from "./types"

export { MetaError } from "./types"
export { imageUpload, videoUploadResumable } from "./uploads"
