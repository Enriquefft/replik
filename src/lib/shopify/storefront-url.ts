/**
 * Builds the public storefront URL for a Shopify Page created by Replik.
 *
 * The publish pipeline (`src/server/trigger/publishLanding/index.ts`) creates
 * BOTH a Shopify Product and a Shopify Page; the landing is the Page, so the
 * canonical URL is `https://<host>/pages/<handle>` — never `/products/<handle>`.
 *
 * `host` is either the merchant's `primary_domain.host` (custom domain) or
 * the `*.myshopify.com` shop domain when no custom domain is set. Validation
 * is strict to keep an invalid URL from ever reaching the UI.
 *
 * Pure / non-`server-only` so it can be used from the Trigger.dev task, the
 * dashboard server action, and any client component.
 */

import type { StorefrontUrl } from "@/lib/types/ids.ts"

const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?<!-)$/
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export class InvalidStorefrontUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidStorefrontUrlError"
  }
}

/**
 * True when `host` would be accepted by `buildStorefrontUrl`. Exported so the
 * OAuth callback can pre-validate `shop.primary_domain.host` before persisting
 * it into `extra` — keeps the publish task's `buildStorefrontUrl` call from
 * ever throwing on a server-controlled value and marking an already-live
 * Shopify Page as a failed publish.
 */
export function isValidStorefrontHost(host: string): boolean {
  return HOST_RE.test(host)
}

export function buildStorefrontUrl(host: string, pageHandle: string): StorefrontUrl {
  if (!HOST_RE.test(host)) {
    throw new InvalidStorefrontUrlError(`Invalid storefront host: ${JSON.stringify(host)}`)
  }
  if (!HANDLE_RE.test(pageHandle)) {
    throw new InvalidStorefrontUrlError(`Invalid page handle: ${JSON.stringify(pageHandle)}`)
  }
  return `https://${host}/pages/${pageHandle}` as StorefrontUrl
}
