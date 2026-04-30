/**
 * Retry harness for LLM call sites (§6).
 *
 * Strategy: primary → bumped (one critique pass) → fallback.
 * Maximum 2 LLM tries. No agentic retry loops. Never throws upward.
 * The `validate` callback is synchronous — spec §6 mandates no awaitable validators.
 */

type ValidateOk = { ok: true }
type ValidateFail = { ok: false; critique: string }
type ValidateResult = ValidateOk | ValidateFail

export type RetryConfig<TInput, TOutput> = {
  /** Primary LLM call. */
  primary: (input: TInput) => Promise<TOutput>
  /** Second-chance call with a critique block derived from the first failure. */
  bumped: (input: TInput, critique: string) => Promise<TOutput>
  /** Caller-provided graceful degrade — called when both LLM tries fail validation. */
  fallback: (input: TInput, lastError: unknown) => TOutput | Promise<TOutput>
  /**
   * Synchronous output validator.
   * Returns `{ ok: true }` on success or `{ ok: false, critique }` on failure.
   * Must remain synchronous — do NOT make this async (§6).
   */
  validate: (output: TOutput) => ValidateResult
}

/**
 * Execute an LLM call with one critique retry and a graceful fallback.
 *
 * Flow:
 *   1. Call `config.primary(input)`.
 *   2. If `validate` passes → return output.
 *   3. If `validate` fails → call `config.bumped(input, critique)`.
 *   4. If `validate` passes on bumped output → return output.
 *   5. Otherwise → call `config.fallback(input, lastError)` and return.
 *
 * Never throws. The parent task always receives a value.
 */
export async function withRetry<TInput, TOutput>(
  config: RetryConfig<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  // ── Try 1: primary ──────────────────────────────────────────────────────────
  let primaryOutput: TOutput
  let primaryValidation: ValidateResult

  try {
    primaryOutput = await config.primary(input)
    primaryValidation = config.validate(primaryOutput)
  } catch (primaryError) {
    // Primary threw — skip directly to fallback (no critique to pass to bumped).
    return config.fallback(input, primaryError)
  }

  if (primaryValidation.ok) {
    return primaryOutput
  }

  const critique = primaryValidation.critique

  // ── Try 2: bumped (one critique pass) ───────────────────────────────────────
  let bumpedOutput: TOutput
  let bumpedValidation: ValidateResult

  try {
    bumpedOutput = await config.bumped(input, critique)
    bumpedValidation = config.validate(bumpedOutput)
  } catch (bumpedError) {
    return config.fallback(input, bumpedError)
  }

  if (bumpedValidation.ok) {
    return bumpedOutput
  }

  // ── Fallback ────────────────────────────────────────────────────────────────
  return config.fallback(input, new Error(bumpedValidation.critique))
}
