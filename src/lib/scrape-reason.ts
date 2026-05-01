/**
 * Single source of truth for scrape failure → user-facing copy.
 *
 * Codes flow from two places:
 *   1. The pre-insert URL probe (`src/lib/url-probe.ts`) — surfaced inline on
 *      the /new form before any DB row exists.
 *   2. The scrape trigger task (`src/server/trigger/scrapeProduct/index.ts`)
 *      — persisted on `products.scrape_reason` and rendered by RetryScrapeCard
 *      / ScrapeProgress's failure branch.
 *
 * Adding a new code: extend `ScrapeReasonCode`, add a branch in
 * `scrapeReasonCopy`, and (if it's a dynamic raw form like `entry-fetch-http-N`)
 * teach `normalizeScrapeReason` to fold it.
 */

import { z } from "zod"

export const ScrapeReasonCode = z.enum([
  "entry-fetch-failed",
  "entry-fetch-http-4xx",
  "entry-fetch-http-5xx",
  "non-html",
  "invalid-url",
  "stage-c-failed",
  "image-missing",
  "no-keywords",
  "no-ads",
  "task-crashed",
  "unknown",
])
export type ScrapeReasonCode = z.infer<typeof ScrapeReasonCode>

const HTTP_4XX_PREFIX = "entry-fetch-http-4"
const HTTP_5XX_PREFIX = "entry-fetch-http-5"

/**
 * Fold a raw reason string (from logs, the scrape pipeline, or the probe)
 * into a stable enum value. Unknown inputs collapse to `"unknown"`.
 */
export function normalizeScrapeReason(raw: string | null | undefined): ScrapeReasonCode {
  if (raw === null || raw === undefined || raw.length === 0) return "unknown"
  if (raw.startsWith(HTTP_4XX_PREFIX)) return "entry-fetch-http-4xx"
  if (raw.startsWith(HTTP_5XX_PREFIX)) return "entry-fetch-http-5xx"
  // Some scrape paths report `fetch failed` (Node's TypeError message) when
  // the entry URL never resolves. Map those to the bucketed code.
  if (raw === "fetch failed" || raw === "entry-fetch-failed") return "entry-fetch-failed"
  const parsed = ScrapeReasonCode.safeParse(raw)
  return parsed.success ? parsed.data : "unknown"
}

export interface ScrapeReasonCopy {
  title: string
  detail: string
  hint?: string
}

/**
 * Map a code to Spanish copy. `sourceUrl` is intentionally accepted (and may
 * be referenced inside `detail`) so callers don't need to template it
 * themselves — keeps the contract uniform.
 */
export function scrapeReasonCopy(
  rawCode: string | null | undefined,
  sourceUrl: string,
): ScrapeReasonCopy {
  const code = normalizeScrapeReason(rawCode)
  const host = safeHost(sourceUrl)
  switch (code) {
    case "entry-fetch-failed":
      return {
        title: "No pudimos abrir esta URL",
        detail: `El dominio ${host} no respondió. Verifica que esté escrito correctamente o pruébalo en tu navegador.`,
        hint: "Errores típicos: dominio mal escrito, sitio caído o sin conexión.",
      }
    case "entry-fetch-http-4xx":
      return {
        title: "La página no existe",
        detail: `${host} devolvió un error 4xx. Probablemente el producto cambió de URL o ya no está disponible.`,
        hint: "Copia la URL desde la barra del navegador en una pestaña abierta.",
      }
    case "entry-fetch-http-5xx":
      return {
        title: "El sitio del competidor falló",
        detail: `${host} devolvió un error 5xx. Inténtalo de nuevo en unos minutos.`,
      }
    case "non-html":
      return {
        title: "Esta URL no es una página de producto",
        detail:
          "Apunta a un PDF, imagen o recurso no-HTML. Pega el link de la ficha del producto en el sitio del competidor.",
      }
    case "invalid-url":
      return {
        title: "URL inválida",
        detail: "Debe empezar con http:// o https:// y tener un dominio válido.",
      }
    case "stage-c-failed":
      return {
        title: "Nuestro extractor no pudo procesar la página",
        detail:
          "Cargamos el HTML pero no logramos sacar los datos del producto. Reintenta o usa la URL de otro competidor.",
      }
    case "image-missing":
      return {
        title: "Detectamos el producto, pero no su imagen",
        detail:
          "El sitio no expone una imagen principal utilizable. Prueba con otra URL del mismo producto o sube la imagen manualmente desde el editor.",
      }
    case "no-keywords":
      return {
        title: "Esta página tiene muy poca información",
        detail:
          "No pudimos generar keywords para buscar anuncios en Meta Ad Library. Asegúrate de que la URL apunte a la ficha individual del producto, no a una colección.",
      }
    case "no-ads":
      return {
        title: "No encontramos anuncios activos",
        detail:
          "Meta Ad Library y Apify no devolvieron resultados para este producto. Prueba con un competidor más grande o más activo en publicidad.",
      }
    case "task-crashed":
      return {
        title: "El análisis falló",
        detail: "Algo inesperado ocurrió procesando este producto. Reintenta o cambia la URL.",
      }
    case "unknown":
      return {
        title: "Análisis incompleto",
        detail: "No pudimos completar el análisis de este producto. Reintenta o usa otra URL.",
      }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
