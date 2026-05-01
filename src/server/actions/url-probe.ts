"use server"

import { z } from "zod"
import { requireUser } from "@/db/client"
import { logEvent, withTiming } from "@/lib/observability/log.ts"
import { scrapeReasonCopy } from "@/lib/scrape-reason.ts"
import { probeUrl } from "@/lib/url-probe.ts"
import type { ActionResult } from "./types.ts"

/**
 * Validate that a URL is reachable HTML before we create a product row. Used
 * both by `/new` (initial submit) and by the inline retry-with-edit flow.
 *
 * On success returns the followed-redirects URL so callers can persist the
 * canonical form. On failure returns Spanish copy from `scrapeReasonCopy`
 * so the form can render it inline via `<FormMessage>`.
 */
export async function validateUrl(rawUrl: unknown): Promise<ActionResult<{ finalUrl: string }>> {
  await requireUser()

  const parsed = z.url("URL inválida").safeParse(rawUrl)
  if (!parsed.success) {
    const copy = scrapeReasonCopy("invalid-url", typeof rawUrl === "string" ? rawUrl : "")
    return { ok: false, error: copy.detail }
  }

  return withTiming(
    "action.url.probe",
    async () => {
      const result = await probeUrl(parsed.data)
      if (!result.ok) {
        const copy = scrapeReasonCopy(result.reason, parsed.data)
        logEvent("action.url.probe.rejected", {
          url: parsed.data,
          reason: result.reason,
          status: result.status,
        })
        return { ok: false, error: copy.detail }
      }
      return { ok: true, data: { finalUrl: result.finalUrl } }
    },
    { url: parsed.data },
  )
}
