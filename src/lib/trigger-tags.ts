import type { ProductId, UserId } from "@/lib/types/ids.ts"

/**
 * Product-scoped Trigger.dev tag.
 *
 * Invariant: every `products` row belongs to exactly one user (FK
 * `products.user_id`), so any run tagged with `productTag(p)` is
 * transitively owned by that user. This is what lets `listActiveRuns`
 * mint a single public read token over the union of `productTag` values
 * for the user's products without leaking cross-tenant runs.
 */
export function productTag(id: ProductId): string {
  return `product:${id}`
}

/**
 * User-scoped Trigger.dev tag. Used by `JobsDock` to mint a public read
 * token that subscribes to all of the user's runs — covers product-less
 * tasks like `sync_insights` that have no `productTag` to attach to.
 *
 * Defensive scoping: the token returned by `listActiveRuns` includes this
 * tag plus the union of `productTag(productId)` for products the user
 * actually owns. A token never leaks runs belonging to another tenant.
 */
export function userTag(id: UserId): string {
  return `user:${id}`
}
