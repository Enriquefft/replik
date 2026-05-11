import { taskError } from "@/lib/errors/task-error.ts"
import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { BurnErrorCode } from "./metadata.ts"

/**
 * Per-task `taskError` helper bound to {@link BurnErrorCode}.
 * Declared as a `function` (not an arrow) so TypeScript's control-flow
 * analysis narrows after `if (!x) burnError(...)`.
 */
export function burnError(code: BurnErrorCode, message: string): never {
  taskError(code, message)
}

const RETRY: ErrorAction = { kind: "retry" }

export const BURN_ERROR_MAP: Record<Exclude<BurnErrorCode, "generic_fallback">, TranslatedError> = {
  source_unavailable: {
    titleEs: "No pudimos descargar el video original",
    bodyEs:
      "El enlace del creativo ya no responde. Reintenta — si persiste, vuelve atrás y selecciona otro video.",
    action: RETRY,
  },
  whisper_timeout: {
    titleEs: "Tardamos demasiado transcribiendo",
    bodyEs:
      "La transcripción de audio se pasó del tiempo permitido. Reintenta — suele resolverse al segundo intento.",
    action: RETRY,
  },
  translate_failed: {
    titleEs: "Falló la traducción de subtítulos",
    bodyEs:
      "El traductor devolvió un resultado inválido. Reintenta para que regrese a generar el SRT.",
    action: RETRY,
  },
  ffmpeg_failed: {
    titleEs: "El video se rompió al quemar subtítulos",
    bodyEs:
      "FFmpeg tuvo un error al renderizar. Reintenta — si persiste, contáctanos para revisar el creativo.",
    action: RETRY,
  },
  upload_failed: {
    titleEs: "No pudimos subir el video editado",
    bodyEs: "UploadThing rechazó la subida final. Reintenta para que cargue el MP4 nuevamente.",
    action: RETRY,
  },
}
