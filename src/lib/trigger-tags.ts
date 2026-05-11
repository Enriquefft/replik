import type { ProductId, UserId } from "@/lib/types/ids.ts"

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
