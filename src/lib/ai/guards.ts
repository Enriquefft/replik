import { type CopyContent, CopyContentSchema } from "@/lib/ai/copy-schema.ts"

// ─── AI-speak ban list (§5) ───────────────────────────────────────────────────

/** Imperative verbs that signal AI-generated marketing voice — start-of-string only (§5). */
const AI_SPEAK_VERBS = /^(descubre|transforma|revoluciona|imagina)/i

/** Em-dash character — prohibited in all output copy. */
const AI_SPEAK_EM_DASH = /—/

/** ALL-CAPS word of 3 or more letters (allow short brand tokens like "TV"). */
const AI_SPEAK_ALL_CAPS = /\b[A-Z]{3,}\b/

/** Two or more consecutive exclamation marks. */
const AI_SPEAK_EXCLAMATION_CHAIN = /!{2,}/

// ─── Meta policy ban list (§5) ────────────────────────────────────────────────

/** Medical/miracle claims prohibited by Meta ad policies. */
const META_POLICY_MEDICAL = /(cura|elimina|milagroso|garantizado|adelgaza|previene)/i

/** Personal-attribute questions that imply targeting by characteristic. */
const META_POLICY_PERSONAL_ATTR = /¿(sufres|tienes|eres|estás)\b/i

/** Before/after framing or weight-loss quantity claims. */
const META_POLICY_BEFORE_AFTER = /(antes\s+y\s+después|baja\s+\d+\s*kg)/i

// ─── Imperative-verb screen (§5 Stage D) ─────────────────────────────────────

/**
 * Imperative verbs that signal AI-generated marketing copy when they appear at
 * the start of a product name or description (§5). Trim leading whitespace
 * before matching.
 */
const IMPERATIVE_VERB = /^(compra|descubre|prueba|consigue|ordena|haz|llama|visita|aprovecha)/i

// ─── Guard result type ────────────────────────────────────────────────────────

type GuardOk = { ok: true }
type GuardFail = { ok: false; reason: string }
type GuardResult = GuardOk | GuardFail

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Screen copy text against the AI-speak ban list (§5).
 *
 * Returns `{ ok: false, reason }` naming the first violated rule, or
 * `{ ok: true }` when the text passes all checks.
 * Pure function — no I/O.
 */
export function aiSpeak(text: string): GuardResult {
  if (AI_SPEAK_VERBS.test(text)) {
    return { ok: false, reason: "AI_SPEAK_VERBS" }
  }
  if (AI_SPEAK_EM_DASH.test(text)) {
    return { ok: false, reason: "AI_SPEAK_EM_DASH" }
  }
  if (AI_SPEAK_ALL_CAPS.test(text)) {
    return { ok: false, reason: "AI_SPEAK_ALL_CAPS" }
  }
  if (AI_SPEAK_EXCLAMATION_CHAIN.test(text)) {
    return { ok: false, reason: "AI_SPEAK_EXCLAMATION_CHAIN" }
  }
  return { ok: true }
}

/**
 * Screen copy text against Meta ad policy rules (§5).
 *
 * Returns `{ ok: false, reason }` naming the first violated rule, or
 * `{ ok: true }` when the text passes all checks.
 * Pure function — no I/O.
 */
export function metaPolicy(text: string): GuardResult {
  if (META_POLICY_MEDICAL.test(text)) {
    return { ok: false, reason: "META_POLICY_MEDICAL" }
  }
  if (META_POLICY_PERSONAL_ATTR.test(text)) {
    return { ok: false, reason: "META_POLICY_PERSONAL_ATTR" }
  }
  if (META_POLICY_BEFORE_AFTER.test(text)) {
    return { ok: false, reason: "META_POLICY_BEFORE_AFTER" }
  }
  return { ok: true }
}

/**
 * Wrap untrusted content (fetched HTML, transcripts) before passing to any LLM.
 * Protocol: `<UNTRUSTED>…</UNTRUSTED>`.
 * No escaping applied inside the tags — the wrapping is the entire protocol.
 */
export function wrapUntrusted(text: string): string {
  return `<UNTRUSTED>${text}</UNTRUSTED>`
}

/**
 * Validate copy field lengths against the Zod schema (§4).
 *
 * Uses `CopyContentSchema.safeParse` so the limits are SSOT — never
 * hand-coded inside this function.
 * Pure function — no I/O.
 */
export function lengthCheck(content: CopyContent): GuardResult {
  const result = CopyContentSchema.safeParse(content)
  if (result.success) {
    return { ok: true }
  }
  const firstIssue = result.error.issues[0]
  const reason = firstIssue
    ? `LENGTH_VIOLATION: ${firstIssue.path.join(".")} — ${firstIssue.message}`
    : "LENGTH_VIOLATION: unknown field"
  return { ok: false, reason }
}

/**
 * Screen a Stage D persist candidate (productName / description) for
 * imperative-verb AI-speak (§5).
 *
 * Trims leading whitespace before matching. Mid-sentence imperatives do NOT
 * trigger — start-of-string only. On hit, the caller should DROP the field
 * and continue (not fail the scrape).
 * Pure function — no I/O.
 */
export function imperativeVerbCheck(text: string): GuardResult {
  if (IMPERATIVE_VERB.test(text.trimStart())) {
    return { ok: false, reason: "IMPERATIVE_VERB" }
  }
  return { ok: true }
}
