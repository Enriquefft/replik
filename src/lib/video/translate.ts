import "server-only"
import { anthropic } from "@ai-sdk/anthropic"
import { generateText, Output } from "ai"
import { z } from "zod"

const MODEL_ID = "claude-sonnet-4-5"

interface SrtCue {
  index: string
  timing: string
  text: string
}

const TranslatedCueSchema = z.object({
  index: z.number().int().min(1),
  text: z.string(),
})

const TranslationSchema = z.object({
  cues: z.array(TranslatedCueSchema),
})

const TARGET_INSTRUCTIONS: Record<"es-PE", string> = {
  "es-PE":
    "español peruano natural y coloquial (registro hablado de Lima/Perú). " +
    "No uses 'vosotros'. Mantén el tono publicitario del original.",
}

/**
 * Translate every cue in an SRT to the target language in a single LLM call.
 * Timestamps are preserved verbatim — only the cue text changes. The model
 * sees a JSON array of `{ index, text }` and returns the same shape, so cue
 * order, count, and indexing cannot drift.
 */
export async function translateSrt(srt: string, targetLang: "es-PE"): Promise<string> {
  const cues = parseSrt(srt)
  if (cues.length === 0) return srt

  const inputCues = cues.map((cue, i) => ({
    index: i + 1,
    text: cue.text,
  }))

  const result = await generateText({
    model: anthropic(MODEL_ID),
    output: Output.object({ schema: TranslationSchema }),
    system: [
      "Eres un traductor publicitario profesional.",
      "Tu trabajo es traducir cada subtítulo de un video al idioma indicado,",
      "preservando intención, ritmo y longitud aproximada para que quepa en",
      "el mismo tiempo en pantalla. No agregues comentarios ni texto extra.",
      "Devuelve exactamente el mismo número de cues, en el mismo orden,",
      "con el mismo `index`. NUNCA fusiones ni dividas cues.",
    ].join(" "),
    prompt: [
      `Traduce los siguientes subtítulos a ${TARGET_INSTRUCTIONS[targetLang]}`,
      "",
      "Entrada (JSON):",
      JSON.stringify(inputCues),
    ].join("\n"),
  })

  const translated = result.output.cues
  if (translated.length !== cues.length) {
    throw new Error(
      `translateSrt: cue count drift (in=${cues.length.toString()}, out=${translated.length.toString()})`,
    )
  }

  const byIndex = new Map<number, string>()
  for (const cue of translated) {
    byIndex.set(cue.index, cue.text)
  }

  const lines: string[] = []
  cues.forEach((cue, i) => {
    const cueIndex = i + 1
    const newText = byIndex.get(cueIndex)
    if (newText === undefined) {
      throw new Error(`translateSrt: missing translation for cue ${cueIndex.toString()}`)
    }
    lines.push(cue.index, cue.timing, newText.trim(), "")
  })
  return lines.join("\n")
}

/**
 * Tolerant SRT parser: splits on blank lines, accepts both `\n` and `\r\n`,
 * preserves multi-line cue text by joining with a space (libass renders one
 * cue per --> block regardless of internal line breaks).
 */
function parseSrt(srt: string): SrtCue[] {
  const blocks = srt.replace(/\r\n/g, "\n").split(/\n{2,}/)
  const cues: SrtCue[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (trimmed.length === 0) continue
    const lines = trimmed.split("\n")
    const indexLine = lines[0]
    const timingLine = lines[1]
    if (indexLine === undefined || timingLine === undefined) continue
    if (!timingLine.includes("-->")) continue
    const text = lines.slice(2).join(" ").trim()
    if (text.length === 0) continue
    cues.push({ index: indexLine.trim(), timing: timingLine.trim(), text })
  }
  return cues
}
