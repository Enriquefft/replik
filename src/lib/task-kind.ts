import { z } from "zod"

/**
 * Branded enum of Trigger.dev task kinds. SSOT — matches the
 * `task_kind` pgEnum (`src/db/schema.ts`) and is the discriminator the
 * UI uses to look up phase weights, labels, and error-code maps.
 *
 * String literal members are the canonical persistence values; do NOT
 * change them without a Drizzle migration to remap the pgEnum.
 */
export const TASK_KINDS = [
  "scrape_product",
  "translate_burn",
  "rehost_creatives",
  "publish_landing",
  "launch_campaign",
  "sync_insights",
] as const

export const TaskKindSchema = z.enum(TASK_KINDS)
export type TaskKind = z.infer<typeof TaskKindSchema>

/**
 * Mapping from a Trigger.dev `task.id` (the string passed to `tasks.trigger`)
 * to its `TaskKind`. The task-ids are the SSOT contract with Trigger.dev
 * runtime; the `TaskKind` is our internal handle for telemetry + UI lookup.
 */
const TRIGGER_TASK_ID_TO_KIND: Record<string, TaskKind> = {
  "scrape-product": "scrape_product",
  translateAndBurnSubs: "translate_burn",
  rehostCreatives: "rehost_creatives",
  publishLanding: "publish_landing",
  launchCampaign: "launch_campaign",
  "sync-insights": "sync_insights",
}

/**
 * Resolve a Trigger.dev task identifier (the literal string registered in
 * `task({ id })`) to its `TaskKind`. Returns `null` on unknown ids — the
 * caller decides whether that is a fatal misconfiguration or a benign skip
 * (e.g. a noop run).
 */
export function taskKindFromTriggerId(triggerTaskId: string): TaskKind | null {
  return TRIGGER_TASK_ID_TO_KIND[triggerTaskId] ?? null
}
