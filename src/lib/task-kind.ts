import { z } from "zod"

/**
 * Branded enum of Trigger.dev task kinds. SSOT for the UI side — the
 * discriminator the JobsDock pill, completion toast, and error-code
 * maps use to look up labels and translations.
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
 * Maps Trigger.dev task identifiers (the `id:` string passed to `task({})`
 * / `schemaTask({})`) to their canonical `TaskKind`. Used by
 * `listActiveRuns` to label runs returned from `runs.list()` and by
 * `getRunFinalStatus` to label the completion toast. Keep in lockstep
 * with each task body's `id:` value.
 */
const TRIGGER_TASK_ID_TO_KIND: Readonly<Record<string, TaskKind>> = {
  "scrape-product": "scrape_product",
  translateAndBurnSubs: "translate_burn",
  rehostCreatives: "rehost_creatives",
  publishLanding: "publish_landing",
  launchCampaign: "launch_campaign",
  "sync-insights": "sync_insights",
}

export function taskKindFromTriggerId(triggerId: string): TaskKind | null {
  return TRIGGER_TASK_ID_TO_KIND[triggerId] ?? null
}

/**
 * User-facing Spanish (Latin American) labels for each `TaskKind`. SSOT for
 * the `JobsDock` row title and any other surface that needs to name an
 * in-flight task. Keep these short — they render inside a 200px-wide pill.
 */
export const JOB_KIND_LABELS_ES: Record<TaskKind, string> = {
  scrape_product: "Analizando producto",
  translate_burn: "Editando video",
  rehost_creatives: "Editando videos",
  publish_landing: "Publicando landing",
  launch_campaign: "Lanzando campaña",
  sync_insights: "Refrescando métricas",
}

/**
 * Success-toast copy fired by `useRunCompletionToast` when a run transitions
 * from active → completed. Kept separate from `JOB_KIND_LABELS_ES` because
 * the in-progress noun-phrase ("Analizando producto") and the completion
 * sentence ("Producto analizado.") have different shapes.
 */
export const JOB_KIND_COMPLETION_LABELS_ES: Record<TaskKind, string> = {
  scrape_product: "Producto analizado.",
  translate_burn: "Video editado.",
  rehost_creatives: "Videos editados.",
  publish_landing: "Landing publicada.",
  launch_campaign: "Campaña lanzada.",
  sync_insights: "Métricas actualizadas.",
}
