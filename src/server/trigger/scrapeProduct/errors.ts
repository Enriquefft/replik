import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { ScrapeErrorCode } from "./metadata.ts"

const RETRY: ErrorAction = { kind: "retry" }
const EDIT_INPUT: ErrorAction = { kind: "edit_input" }
const SUPPORT: ErrorAction = { kind: "contact_support" }

/**
 * Deterministic Spanish (LatAm) copy for every known scrape failure mode.
 * Keys MUST match `SCRAPE_ERROR_CODES`. The `generic_fallback` code is
 * intentionally omitted — the translator routes those to the LLM.
 */
export const SCRAPE_ERROR_MAP: Record<
  Exclude<ScrapeErrorCode, "generic_fallback">,
  TranslatedError
> = {
  apify_quota: {
    titleEs: "Sin créditos para buscar anuncios",
    bodyEs:
      "Nuestro proveedor de scraping (Apify) está sin cupos por ahora. Intenta de nuevo en unos minutos.",
    action: RETRY,
  },
  target_unreachable: {
    titleEs: "No pudimos abrir la página del competidor",
    bodyEs:
      "La URL bloqueó nuestro análisis o devolvió un error. Verifica el enlace e inténtalo otra vez.",
    action: EDIT_INPUT,
  },
  whisper_timeout: {
    titleEs: "Tardamos demasiado transcribiendo",
    bodyEs:
      "La transcripción de audio se tomó más de lo permitido. Reintenta — suele resolverse al segundo intento.",
    action: RETRY,
  },
  video_oversize: {
    titleEs: "Los videos del competidor son demasiado grandes",
    bodyEs:
      "Cada anuncio superó nuestro límite de 25 MB para transcribir. Encontramos los videos pero no pudimos leer el guion.",
    action: SUPPORT,
  },
  no_keywords: {
    titleEs: "No detectamos palabras clave",
    bodyEs:
      "La página no tenía suficiente contenido para extraer keywords. Prueba con una URL de producto en vez de la home.",
    action: EDIT_INPUT,
  },
  no_ads: {
    titleEs: "Esta marca no tiene anuncios activos",
    bodyEs:
      "No encontramos creativos en Meta Ad Library ni TikTok. La competencia puede no estar pautando ahora mismo.",
    action: EDIT_INPUT,
  },
}
