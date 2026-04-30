/**
 * Branded ID types. Single source of truth for entity IDs.
 * Never use bare `string` for entity IDs in action signatures.
 *
 * The `as` casts in the constructors below are the canonical way to materialise
 * a branded type from a validated string — there is no other mechanism in
 * TypeScript to attach a phantom brand. Kept centralised here so the rest of
 * the codebase never needs to write `as` (per project rule: no `as` casts).
 * Prefer constructing branded IDs at parse boundaries (Zod transforms or
 * server-side after a DB returning() row), not by calling `toX()` ad-hoc.
 */

declare const __brand: unique symbol
type Brand<T, B> = T & { readonly [__brand]: B }

export type UserId = Brand<string, "UserId">
export type ProductId = Brand<string, "ProductId">
export type CreativeId = Brand<string, "CreativeId">
export type CampaignId = Brand<string, "CampaignId">
export type AssetId = Brand<string, "AssetId">

export function toProductId(id: string): ProductId {
  return id as ProductId
}

export function toCreativeId(id: string): CreativeId {
  return id as CreativeId
}

export function toUserId(id: string): UserId {
  return id as UserId
}
