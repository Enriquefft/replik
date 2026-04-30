/**
 * Canonical ActionResult type. Single source of truth — import from here,
 * never re-declare in individual action files.
 *
 * On the failure branch:
 *   - `needs` (when set) signals which credential the user is missing, so
 *     the client can mount `<CredentialsModal provider={needs} />` JIT.
 *   - `error` carries a user-facing message for non-credential failures
 *     (validation, ownership, downstream service errors). Both may be set
 *     together when a credential is missing AND a specific reason applies.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; needs?: "meta" | "shopify"; error?: string }
