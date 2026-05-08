import { z } from "zod"

/**
 * Single Meta ad copy unit. Length limits are spec-owned (§4) — not derived
 * from Meta API direct. DB column: ads.copyJson jsonb.
 *
 * Lives in its own leaf module so `src/db/zod.ts` can override the
 * `ads.copyJson` column with this schema without creating an import cycle
 * through `src/lib/ai/schemas.ts` (which imports `Product` from `@/db/zod.ts`).
 */
export const CopyContentSchema = z.object({
  primaryText: z.string().min(1).max(125),
  headline: z.string().min(1).max(40),
  description: z.string().min(1).max(30),
})

export type CopyContent = z.infer<typeof CopyContentSchema>
