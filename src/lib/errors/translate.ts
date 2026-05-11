import "server-only"

import { createHash } from "node:crypto"
import { anthropic } from "@ai-sdk/anthropic"
import { generateText, Output } from "ai"
import { and, eq, gt } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "@/db/client"
import { errorTranslations } from "@/db/schema"
import { MODELS } from "@/lib/ai/models.ts"
import { logEvent } from "@/lib/observability/log.ts"
import type { TaskKind } from "@/lib/task-kind.ts"
import { LAUNCH_ERROR_MAP } from "@/server/trigger/launchCampaign/errors.ts"
import { LaunchErrorCodeSchema } from "@/server/trigger/launchCampaign/metadata.ts"
import { PUBLISH_ERROR_MAP } from "@/server/trigger/publishLanding/errors.ts"
import { PublishErrorCodeSchema } from "@/server/trigger/publishLanding/metadata.ts"
import { REHOST_ERROR_MAP } from "@/server/trigger/rehostCreatives/errors.ts"
import { RehostErrorCodeSchema } from "@/server/trigger/rehostCreatives/metadata.ts"
import { SCRAPE_ERROR_MAP } from "@/server/trigger/scrapeProduct/errors.ts"
import { ScrapeErrorCodeSchema } from "@/server/trigger/scrapeProduct/metadata.ts"
import { SYNC_INSIGHTS_ERROR_MAP } from "@/server/trigger/syncInsights/errors.ts"
import { SyncInsightsErrorCodeSchema } from "@/server/trigger/syncInsights/metadata.ts"
import { BURN_ERROR_MAP } from "@/server/trigger/translateAndBurnSubs/errors.ts"
import { BurnErrorCodeSchema } from "@/server/trigger/translateAndBurnSubs/metadata.ts"

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const ErrorActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("retry") }),
  z.object({
    kind: z.literal("reconnect_integration"),
    provider: z.enum(["meta", "shopify"]),
  }),
  z.object({ kind: z.literal("contact_support") }),
  z.object({ kind: z.literal("edit_input") }),
  z.object({ kind: z.literal("none") }),
])

export type ErrorAction = z.infer<typeof ErrorActionSchema>

export const TranslatedErrorSchema = z.object({
  titleEs: z.string().min(1).max(200),
  bodyEs: z.string().min(1).max(600),
  action: ErrorActionSchema,
})

export type TranslatedError = z.infer<typeof TranslatedErrorSchema>

// ─── Per-kind error maps (deterministic path) ────────────────────────────────

interface ErrorKindRegistryEntry {
  codeSchema: z.ZodType<string>
  map: Record<string, TranslatedError>
}

const REGISTRY: Record<TaskKind, ErrorKindRegistryEntry> = {
  scrape_product: { codeSchema: ScrapeErrorCodeSchema, map: SCRAPE_ERROR_MAP },
  translate_burn: { codeSchema: BurnErrorCodeSchema, map: BURN_ERROR_MAP },
  launch_campaign: { codeSchema: LaunchErrorCodeSchema, map: LAUNCH_ERROR_MAP },
  publish_landing: { codeSchema: PublishErrorCodeSchema, map: PUBLISH_ERROR_MAP },
  rehost_creatives: { codeSchema: RehostErrorCodeSchema, map: REHOST_ERROR_MAP },
  sync_insights: { codeSchema: SyncInsightsErrorCodeSchema, map: SYNC_INSIGHTS_ERROR_MAP },
}

// ─── Last-resort fallback (LLM unavailable) ──────────────────────────────────

const HARD_FALLBACK: TranslatedError = {
  titleEs: "Algo salió mal",
  bodyEs: "Inténtalo de nuevo o contáctanos si persiste.",
  action: { kind: "retry" },
}

// ─── Cache (24h TTL) ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function hashRaw(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

