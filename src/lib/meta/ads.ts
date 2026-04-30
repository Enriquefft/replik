import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Ad create against `/act_{ad_account_id}/ads`. Wires an existing ad set
 * id + creative id into a live (or paused) ad row.
 */

import { z } from "zod"
import { META_GRAPH_BASE } from "./accounts"
import { metaFetchJson } from "./http"
import {
  type AdCreateInput,
  AdCreateInputSchema,
  type AdSummary,
  AdSummarySchema,
  type MetaCreds,
} from "./types"

const AdCreateResponseSchema = z.object({ id: z.string() })

function adAccountPath(creds: MetaCreds): string {
  const id = creds.ad_account_id.replace(/^act_/, "")
  return `${META_GRAPH_BASE}/act_${encodeURIComponent(id)}`
}

export async function adCreate(creds: MetaCreds, input: AdCreateInput): Promise<AdSummary> {
  const parsed = AdCreateInputSchema.parse(input)
  const form: Record<string, string> = {
    access_token: creds.token,
    name: parsed.name,
    adset_id: parsed.adset_id,
    creative: JSON.stringify({ creative_id: parsed.creative_id }),
    status: parsed.status,
  }
  const url = `${adAccountPath(creds)}/ads`
  const created = await metaFetchJson(url, AdCreateResponseSchema, {
    method: "POST",
    form,
    creds,
  })
  return AdSummarySchema.parse({
    id: created.id,
    name: parsed.name,
    status: parsed.status,
  })
}
