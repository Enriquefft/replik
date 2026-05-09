/**
 * Product-image picker — Phase 1 (Bug B).
 *
 * Given a list of candidate image URLs harvested from a competitor product
 * page (deduped + junk-filtered upstream, capped at 12), pick the 1-3 best
 * actual product photos via a vision-capable LLM. Output is an ordered
 * list of URLs (best first).
 *
 * The picker is meant to reject:
 *   - storefront logos / brand promo squares,
 *   - lifestyle / social-card crops that don't show the product,
 *   - models / influencer headshots,
 *   - banners / category tiles.
 *
 * Fallback: on any unrecoverable error the picker returns
 * `[candidateUrls[0]]` so the pipeline never blocks on Bug B alone.
 */
import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import { generateText, Output } from "ai"

import { defaultTemperature, MODELS } from "@/lib/ai/models.ts"
import { withRetry } from "@/lib/ai/retry.ts"
import { type ImagePickInput, ImagePickResultSchema } from "@/lib/ai/schemas.ts"
import { logEvent, withTiming } from "@/lib/observability/log.ts"

// ─── System prompt ───────────────────────────────────────────────────────────

/**
 * The picker is vision-led: the text reinforces the goal, but the model
 * decides on the rendered images. Spanish is intentional — Replik targets
 * es-PE / es-LATAM creatives and Sonnet's Spanish grounding is stronger
 * when prompts stay in-locale.
 *
 * Shape branches the criteria. PDP candidates come from a product detail
 * page where studio shots dominate, so we hold a high bar (clean bg,
 * product-only). Non-PDP candidates come from homepages / collections
 * where the only product photos are in-context lifestyle shots; rejecting
 * lifestyle there leaves the picker with logos and banners — exactly the
 * regression we hit on floreriabloom.com. On non-PDP the picker accepts
 * lifestyle frames where the product is the subject and explicitly
 * rejects text-heavy promo banners (which are common homepage hero tiles).
 */
