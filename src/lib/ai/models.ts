import { createHash } from "node:crypto"

/**
 * Model identifiers — single source of truth for all LLM call sites.
 * See docs/ai-2.0.md §2.
 */
export const MODELS = {
  CREATIVE: "claude-opus-4-7", // copy gen, copy-gen judge, SRT translate, adjustCopy chat
  CLASSIFIER: "claude-sonnet-4-6", // template pick, scrape gap-fill, sales-angle classify
  // Fast / cheap path — short Spanish error-message translation only. Picked
  // over CLASSIFIER because the task is bounded (≤200 tokens output) and the
  // user-facing latency budget is sub-second; Haiku is ~5x faster.
  FAST_TRANSLATE: "claude-haiku-4-5",
  WHISPER_TEXT: "gpt-4o-mini-transcribe", // scrape transcription pass
  WHISPER_SRT: "whisper-1", // SRT pass — only OpenAI STT model with segment timestamps
} as const

/** Default temperature for all LLM calls unless overridden. */
export const defaultTemperature = 0

/** Temperature for copy-gen creative calls (§11 Stage 1). */
export const copyGenTemperature = 0.6

/** Temperature for sales-angle self-consistency calls (§12). */
export const salesAngleTemperature = 0.3

/**
 * Compute a short run hash for variance tracking.
 * Anthropic does not expose a seed parameter, so we log a SHA-256 hex
 * digest (first 16 chars) of the serialised input per run.
 *
 * Pure function — no side effects.
 */
export function runHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
