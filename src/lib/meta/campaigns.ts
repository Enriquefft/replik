import "server-only";

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Campaign create + list against `/act_{ad_account_id}/campaigns` on
 * Marketing API v21.0. We only support the LATAM dropshipping default:
 * `OUTCOME_SALES` objective, daily budgets in cents, no special ad
 * categories.
 */

import { META_GRAPH_BASE } from "./accounts";
import { metaFetchJson } from "./http";
import {
  CampaignCreateInputSchema,
  CampaignListFilterSchema,
  CampaignSummarySchema,
  type CampaignCreateInput,
  type CampaignListFilter,
  type CampaignSummary,
  type MetaCreds,
} from "./types";

interface CampaignCreateResponse {
  id: string;
}

interface CampaignListResponse {
  data?: { id: string; name: string; status: string }[];
}

function adAccountPath(creds: MetaCreds): string {
  const id = creds.ad_account_id.replace(/^act_/, "");
  return `${META_GRAPH_BASE}/act_${encodeURIComponent(id)}`;
}

export async function campaignCreate(
  creds: MetaCreds,
  input: CampaignCreateInput,
): Promise<CampaignSummary> {
  const parsed = CampaignCreateInputSchema.parse(input);
  const url = `${adAccountPath(creds)}/campaigns`;
  const form: Record<string, string> = {
    access_token: creds.token,
    name: parsed.name,
    objective: parsed.objective,
    status: parsed.status,
    daily_budget: String(parsed.daily_budget_cents),
    special_ad_categories: JSON.stringify(parsed.special_ad_categories),
  };
  const created = await metaFetchJson<CampaignCreateResponse>(url, {
    method: "POST",
    form,
    creds,
  });
  return CampaignSummarySchema.parse({
    id: created.id,
    name: parsed.name,
    status: parsed.status,
  });
}

export async function campaignList(
  creds: MetaCreds,
  filter?: CampaignListFilter,
): Promise<CampaignSummary[]> {
  const parsed = CampaignListFilterSchema.parse(filter);
  const params = new URLSearchParams({
    access_token: creds.token,
    fields: "id,name,status",
    limit: "100",
  });
  if (parsed?.status?.length) {
    params.set(
      "filtering",
      JSON.stringify([
        { field: "effective_status", operator: "IN", value: parsed.status },
      ]),
    );
  }
  const url = `${adAccountPath(creds)}/campaigns?${params.toString()}`;
  const body = await metaFetchJson<CampaignListResponse>(url, { creds });
  return (body.data ?? []).map((row) => CampaignSummarySchema.parse(row));
}
