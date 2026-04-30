import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * HTTP transport for Meta Marketing API + Ad Library API.
 *
 * Responsibilities:
 *   - Wrap `fetch` with retry/backoff (3 attempts, exp. backoff w/ jitter).
 *   - Retry on HTTP 5xx, HTTP 429, and Meta error codes 17 (user request
 *     limit) and 4 (rate limit). Never retry on 4xx auth/validation errors.
 *   - Parse Meta's error envelope and translate the most common codes into
 *     friendly Spanish messages (`MetaError`).
 *   - Trigger the token-expiry side effect when code 190 is observed and
 *     the caller passed `userId` on `MetaCreds`.
 *
 * Anything HTTP-shaped goes through `metaFetch` / `metaFetchJson` so the
 * retry + error-mapping invariants hold for every endpoint.
 */

import { markIntegrationExpired } from "./expiry"
import { type MetaCreds, MetaError } from "./types"

interface MetaApiError {
  code?: number
  error_subcode?: number
  message?: string
  type?: string
  fbtrace_id?: string
}

interface MetaErrorEnvelope {
  error?: MetaApiError
}

const RETRY_META_CODES = new Set<number>([4, 17])
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400

function backoffMs(attempt: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  const jitter = Math.floor(Math.random() * 100)
  return exp + jitter
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function friendlyForMetaCode(code: number, fallback: string): string {
  switch (code) {
    case 190:
      return "Tu sesión Meta expiró. Renueva el token."
    case 100:
      return "Parámetro inválido en la petición."
    case 17:
    case 4:
      return "Demasiadas peticiones, intenta de nuevo."
    case 200:
      return "El token no tiene los permisos necesarios."
    default:
      return fallback || "Error en la API de Meta."
  }
}

async function readErrorEnvelope(response: Response): Promise<MetaApiError | null> {
  try {
    const body = (await response.clone().json()) as MetaErrorEnvelope
    return body.error ?? null
  } catch {
    return null
  }
}

async function buildMetaError(response: Response): Promise<MetaError> {
  const envelope = await readErrorEnvelope(response)
  const code = envelope?.code ?? response.status
  const message = envelope?.message ?? response.statusText
  const friendly = friendlyForMetaCode(code, message)
  return new MetaError({
    code,
    error_subcode: envelope?.error_subcode,
    fbtrace_id: envelope?.fbtrace_id,
    message,
    friendly,
  })
}

function shouldRetry(status: number, metaCode: number | undefined): boolean {
  if (status >= 500) return true
  if (status === 429) return true
  if (metaCode !== undefined && RETRY_META_CODES.has(metaCode)) return true
  return false
}

export interface MetaFetchOptions {
  method?: "GET" | "POST" | "DELETE"
  /** Form-encoded body for `application/x-www-form-urlencoded` POSTs. */
  form?: Record<string, string>
  /** Pre-built body for binary or multipart payloads. */
  body?: BodyInit
  headers?: Record<string, string>
  /** Optional creds — used purely so we can mark token expired on code 190. */
  creds?: MetaCreds
  /** Override default attempt cap (e.g. uploads tune lower / higher). */
  maxAttempts?: number
}

/**
 * Low-level fetch with retries + Meta error mapping. Returns the `Response`
 * on success (caller decodes); on any non-success response after retries it
 * throws `MetaError`. Network failures are also retried.
 */
export async function metaFetch(url: string, options: MetaFetchOptions = {}): Promise<Response> {
  const method = options.method ?? "GET"
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  let body: BodyInit | undefined = options.body
  if (options.form && body === undefined) {
    body = new URLSearchParams(options.form).toString()
    headers["Content-Type"] ??= "application/x-www-form-urlencoded"
  }
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response | undefined
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
      })
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new MetaError({
        code: 0,
        friendly: "No se pudo conectar con Meta.",
        message: err instanceof Error ? err.message : "network error",
      })
    }

    if (response.ok) return response

    const envelope = await readErrorEnvelope(response)
    const metaCode = envelope?.code
    const retry = shouldRetry(response.status, metaCode)

    if (retry && attempt < maxAttempts) {
      await sleep(backoffMs(attempt))
      continue
    }

    const error = await buildMetaError(response)

    // Token expiry side effect — fire-and-forget, never blocks the throw.
    if (error.code === 190 && options.creds?.userId) {
      try {
        await markIntegrationExpired(options.creds.userId, "meta")
      } catch {
        // Swallow: we still want to surface the original auth error.
      }
    }

    throw error
  }

  // Unreachable, but TypeScript wants a return path.
  throw new MetaError({
    code: 0,
    friendly: "Falla desconocida llamando a Meta.",
    message: lastError instanceof Error ? lastError.message : "unknown failure",
  })
}

/** Convenience: fetch + decode JSON, with the same retry semantics. */
export async function metaFetchJson<T>(url: string, options: MetaFetchOptions = {}): Promise<T> {
  const response = await metaFetch(url, options)
  return (await response.json()) as T
}
