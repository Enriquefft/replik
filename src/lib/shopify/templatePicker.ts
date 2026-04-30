import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import { generateText, Output } from "ai"
import { z } from "zod"

export interface PickTemplateInput {
  name: string
  category: string | null
}

export type PickedTemplateId = 1 | 2 | 3

const PickerOutput = z.object({
  template_id: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.string().min(1).max(400),
})

const SYSTEM_PROMPT = `Eres un experto en CRO de landings COD para LATAM. Debes elegir la mejor plantilla de aterrizaje para un producto, dadas 3 opciones:

1. **Clean Classic** — diseño limpio, profesional, confianza. Ideal para productos serios, gadgets, salud, hogar utilitario.
2. **Urgency / Sales** — tono agresivo, escasez, descuentos resaltados, "OFERTA LIMITADA". Ideal para impulso, belleza, accesorios fashion, suplementos.
3. **Lifestyle** — tono cálido, aspiracional, conexión emocional. Ideal para hogar decorativo, regalos, productos para mascotas, niños, bienestar suave.

Devuelve UN solo template_id (1, 2 o 3) y una breve razón (máx 2 frases) explicando por qué encaja con la categoría y nombre del producto.`

/**
 * Single Anthropic call. Hard-coded model id — `claude-sonnet-4-5` is the
 * current production sonnet release on @ai-sdk/anthropic 3.x. The SDK accepts
 * `claude-sonnet-4-6` as an extended id but 4-5 is the safer default.
 *
 * Uses `generateText` + `Output.object` (the AI SDK 6.x replacement for the
 * deprecated `generateObject` API).
 */
export async function pickTemplate(input: PickTemplateInput): Promise<PickedTemplateId> {
  const result = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    output: Output.object({ schema: PickerOutput }),
    system: SYSTEM_PROMPT,
    prompt: `Producto: "${input.name}"\nCategoría: "${input.category ?? "sin categoría"}"\n\nElige la plantilla óptima.`,
  })
  return result.output.template_id
}
