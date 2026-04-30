import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Ad creative create against `/act_{ad_account_id}/adcreatives`. We only
 * use the `object_story_spec.video_data` shape — image creatives and
 * link-only ads aren't part of the LATAM video-first pipeline.
 */

import { META_GRAPH_BASE } from "./accounts"
import { metaFetchJson } from "./http"
import {
  type CreativeCreateInput,
  CreativeCreateInputSchema,
  type CreativeSummary,
  CreativeSummarySchema,
  type MetaCreds,
} from "./types"

interface CreativeCreateResponse {
  id: string
}

function adAccountPath(creds: MetaCreds): string {
  const id = creds.ad_account_id.replace(/^act_/, "")
  return `${META_GRAPH_BASE}/act_${encodeURIComponent(id)}`
}

export async function creativeCreate(
  creds: MetaCreds,
  input: CreativeCreateInput,
): Promise<CreativeSummary> {
  const parsed = CreativeCreateInputSchema.parse(input)
  const form: Record<string, string> = {
    access_token: creds.token,
    name: parsed.name,
    object_story_spec: JSON.stringify(parsed.object_story_spec),
  }
  const url = `${adAccountPath(creds)}/adcreatives`
  const created = await metaFetchJson<CreativeCreateResponse>(url, {
    method: "POST",
    form,
    creds,
  })
  return CreativeSummarySchema.parse({
    id: created.id,
    name: parsed.name,
  })
}
