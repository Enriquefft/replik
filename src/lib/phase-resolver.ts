import type { PhaseLabel } from "@/lib/phase.ts"
import type { TaskKind } from "@/lib/task-kind.ts"
import { LAUNCH_PHASE_LABELS_ES } from "@/server/trigger/launchCampaign/metadata.ts"
import { PUBLISH_PHASE_LABELS_ES } from "@/server/trigger/publishLanding/metadata.ts"
import { REHOST_PHASE_LABELS_ES } from "@/server/trigger/rehostCreatives/metadata.ts"
import { SCRAPE_PHASE_LABELS_ES } from "@/server/trigger/scrapeProduct/metadata.ts"
import { SYNC_INSIGHTS_PHASE_LABELS_ES } from "@/server/trigger/syncInsights/metadata.ts"
import { BURN_PHASE_LABELS_ES } from "@/server/trigger/translateAndBurnSubs/metadata.ts"

/**
 * Per-`TaskKind` phase-label registry. Each metadata module is the SSOT
 * for its own phase strings; this registry merely indexes them by
 * `TaskKind` so JobsDock and `useTaskNarration` can resolve a label
 * without taking a runtime dep on every metadata module.
 *
 * The metadata modules only import `zod` and `PhaseLabel` (no
 * `server-only`), so importing them from a client component is safe — no
 * server module ever transitively flows into the bundle.
 */
const REGISTRY: Record<TaskKind, Record<string, PhaseLabel>> = {
  scrape_product: SCRAPE_PHASE_LABELS_ES,
  translate_burn: BURN_PHASE_LABELS_ES,
  rehost_creatives: REHOST_PHASE_LABELS_ES,
  publish_landing: PUBLISH_PHASE_LABELS_ES,
  launch_campaign: LAUNCH_PHASE_LABELS_ES,
  sync_insights: SYNC_INSIGHTS_PHASE_LABELS_ES,
}

/**
 * Resolve a phase label by `TaskKind` + phase id. Returns `null` when the
 * kind/phase combo isn't known (e.g. a task that hasn't emitted phase
 * metadata yet, or a phase string from an older task version).
 */
export function resolvePhaseLabel(taskKind: TaskKind, phase: string | null): PhaseLabel | null {
  if (phase === null) return null
  const map = REGISTRY[taskKind]
  return map[phase] ?? null
}
