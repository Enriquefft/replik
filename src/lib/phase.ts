/**
 * Shared shape for a phase's UI strings. Every task's `*_PHASE_LABELS_ES`
 * map is `Record<Phase, PhaseLabel>` — keeping the shape in one place
 * means the `PhaseProgress` component and the per-task metadata files
 * derive from the same source. SSOT.
 */
export interface PhaseLabel {
  label: string
  description?: string
}
