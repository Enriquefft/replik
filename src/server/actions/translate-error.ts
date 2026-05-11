"use server"

import { type TranslatedError, translateError } from "@/lib/errors/translate.ts"
import { TaskKindSchema } from "@/lib/task-kind.ts"

export interface TranslateRunErrorInput {
  code: string | null
  raw: string
  taskKind: string
}

/**
 * Client-side entry-point for the error translator. The `code` is whatever
 * `parseTaskErrorPayload` extracted from the run's error message; the
 * `raw` is the run's full error message (no PII — Trigger.dev exposes only
 * the public surface). `taskKind` is the caller's `TaskKind` — validated
 * against the SSOT zod enum because this is a client → server boundary.
 *
 * Returns the same hard fallback as `translateError` itself when validation
 * fails, so the UI never has to handle a null translation.
 */
export async function translateRunError(input: TranslateRunErrorInput): Promise<TranslatedError> {
  const taskKind = TaskKindSchema.safeParse(input.taskKind)
  if (!taskKind.success) {
    return {
      titleEs: "Algo salió mal",
      bodyEs: "Inténtalo de nuevo o contáctanos si persiste.",
      action: { kind: "retry" },
    }
  }
  return await translateError({
    code: input.code,
    raw: input.raw,
    taskKind: taskKind.data,
  })
}
