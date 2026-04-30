import "server-only"

/**
 * Owner: Lane L4b (Launch).
 *
 * LLM batch copy generation for Meta Ads. One Anthropic call (via the Vercel
 * AI SDK `generateObject`) yields one `CopyJson` per selected creative —
 * indexed by the creative's stable id, not its position. The single-batch
 * design keeps cost and latency bounded as creative count grows.
 *
 * The output Zod schema doubles as runtime validation and as the schema fed
 * to `generateObject`, so the model is structurally constrained to return the
 * exact shape we persist into `ads.copy_json` (and to honor Meta's character
 * limits: primary_text ≤125, headline ≤40, description ≤30).
 */

import { anthropic } from "@ai-sdk/anthropic"
import { generateText, Output } from "ai"
import { z } from "zod"
import { CopyJson } from "@/db/zod"

export interface CopyCreativeInput {
  id: string
  /** Selling angle (e.g. "ahorro de tiempo", "regalo perfecto"). */
  angle: string | null
  /** Original-ad transcript captured during scraping. */
  transcript: string | null
}

export interface GenerateCopiesInput {
  productName: string
  category: string | null
  creatives: CopyCreativeInput[]
}

const CopyResultItem = z.object({
  creative_id: z.string().min(1),
  copy: z.object({
    primary_text: z.string().min(1).max(125),
    headline: z.string().min(1).max(40),
    description: z.string().min(1).max(30),
  }),
})

const CopyResultSchema = z.object({
  items: z.array(CopyResultItem),
})

const SYSTEM_PROMPT = [
  "Genera copy publicitario Meta Ads (primary_text máx 125 chars,",
  "headline máx 40, description máx 30) por cada creativo, basado en su",
  "ángulo de venta y transcripción. Tono LATAM-PE.",
].join(" ")

/**
 * Build a deterministic user prompt that lists every creative with its angle
 * and transcript, plus the explicit set of `creative_id` values the model
 * MUST emit. This keeps the model from hallucinating ids or skipping rows.
 */
function buildUserPrompt(input: GenerateCopiesInput): string {
  const lines: string[] = []
  lines.push(`Producto: ${input.productName}`)
  if (input.category) {
    lines.push(`Categoría: ${input.category}`)
  }
  lines.push("")
  lines.push("Creativos:")
  for (const c of input.creatives) {
    lines.push(`- creative_id: ${c.id}`)
    lines.push(`  ángulo: ${c.angle ?? "(no especificado)"}`)
    const transcript = (c.transcript ?? "").trim()
    const trimmed = transcript.length > 800 ? `${transcript.slice(0, 800)}…` : transcript
    lines.push(`  transcripción: ${trimmed || "(vacía)"}`)
  }
  lines.push("")
  lines.push(
    "Devuelve en `items` exactamente un objeto por creativo, con el mismo `creative_id`. Una variación de copy distinta por ángulo. No inventes ids.",
  )
  return lines.join("\n")
}

/**
 * Single Anthropic call → `Map<creativeId, CopyJson>`. Throws if the model
 * fails to return copy for every requested creative — callers must treat copy
 * generation as all-or-nothing so the launch task fails fast instead of
 * shipping a half-populated campaign.
 */
export async function generateCopies(input: GenerateCopiesInput): Promise<Map<string, CopyJson>> {
  if (input.creatives.length === 0) {
    return new Map()
  }
  const result = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    output: Output.object({ schema: CopyResultSchema }),
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input),
  })
  const map = new Map<string, CopyJson>()
  for (const row of result.output.items) {
    const copy = CopyJson.parse(row.copy)
    map.set(row.creative_id, copy)
  }
  for (const c of input.creatives) {
    if (!map.has(c.id)) {
      throw new Error(`generateCopies: model omitted copy for creative ${c.id}`)
    }
  }
  return map
}
