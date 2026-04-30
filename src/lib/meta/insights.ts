import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Insights pull. We hit `/{object_id}/insights` per id (Meta does not allow
 * a multi-object insights query in v21.0 outside of `report_run`s, and we
 * don't want async reports for the dashboard refresh path), then normalize
 * the response to the public `Insight` shape.
 *
 * Normalization rules:
 *   - `spend` (USD-ish dollars) → `spend_cents` int = round(spend * 100).
 *   - `ctr`   stays as a float ratio.
 *   - `cpa_cents` derived from `cost_per_action_type[purchase]` if present.
 *   - `roas`  derived from `purchase_roas` if present.
 *   - `results` = sum of `actions[action_type='*purchase*'].value`.
 */

import { META_GRAPH_BASE } from "./accounts"
import { metaFetchJson } from "./http"
import {
  type Insight,
  InsightSchema,
  type InsightsFilter,
  InsightsFilterSchema,
  type MetaCreds,
} from "./types"

interface InsightAction {
  action_type: string
  value: string
}

interface CostPerActionType {
  action_type: string
  value: string
}

interface PurchaseRoas {
  action_type: string
  value: string
}

interface RawInsight {
  date_start: string
  date_stop: string
  spend?: string
  impressions?: string
  ctr?: string
  actions?: InsightAction[]
  cost_per_action_type?: CostPerActionType[]
  purchase_roas?: PurchaseRoas[]
}

interface InsightsResponse {
  data?: RawInsight[]
}

const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"]

function isPurchase(actionType: string): boolean {
  return PURCHASE_TYPES.some((t) => actionType.includes(t))
}

function dollarsToCents(spend: string | undefined): number {
  if (!spend) return 0
  const f = Number(spend)
  if (!Number.isFinite(f)) return 0
  return Math.round(f * 100)
}

function sumPurchaseActions(actions: InsightAction[] | undefined): number {
  if (!actions) return 0
  let total = 0
  for (const a of actions) {
    if (isPurchase(a.action_type)) {
      const n = Number(a.value)
      if (Number.isFinite(n)) total += n
    }
  }
  return Math.round(total)
}

function pickPurchaseCpaCents(rows: CostPerActionType[] | undefined): number | undefined {
  if (!rows) return undefined
  for (const r of rows) {
    if (isPurchase(r.action_type)) {
      const n = Number(r.value)
      if (Number.isFinite(n)) return Math.round(n * 100)
    }
  }
  return undefined
}

function pickPurchaseRoas(rows: PurchaseRoas[] | undefined): number | undefined {
  if (!rows) return undefined
  for (const r of rows) {
    if (isPurchase(r.action_type)) {
      const n = Number(r.value)
      if (Number.isFinite(n)) return n
    }
  }
  // `purchase_roas` is a top-level array of {action_type, value} rows in
  // some shapes; if no action_type matched, fall back to first numeric.
  const first = rows[0]
  if (first) {
    const n = Number(first.value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function parseCtr(ctr: string | undefined): number | undefined {
  if (ctr === undefined) return undefined
  const n = Number(ctr)
  if (!Number.isFinite(n)) return undefined
  return n
}

const INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "ctr",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "date_start",
  "date_stop",
].join(",")

export async function insightsGet(creds: MetaCreds, filter: InsightsFilter): Promise<Insight[]> {
  const parsed = InsightsFilterSchema.parse(filter)

  const out: Insight[] = []
  for (const objectId of parsed.ids) {
    const params = new URLSearchParams({
      access_token: creds.token,
      level: parsed.level,
      fields: INSIGHT_FIELDS,
    })
    if (parsed.date_preset) params.set("date_preset", parsed.date_preset)

    const url = `${META_GRAPH_BASE}/${encodeURIComponent(objectId)}/insights?${params.toString()}`
    const body = await metaFetchJson<InsightsResponse>(url, { creds })
    for (const row of body.data ?? []) {
      const insight: Insight = {
        object_id: objectId,
        date_start: row.date_start,
        date_stop: row.date_stop,
        spend_cents: dollarsToCents(row.spend),
        results: sumPurchaseActions(row.actions),
        impressions: Number.isFinite(Number(row.impressions)) ? Number(row.impressions) : 0,
      }
      const cpa = pickPurchaseCpaCents(row.cost_per_action_type)
      if (cpa !== undefined) insight.cpa_cents = cpa
      const ctr = parseCtr(row.ctr)
      if (ctr !== undefined) insight.ctr = ctr
      const roas = pickPurchaseRoas(row.purchase_roas)
      if (roas !== undefined) insight.roas = roas
      out.push(InsightSchema.parse(insight))
    }
  }
  return out
}