export function imagePickSystemPrompt(shape: "pdp" | "non_pdp"): string {
  const preferCriteria =
    shape === "pdp"
      ? [
          "- Producto solo, fondo limpio (blanco / gris suave / liso).",
          "- Producto bien iluminado, en foco, ocupando >40% del cuadro.",
          "- Vista frontal o tres-cuartos del producto físico.",
        ]
      : [
          "- Producto físico claramente visible, en foco, ocupando >40% del cuadro.",
          "- Acepta fondos lifestyle si el producto es el sujeto principal (caja de flores sobre mesa, arreglo en escena de regalo, set de cocina en uso).",
          "- Vista frontal, lateral o tres-cuartos del producto físico.",
          "- Prefiere imágenes con poco o nada de texto sobreimpreso.",
        ]

  const distantRejection =
    shape === "pdp"
      ? "- Lifestyle distantes, escenas de uso donde el producto se pierde."
      : "- Escenas distantes donde el producto se pierde o es secundario al fondo."

  const rejectCriteria = [
    "- Logos de la tienda, isotipos, banners de marca, marcas de agua.",
    "- Fotos de modelos / influencers donde el producto no es el sujeto.",
    distantRejection,
    "- Tiles de categoría, carteles promocionales, capturas de redes sociales.",
    "- Imágenes con texto sobreimpreso prominente (precios, ofertas, fechas, nombres de campañas).",
    "- Renders abstractos o ilustraciones que no muestran el producto real.",
  ]

  return [
    "Eres un curador visual para landings de e-commerce.",
    "Recibes 1 a 12 imágenes candidatas (numeradas 0..N-1) y la ficha de un producto (nombre + categoría).",
    "Antes de cada imagen verás una línea `[idx N] archivo: <slug>`. El slug del archivo es una pista importante: nombres como `logo-*`, `log-*`, `brand-*`, `isotipo-*`, `marca-*` casi siempre son logos. Nombres como `portada-*`, `hero-*`, `banner-*`, `pack-*`, `cuotas-*`, `oferta-*`, `descuento-*`, `dia-de-*`, `promocion-*` casi siempre son banners promocionales. Nombres descriptivos del producto (`box-rosas-rojas`, `arreglo-girasoles`, `ramo-aniversario`, `pack-de-ollas`, `set-cocina`) casi siempre son fotos del producto. Combina la pista del slug con lo que ves en la imagen.",
    "Tu tarea es escoger 1 a 3 índices que correspondan a la MEJOR fotografía del producto en sí.",
    "",
    "Criterios de selección (preferir):",
    ...preferCriteria,
    "",
    "Rechazar (NO seleccionar):",
    ...rejectCriteria,
    "",
    "Ordena los índices del MEJOR al menos bueno.",
    'Devuelve EXACTAMENTE un JSON con la forma {"selectedIndices": [<int>...]}.',
    "Los índices deben ser enteros no negativos < número de candidatas.",
  ].join("\n")
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build the per-call user prompt. Lists each candidate by its zero-based
 * index so the LLM can reference them positionally — no URL strings in the
 * answer.
 */
export function buildImagePickPrompt(input: ImagePickInput): string {
  return [
    `Producto: ${input.productName}`,
    `Categoría: ${input.category}`,
    `Número de candidatas: ${input.candidateUrls.length.toString()}`,
    "Las imágenes adjuntas están en orden, índice 0 primero.",
    "Devuelve los índices de las 1-3 mejores fotos del producto.",
  ].join("\n")
}

// ─── LLM message builder ─────────────────────────────────────────────────────

interface ImageContentPart {
  type: "image"
  image: URL
}
interface TextContentPart {
  type: "text"
  text: string
}
type UserContent = (ImageContentPart | TextContentPart)[]

/**
 * Extract the URL's last path segment, decoded, lower-cased, with the
 * extension preserved. Used as a per-image hint so the vision model can
 * read the filename alongside the pixels — slug-based heuristics catch
 * brand-logo files (`Log-Bloom.png`) that pass `isViableImageCandidate`'s
 * substring check ("logo" doesn't match "log-bloom").
 */
export function extractCandidateSlug(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  const segments = parsed.pathname.split("/").filter(Boolean)
  const last = segments.length > 0 ? segments[segments.length - 1] : ""
  if (!last) return parsed.hostname.toLowerCase()
  try {
    return decodeURIComponent(last).toLowerCase()
  } catch {
    return last.toLowerCase()
  }
}

function buildUserMessage(input: ImagePickInput): {
  role: "user"
  content: UserContent
} {
  const interleaved: UserContent = []
  for (let i = 0; i < input.candidateUrls.length; i += 1) {
    const url = input.candidateUrls[i]
    if (!url) continue
    const slug = extractCandidateSlug(url)
    interleaved.push({ type: "text", text: `[idx ${i.toString()}] archivo: ${slug}` })
    interleaved.push({ type: "image", image: new URL(url) })
  }
  interleaved.push({ type: "text", text: buildImagePickPrompt(input) })
  return { role: "user", content: interleaved }
}

// ─── LLM calls ───────────────────────────────────────────────────────────────

async function callPrimary(input: ImagePickInput, model: LanguageModel): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.json(),
    temperature: defaultTemperature,
    system: imagePickSystemPrompt(input.shape),
    messages: [buildUserMessage(input)],
  })
  return result.output
}

