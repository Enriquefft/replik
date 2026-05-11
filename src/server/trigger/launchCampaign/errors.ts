import { taskError } from "@/lib/errors/task-error.ts"
import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { LaunchErrorCode } from "./metadata.ts"

/**
 * Per-task `taskError` helper bound to {@link LaunchErrorCode}. Use
 * inside the launchCampaign task body so codes are type-checked against
 * the enum at every call site.
 *
 * Function declaration (not an arrow const) preserves TS narrowing.
 */
export function launchError(code: LaunchErrorCode, message: string): never {
  taskError(code, message)
}

const RETRY: ErrorAction = { kind: "retry" }
const RECONNECT_META: ErrorAction = { kind: "reconnect_integration", provider: "meta" }
const EDIT_INPUT: ErrorAction = { kind: "edit_input" }

export const LAUNCH_ERROR_MAP: Record<
  Exclude<LaunchErrorCode, "generic_fallback">,
  TranslatedError
> = {
  meta_token_expired: {
    titleEs: "Tu sesión de Meta expiró",
    bodyEs: "Reconecta tu cuenta de Meta para volver a lanzar la campaña.",
    action: RECONNECT_META,
  },
  meta_quota: {
    titleEs: "Meta nos pidió bajar el ritmo",
    bodyEs:
      "Llegamos al límite de la API de Meta. Espera unos minutos y reintenta — la cuota se reinicia sola.",
    action: RETRY,
  },
  meta_policy: {
    titleEs: "Meta rechazó tu anuncio por políticas",
    bodyEs:
      "El creativo o el copy no pasó la revisión automática. Revisa los textos y los videos antes de relanzar.",
    action: EDIT_INPUT,
  },
  meta_video_upload: {
    titleEs: "No pudimos subir un video a Meta",
    bodyEs:
      "La carga de uno de los creativos falló. Reintenta — usualmente se resuelve al segundo intento.",
    action: RETRY,
  },
  meta_image_upload: {
    titleEs: "No pudimos subir el thumbnail",
    bodyEs:
      "La carga de la imagen del producto a Meta falló. Reintenta para que vuelva a empujarla.",
    action: RETRY,
  },
  missing_creatives: {
    titleEs: "No hay creativos editados",
    bodyEs:
      "Necesitas al menos un video editado para lanzar. Vuelve a la edición y termina ese paso.",
    action: EDIT_INPUT,
  },
  landing_not_published: {
    titleEs: "Publica primero la landing",
    bodyEs: "Necesitamos la URL del producto en Shopify antes de crear los anuncios.",
    action: EDIT_INPUT,
  },
  integration_incomplete: {
    titleEs: "Tu integración de Meta está incompleta",
    bodyEs:
      "Falta el pixel, la cuenta publicitaria o la página. Vuelve a conectar Meta para completar los datos.",
    action: RECONNECT_META,
  },
}