async function readCache(hash: string): Promise<TranslatedError | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS)
  const rows = await getDb()
    .select({ translated: errorTranslations.translated })
    .from(errorTranslations)
    .where(and(eq(errorTranslations.hash, hash), gt(errorTranslations.createdAt, cutoff)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const parsed = TranslatedErrorSchema.safeParse(row.translated)
  return parsed.success ? parsed.data : null
}

async function writeCache(hash: string, translated: TranslatedError): Promise<void> {
  await getDb()
    .insert(errorTranslations)
    .values({ hash, translated })
    .onConflictDoUpdate({
      target: errorTranslations.hash,
      set: { translated, createdAt: new Date() },
    })
}

// ─── LLM fallback path ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente que traduce mensajes de error técnicos a español latinoamericano para usuarios de una herramienta de marketing.

Reglas:
- Tono: amigable, profesional, directo. Nunca uses inglés.
- No uses palabras de relleno ("básicamente", "simplemente", "rápidamente").
- Prohibido el em-dash (—). Usa punto, coma, o paréntesis.
- Nunca expongas detalles técnicos del stack (nombres de librerías, códigos HTTP, stack traces).
- Devuelve JSON con exactamente estos campos:
  - titleEs: máx 80 caracteres, sin punto final.
  - bodyEs: 1-2 oraciones, máx 200 caracteres, con punto final.
  - action: uno de { kind: "retry" } | { kind: "reconnect_integration", provider: "meta" | "shopify" } | { kind: "contact_support" } | { kind: "edit_input" } | { kind: "none" }.
- Elige la action que mejor permita al usuario resolver el problema solo. Prefiere "retry" salvo evidencia clara de que necesita reconectar o editar.`

interface LlmTranslateInput {
  raw: string
  taskKind: TaskKind
}

async function llmTranslate(input: LlmTranslateInput): Promise<TranslatedError | null> {
  try {
    const result = await generateText({
      model: anthropic(MODELS.FAST_TRANSLATE),
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: TranslatedErrorSchema }),
      temperature: 0,
      prompt: [
        `taskKind: ${input.taskKind}`,
        "errorRaw:",
        "<UNTRUSTED>",
        input.raw,
        "</UNTRUSTED>",
      ].join("\n"),
    })
    return result.output
  } catch (err) {
    logEvent("errors.translate.llm_failed", {
      taskKind: input.taskKind,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface TranslateErrorInput {
  code: string | null
  raw: string
  taskKind: TaskKind
}

/**
 * Translate a Trigger.dev run error to a user-facing Spanish message.
 *
 * Decision flow:
 *   1. If `code` parses against the task's `ErrorCodeSchema` AND maps to a
 *      deterministic entry → return that entry verbatim. Synchronous, no
 *      LLM, no cache hit.
 *   2. Else hash `raw` (SHA256). On 24h cache hit → return cached.
 *   3. Else LLM (`MODELS.FAST_TRANSLATE`). On success → persist + return.
 *   4. LLM unavailable → return `HARD_FALLBACK`.
 *
 * Pure read-only on the deterministic path; writes a row to
 * `error_translations` on every fresh LLM success.
 */
export async function translateError(input: TranslateErrorInput): Promise<TranslatedError> {
  const registry = REGISTRY[input.taskKind]

  if (input.code !== null) {
    const codeParse = registry.codeSchema.safeParse(input.code)
    if (codeParse.success) {
      const mapped = registry.map[codeParse.data]
      if (mapped !== undefined) {
        return mapped
      }
      // Known code but no deterministic copy (e.g. `generic_fallback`) →
      // fall through to LLM path.
    }
  }

  const hash = hashRaw(input.raw)
  const cached = await readCache(hash)
  if (cached !== null) {
    return cached
  }

  const translated = await llmTranslate({ raw: input.raw, taskKind: input.taskKind })
  if (translated === null) {
    return HARD_FALLBACK
  }

  try {
    await writeCache(hash, translated)
  } catch (err) {
    // Cache write failures are non-fatal — the next call will retry. Log
    // for visibility but return the fresh translation we already have.
    logEvent("errors.translate.cache_write_failed", {
      taskKind: input.taskKind,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
  return translated
}
