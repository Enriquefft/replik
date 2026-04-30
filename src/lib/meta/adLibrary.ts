import "server-only";

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Ad Library API search. Hits the public `ads_archive` endpoint with the
 * server-side `META_AD_LIBRARY_TOKEN` (NOT the user's marketing token) and
 * filters down to video creatives only — the L0/L1 pipeline is video-first.
 *
 * Inputs are validated through `AdLibrarySearchInputSchema` (defaults: PE,
 * limit 20). Output is mapped into the public `AdLibraryAd` shape.
 */

import { META_GRAPH_BASE } from "./accounts";
import { metaFetchJson } from "./http";
import { MetaError } from "./types";
import {
  AdLibrarySearchInputSchema,
  type AdLibraryAd,
  type AdLibrarySearchInput,
} from "./types";

interface AdMediaEntry {
  video_hd_url?: string;
  video_sd_url?: string;
  video_preview_url?: string;
  video_url?: string;
  resolved_image_url?: string;
}

interface RawAdLibraryAd {
  id: string;
  page_name?: string;
  page_id?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_media?: AdMediaEntry[];
}

interface AdsArchiveResponse {
  data?: RawAdLibraryAd[];
}

function pickVideoUrl(media: AdMediaEntry[] | undefined): string | undefined {
  if (!media) return undefined;
  for (const entry of media) {
    const candidate =
      entry.video_hd_url ??
      entry.video_sd_url ??
      entry.video_url ??
      entry.video_preview_url;
    if (candidate) return candidate;
  }
  return undefined;
}

function isVideoAd(raw: RawAdLibraryAd): boolean {
  if (raw.ad_media?.some((m) => Boolean(pickVideoUrl([m])))) return true;
  // Snapshot URLs for video ads include `/video/` or carry a `video_id` query.
  const url = raw.ad_snapshot_url;
  if (!url) return false;
  return /\/video\//i.test(url) || /[?&]video_id=/i.test(url);
}

export async function adLibrarySearch(
  input: AdLibrarySearchInput,
): Promise<AdLibraryAd[]> {
  const parsed = AdLibrarySearchInputSchema.parse(input);
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) {
    throw new MetaError({
      code: 0,
      friendly:
        "META_AD_LIBRARY_TOKEN no está configurado en el servidor.",
      message: "META_AD_LIBRARY_TOKEN missing",
    });
  }

  const params = new URLSearchParams({
    access_token: token,
    search_terms: parsed.searchTerms,
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(parsed.countries),
    fields: [
      "id",
      "page_name",
      "page_id",
      "ad_creative_bodies",
      "ad_creative_link_titles",
      "ad_snapshot_url",
      "ad_delivery_start_time",
      "ad_media",
    ].join(","),
    limit: String(parsed.limit),
  });

  const url = `${META_GRAPH_BASE}/ads_archive?${params.toString()}`;
  const body = await metaFetchJson<AdsArchiveResponse>(url);
  const data = body.data ?? [];

  const videos = data.filter(isVideoAd).slice(0, parsed.limit);

  return videos.map((raw): AdLibraryAd => {
    const ad: AdLibraryAd = { ad_id: raw.id };
    if (raw.page_name !== undefined) ad.page_name = raw.page_name;
    if (raw.page_id !== undefined) ad.page_id = raw.page_id;
    if (raw.ad_snapshot_url !== undefined)
      ad.ad_snapshot_url = raw.ad_snapshot_url;
    if (raw.ad_creative_bodies !== undefined)
      ad.ad_creative_bodies = raw.ad_creative_bodies;
    if (raw.ad_creative_link_titles !== undefined)
      ad.ad_creative_link_titles = raw.ad_creative_link_titles;
    const videoUrl = pickVideoUrl(raw.ad_media);
    if (videoUrl !== undefined) ad.video_url = videoUrl;
    return ad;
  });
}
