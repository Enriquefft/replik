"use server"

import { auth, tasks } from "@trigger.dev/sdk"
import { requireUser } from "@/db/client"
import { IntegrationMissingError, requireIntegration } from "@/server/integrations"
import type { syncInsights } from "@/server/trigger/syncInsights"

export type RefreshInsightsResult =
  | { ok: true; data: { runId: string; accessToken: string } }
  | { ok: false; needs: "meta"; error?: string }

/**
 * Server Action invoked by the dashboard "Refresh" button. Validates that the
 * caller has a Meta integration, then triggers the `sync-insights` task with
 * the current user's ID. Returns a discriminated result so the UI can render
 * an integration-needed CTA when the prerequisite is missing.
 */
export async function refreshInsights(): Promise<RefreshInsightsResult> {
  const { userId } = await requireUser()

  try {
    await requireIntegration(userId, "meta")
  } catch (err) {
    if (err instanceof IntegrationMissingError) {
      return { ok: false, needs: "meta" }
    }
    throw err
  }

  try {
    const handle = await tasks.trigger<typeof syncInsights>("sync-insights", {
      userId,
    })
    const accessToken = await auth.createPublicToken({
      scopes: { read: { runs: [handle.id] } },
      expirationTime: "1h",
    })
    return { ok: true, data: { runId: handle.id, accessToken } }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger sync"
    return { ok: false, needs: "meta", error: message }
  }
}
