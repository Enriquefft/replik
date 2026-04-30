import { z } from "zod"

/*
 * SalesAngle lock gate — Phase 1.
 *
 * Locked after 50-fixture hand-label per docs/ai-2.0.md §3.
 * Distribution gate: ≤5% min, ≥35% max, ≤10% needs-new.
 * Add at most ONE new value if gate trips.
 * Candidate set: novedad | exclusividad | garantia | comunidad.
 * Locked enum lives here; do not edit without re-running the Phase 1 gate.
 */
export const SalesAngle = z.enum([
  "precio",
  "demostracion",
  "testimonio",
  "urgencia",
  "dolor",
  "aspiracional",
  "comparacion",
  "regalo",
])

export type SalesAngle = z.infer<typeof SalesAngle>

export const InterestCategory = z.enum(["home_garden", "beauty", "fitness", "kitchen", "pets"])

export type InterestCategory = z.infer<typeof InterestCategory>

export const TemplateId = z.union([z.literal(1), z.literal(2), z.literal(3)])

export type TemplateId = z.infer<typeof TemplateId>

export const Locale = z.enum(["es-PE"])

export type Locale = z.infer<typeof Locale>

/**
 * UI color tokens keyed on SalesAngle — consumed by creative-card.tsx
 * and anywhere the angle badge is rendered. Single source per §3.
 */
export const AngleColors: Record<SalesAngle, string> = {
  precio: "bg-emerald-100 text-emerald-900",
  demostracion: "bg-blue-100 text-blue-900",
  testimonio: "bg-violet-100 text-violet-900",
  urgencia: "bg-amber-100 text-amber-900",
  dolor: "bg-rose-100 text-rose-900",
  aspiracional: "bg-fuchsia-100 text-fuchsia-900",
  comparacion: "bg-slate-100 text-slate-900",
  regalo: "bg-pink-100 text-pink-900",
} as const
