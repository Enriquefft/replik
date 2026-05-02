import { z } from "zod"

/** Locked Phase 1 — see docs/ai-2.0.md §3. */
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
