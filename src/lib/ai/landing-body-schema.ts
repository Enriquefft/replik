import { z } from "zod"
import { Product } from "@/db/zod.ts"
import { CopyGenCreativeSchema } from "@/lib/ai/schemas.ts"

/**
 * Structured body sections rendered into the Shopify landing template
 * between hero/pricing and the COD form. Tight length bounds keep the
 * page scannable on mobile and force the model to commit to one claim
 * per slot instead of hedging.
 *
 * `length(N)` is intentional — every template references exactly the
 * same fixed token positions (`benefit_1_title`, `faq_3_q`, etc.), so
 * a variable count would orphan tokens or leave empty sections.
 */
export const LandingBodySchema = z.object({
  benefits: z
    .array(
      z.object({
        title: z.string().min(3).max(40),
        body: z.string().min(10).max(120),
      }),
    )
    .length(3),
  faq: z
    .array(
      z.object({
        q: z.string().min(5).max(80),
        a: z.string().min(10).max(180),
      }),
    )
    .length(3),
  objections: z.array(z.string().min(10).max(140)).length(2),
})

export type LandingBody = z.infer<typeof LandingBodySchema>

/**
 * LLM-facing variant. Drops the structural `length(3)/length(2)` refines so
 * Anthropic structured outputs accept the schema (it rejects `minItems > 1`).
 * The call-site validator in `landing-body.ts` enforces the count post-parse.
 */
export const LandingBodyLLMSchema = z.object({
  benefits: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
    }),
  ),
  faq: z.array(
    z.object({
      q: z.string(),
      a: z.string(),
    }),
  ),
  objections: z.array(z.string()),
})

/**
 * Caller input. Mirrors `CopyGenInput` shape so the publish task can pass
 * the same product/creatives view it builds for the digit whitelist.
 */
export const LandingBodyInputSchema = z.object({
  product: Product,
  creatives: z.array(CopyGenCreativeSchema).min(1),
})

export type LandingBodyInput = z.infer<typeof LandingBodyInputSchema>
