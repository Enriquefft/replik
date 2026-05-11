import { z } from "zod"

/**
 * Structured error envelope thrown from inside Trigger.dev tasks.
 *
 * Why a string-encoded payload instead of an Error subclass:
 *   Trigger.dev's run failure path captures `error.name` + `error.message`
 *   on the run record (accessible via `run.error` on the realtime stream).
 *   The full instance is not preserved across the worker boundary — so we
 *   encode `{ code, message }` into the `message` field as a JSON string
 *   prefixed by a sentinel. The frontend uses `parseTaskErrorCode(rawMessage)`
 *   to extract the code; the LLM fallback receives the human-readable
 *   `message` half.
 *
 * Round-trip:
 *   - Server: `throw taskError("apify_quota", "Apify devolvió 429")`.
 *   - Client (run.error.message): `"TASK_ERROR:{\"code\":\"apify_quota\",\"message\":\"Apify devolvió 429\"}"`.
 *   - Client decodes via `parseTaskErrorCode` → `{ code, message }`.
 *
 * Strings only — no Error instance, no stack trace. We do NOT leak stack
 * traces to the user-facing translator (they go to Trigger.dev logs).
 */
const TASK_ERROR_PREFIX = "TASK_ERROR:"

const TaskErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
})

export type TaskErrorPayload = z.infer<typeof TaskErrorPayloadSchema>

/**
 * Throws a structured error that survives the Trigger.dev worker boundary.
 *
 * `code` is whatever string the calling task's `ErrorCodeSchema` accepts —
 * the translator validates it on the read side. `message` is the
 * developer-facing detail (logs, LLM fallback context). Do not put PII or
 * secrets in `message` — it ends up in the run's persisted error record.
 */
export function taskError<Code extends string>(code: Code, message: string): never {
  const payload: TaskErrorPayload = { code, message }
  throw new Error(`${TASK_ERROR_PREFIX}${JSON.stringify(payload)}`)
}

/**
 * Inverse of `taskError` — extract a `{ code, message }` from a run error
 * message. Returns `null` if the message wasn't produced by `taskError`
 * (e.g. an uncaught `TypeError` from a raw library throw).
 */
export function parseTaskErrorPayload(rawMessage: string | undefined): TaskErrorPayload | null {
  if (typeof rawMessage !== "string") return null
  if (!rawMessage.startsWith(TASK_ERROR_PREFIX)) return null
  const jsonSlice = rawMessage.slice(TASK_ERROR_PREFIX.length)
  try {
    const parsed = TaskErrorPayloadSchema.safeParse(JSON.parse(jsonSlice))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
