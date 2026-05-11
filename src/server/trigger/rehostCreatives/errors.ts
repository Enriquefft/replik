import type { ErrorAction, TranslatedError } from "@/lib/errors/translate.ts"
import type { RehostErrorCode } from "./metadata.ts"

const RETRY: ErrorAction = { kind: "retry" }
const SUPPORT: ErrorAction = { kind: "contact_support" }

export const REHOST_ERROR_MAP: Record<
  Exclude<RehostErrorCode, "generic_fallback">,
  TranslatedError
> = {
  source_unavailable: {
    titleEs: "No pudimos descargar los videos seleccionados",
    bodyEs: "Los enlaces originales ya no responden. Vuelve atrás y selecciona otros creativos.",
    action: { kind: "edit_input" },
  },
  uploadthing_failed: {
    titleEs: "Falló la subida a nuestro almacenamiento",
    bodyEs: "UploadThing rechazó los videos. Reintenta — suele resolverse al segundo intento.",
    action: RETRY,
  },
  burn_batch_failed: {
    titleEs: "Falló la edición de todos los videos",
    bodyEs:
      "Ningún creativo terminó de editarse. Reintenta — si persiste, contáctanos para revisarlo.",
    action: SUPPORT,
  },
}
