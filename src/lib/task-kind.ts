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
