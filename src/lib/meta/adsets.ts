import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Ad set create against `/act_{ad_account_id}/adsets`. The Marketing API
 * accepts JSON-stringified objects for the structured fields (`targeting`,
 * `promoted_object`) when posted via form-urlencoded — that is the shape we
 * use everywhere for consistency.
 */

import { z } from "zod"
import { META_GRAPH_BASE } from "./accounts"
import { metaFetchJson } from "./http"
import {
  type AdSetCreateInput,
  AdSetCreateInputSchema,
  type AdSetSummary,
  AdSetSummarySchema,
  type MetaCreds,
} from "./types"

const AdSetCreateResponseSchema = z.object({ id: z.string() })

function adAccountPath(creds: MetaCreds): string {
  const id = creds.ad_account_id.replace(/^act_/, "")
  return `${META_GRAPH_BASE}/act_${encodeURIComponent(id)}`
}

export async function adsetCreate(
  creds: MetaCreds,
  input: AdSetCreateInput,
): Promise<AdSetSummary> {
  const parsed = AdSetCreateInputSchema.parse(input)

  const form: Record<string, string> = {
    access_token: creds.token,
    name: parsed.name,
    campaign_id: parsed.campaign_id,
    optimization_goal: parsed.optimization_goal,
    billing_event: parsed.billing_event,
    promoted_object: JSON.stringify(parsed.promoted_object),
    targeting: JSON.stringify(parsed.targeting),
    status: parsed.status,
  }
  if (parsed.daily_budget_cents !== undefined) {
    form.daily_budget = String(parsed.daily_budget_cents)
  }

  const url = `${adAccountPath(creds)}/adsets`
  const created = await metaFetchJson(url, AdSetCreateResponseSchema, {
    method: "POST",
    form,
    creds,
  })
  return AdSetSummarySchema.parse({
    id: created.id,
    name: parsed.name,
    status: parsed.status,
  })
}