async function callBumped(
  input: ImagePickInput,
  critique: string,
  bumpedModel: LanguageModel,
): Promise<unknown> {
  const result = await generateText({
    model: bumpedModel,
    output: Output.json(),
    temperature: defaultTemperature,
    system: imagePickSystemPrompt(input.shape),
    messages: [
      buildUserMessage(input),
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "<previous_attempt>Respuesta inválida.</previous_attempt>",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<critique>${critique}</critique>\nReintenta y devuelve {"selectedIndices": [...]} con índices válidos.`,
          },
        ],
      },
    ],
  })
  return result.output
}

// ─── Validate ────────────────────────────────────────────────────────────────

/**
 * Build a synchronous validator closed over the candidate count.
 *
 * The schema enforces shape (1-3 non-negative integers); this guard adds
 * the bound check `index < candidateUrls.length` (the spec calls it OOR —
 * out of range). OOR triggers the bumped retry with a precise critique
 * pointing at the offending index.
 */
function makeValidator(candidateCount: number) {
  return (raw: unknown): { ok: true } | { ok: false; critique: string } => {
    const parsed = ImagePickResultSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const critique = issue
        ? `selectedIndices schema invalid: ${issue.message} at ${issue.path.join(".")}`
        : "selectedIndices must be a non-empty array of 1-3 non-negative integers."
      return { ok: false, critique }
    }
    for (const idx of parsed.data.selectedIndices) {
      if (idx >= candidateCount) {
        return {
          ok: false,
          critique: `index ${idx.toString()} is out of range (candidates: 0..${(candidateCount - 1).toString()}).`,
        }
      }
    }
    return { ok: true }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface PickProductImagesDeps {
  primaryModel?: LanguageModel
  bumpedModel?: LanguageModel
}

/**
 * Pick 1-3 product images from the candidate set. Returns a list of URLs
 * ordered best-first. Never throws — on unrecoverable failure returns
 * `[candidateUrls[0]]`.
 *
 * The fallback URL choice is deliberate: Stage A's candidate list is
 * already discovery-ordered, so candidate 0 is the JSON-LD `image[0]` /
 * og:image — the strongest deterministic signal we have.
 */
export async function pickProductImages(
  input: ImagePickInput,
  deps: PickProductImagesDeps = {},
): Promise<string[]> {
  const primaryModel = deps.primaryModel ?? anthropic(MODELS.CLASSIFIER)
  const bumpedModel = deps.bumpedModel ?? anthropic(MODELS.CREATIVE)
  const validator = makeValidator(input.candidateUrls.length)

  const fallbackUrl = input.candidateUrls[0]
  if (!fallbackUrl) {
    // Shape validator on the input schema enforces .min(1), so this
    // branch is only reachable if a caller constructs the input
    // bypassing zod. Return an empty list — the call site treats that
    // as SCRAPE_PARTIAL.
    return []
  }

  const raw = await withTiming(
    "ai.image_pick",
    () =>
      withRetry<ImagePickInput, unknown>(
        {
          primary: (inp) => callPrimary(inp, primaryModel),
          bumped: (inp, critique) => callBumped(inp, critique, bumpedModel),
          fallback: () => ({ selectedIndices: [0] as const }),
          validate: validator,
        },
        input,
      ),
    { candidates: input.candidateUrls.length, category: input.category },
  )

  const parsed = ImagePickResultSchema.safeParse(raw)
  if (!parsed.success) {
    logEvent("ai.image_pick.decision", {
      shape: input.shape,
      candidates: input.candidateUrls,
      selectedIndices: null,
      output: [fallbackUrl],
      reason: "schema-fallback",
    })
    return [fallbackUrl]
  }

  const seen = new Set<number>()
  const out: string[] = []
  for (const idx of parsed.data.selectedIndices) {
    if (idx < 0 || idx >= input.candidateUrls.length) continue
    if (seen.has(idx)) continue
    seen.add(idx)
    const url = input.candidateUrls[idx]
    if (url) out.push(url)
  }
  if (out.length === 0) {
    logEvent("ai.image_pick.decision", {
      shape: input.shape,
      candidates: input.candidateUrls,
      selectedIndices: parsed.data.selectedIndices,
      output: [fallbackUrl],
      reason: "empty-after-dedup-fallback",
    })
    return [fallbackUrl]
  }
  logEvent("ai.image_pick.decision", {
    shape: input.shape,
    candidates: input.candidateUrls,
    selectedIndices: parsed.data.selectedIndices,
    output: out,
    reason: "ok",
  })
  return out
}
