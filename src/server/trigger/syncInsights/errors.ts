import { taskError } from "@/lib/errors/task-error.ts"
import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { SyncInsightsErrorCode } from "./metadata.ts"

/**
 * Per-task `taskError` helper bound to {@link SyncInsightsErrorCode}.
 * Use inside the syncInsights task body so error codes are constrained at
 * compile time.
 *
 * Function declaration (not an arrow const) preserves TS narrowing.
 */
export function syncInsightsError(code: SyncInsightsErrorCode, message: string): never {
  taskError(code, message)
}

const RETRY: ErrorAction = { kind: "retry" }
const RECONNECT_META: ErrorAction = { kind: "reconnect_integration", provider: "meta" }
const NONE: ErrorAction = { kind: "none" }

export const SYNC_INSIGHTS_ERROR_MAP: Record<
  Exclude<SyncInsightsErrorCode, "generic_fallback">,
  TranslatedError
> = {
  meta_token_expired: {
    titleEs: "Tu sesión de Meta expiró",
    bodyEs: "Reconecta tu cuenta de Meta para volver a sincronizar las métricas.",
    action: RECONNECT_META,
  },
  meta_quota: {
    titleEs: "Meta nos pidió bajar el ritmo",
    bodyEs: "Llegamos al límite de la API de Meta. La próxima sincronización lo resolverá sola.",
    action: RETRY,
  },
  meta_api_failure: {
    titleEs: "Meta no respondió",
    bodyEs:
      "La API de Meta devolvió un error temporal. La próxima sincronización debería traer los datos faltantes.",
    action: RETRY,
  },
  no_active_ads: {
    titleEs: "No hay anuncios activos",
    bodyEs:
      "Aún no tienes campañas con anuncios activos. Las métricas aparecerán cuando lances una.",
    action: NONE,
  },
}
