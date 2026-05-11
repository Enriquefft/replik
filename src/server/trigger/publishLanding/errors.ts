import { taskError } from "@/lib/errors/task-error.ts"
import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { PublishErrorCode } from "./metadata.ts"

/**
 * Per-task `taskError` helper bound to {@link PublishErrorCode}.
 * Use inside the publishLanding task body so typos in the code argument
 * fail at compile time instead of leaking through to the translator as
 * `generic_fallback`.
 *
 * Declared as a `function` (not an arrow assigned to a const) so
 * TypeScript's control-flow analysis narrows after
 * `if (!x) publishError(...)`.
 */
export function publishError(code: PublishErrorCode, message: string): never {
  taskError(code, message)
}

const RETRY: ErrorAction = { kind: "retry" }
const RECONNECT_SHOPIFY: ErrorAction = { kind: "reconnect_integration", provider: "shopify" }
const EDIT_INPUT: ErrorAction = { kind: "edit_input" }

export const PUBLISH_ERROR_MAP: Record<
  Exclude<PublishErrorCode, "generic_fallback">,
  TranslatedError
> = {
  shopify_token_expired: {
    titleEs: "Tu sesión de Shopify expiró",
    bodyEs: "Reconecta tu tienda de Shopify para volver a publicar la landing.",
    action: RECONNECT_SHOPIFY,
  },
  shopify_api_failure: {
    titleEs: "Shopify no respondió",
    bodyEs: "La tienda devolvió un error al publicar. Reintenta — suele resolverse en segundos.",
    action: RETRY,
  },
  missing_creatives: {
    titleEs: "No hay videos editados para la landing",
    bodyEs:
      "Necesitamos al menos un creativo editado para elegir el video principal. Termina la edición primero.",
    action: EDIT_INPUT,
  },
  landing_body_invalid: {
    titleEs: "El generador de contenido devolvió algo inválido",
    bodyEs:
      "El cuerpo de la landing no pasó nuestras validaciones. Reintenta para que vuelva a generarlo.",
    action: RETRY,
  },
  template_render_failed: {
    titleEs: "Falló el render de la plantilla",
    bodyEs:
      "No pudimos combinar los textos e imágenes en el template. Reintenta — si persiste, contáctanos.",
    action: RETRY,
  },
  integration_incomplete: {
    titleEs: "Tu integración de Shopify está incompleta",
    bodyEs:
      "Falta algún dato de tu tienda. Vuelve a conectar Shopify para completar la configuración.",
    action: RECONNECT_SHOPIFY,
  },
}
