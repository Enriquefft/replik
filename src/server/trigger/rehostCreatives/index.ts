import { logger, metadata, task, tasks } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { withUser } from "@/db/client"
import { assets, creatives } from "@/db/schema"
import { withApifyTokenIfKv } from "@/lib/apify/auth.ts"
import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import { logEvent } from "@/lib/observability/log.ts"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import { type OriginalUploadInput, uploadOriginalsFromUrl } from "@/lib/video"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs"
import { rehostError } from "./errors.ts"
import type { RehostPhase } from "./metadata.ts"

/**
 * Rehost selected ad creatives from their source CDN (Meta / Apify) to
 * UploadThing, then chain `translateAndBurnSubs` for every creative that
 * has a persisted `original_video` asset. Runs once per `selectCreatives`
 * action — only the user-picked creatives are rehosted, not the entire
 * scrape inventory (see scrapeProduct/index.ts).
 *
 * Idempotent: creatives that already have an `original_video` asset row
 * skip the upload but are still included in the burn batch. Tenant safety:
 * `creativeIds` are validated against the tenant-scoped `creatives` table
 * before any asset lookup or burn trigger — ids that don't resolve to a
 * row owned by `userId` are silently dropped.
 */

const RehostCreativesPayloadSchema = z.object({
  creativeIds: z.array(z.uuid()).min(1),
  userId: z.uuid(),
  /** Tag scope for realtime UI subscription. */
  productId: z.uuid(),
})

type RehostCreativesPayload = z.infer<typeof RehostCreativesPayloadSchema>

interface RehostSummary {
  rehosted: number
  alreadyHosted: number
  failed: number
  burnTriggered: number
  burnSucceeded: number
  burnFailed: number
}

const TASK_ID = "rehostCreatives"

export const rehostCreativesTask = task({
  id: TASK_ID,
  // Rehost waits on translateAndBurnSubs (maxDuration 900s); add headroom for
  // upload + retry overhead so the wait inherits a longer ceiling than the
  // child task itself.
  maxDuration: 1200,
  machine: { preset: "small-1x" },
  run: async (rawPayload: RehostCreativesPayload): Promise<RehostSummary> => {
    const payload = RehostCreativesPayloadSchema.parse(rawPayload)
    const { creativeIds, userId, productId } = payload
    const startedAt = Date.now()
    const burnTag = productTag(toProductId(productId))

    logger.info("rehost.start", { count: creativeIds.length })

    try {
      // Default broadcast — even when every creative is already hosted, the
      // UI sees the first phase momentarily before the task jumps to burning.
      metadata.set("phase", "rehosting" satisfies RehostPhase)

      // Single tenant-scoped round-trip: pair each creative with its
      // `original_video` asset (if any) via LEFT JOIN. `assetOwnerId !== null`
      // is the "already rehosted" signal.
      const rows = await withUser(userId, async (db) => {
        return await db
          .select({
            id: creatives.id,
            scrapeUrl: creatives.scrapeUrl,
            assetOwnerId: assets.ownerId,
          })
          .from(creatives)
          .leftJoin(
            assets,
            and(
              eq(assets.ownerType, "creative"),
              eq(assets.ownerId, creatives.id),
              eq(assets.kind, "original_video"),
            ),
          )
          .where(and(inArray(creatives.id, creativeIds), eq(creatives.userId, userId)))
      })

      if (rows.length === 0) {
        const summary: RehostSummary = {
          rehosted: 0,
          alreadyHosted: 0,
          failed: 0,
          burnTriggered: 0,
          burnSucceeded: 0,
          burnFailed: 0,
        }
        logEvent("task.rehost.summary", {
          userId,
          ...summary,
          ms: Date.now() - startedAt,
          skipped: "no-tenant-rows",
        })
        return summary
      }

      const validIds = rows.map((r) => r.id)
      const alreadyHosted = new Set(rows.filter((r) => r.assetOwnerId !== null).map((r) => r.id))
      const toRehost = rows.filter((r) => !alreadyHosted.has(r.id))

      metadata.set("alreadyHosted", alreadyHosted.size)

      const burnIds = new Set<string>(alreadyHosted)
      let rehosted = 0
      let failed = 0

      if (toRehost.length > 0) {
        const inputs: OriginalUploadInput[] = toRehost.map((r) => ({
          url: withApifyTokenIfKv(r.scrapeUrl),
          customId: r.id,
        }))
        const outcomes = await uploadOriginalsFromUrl(inputs)

        const validIdSet = new Set(validIds)
        const inserts: Array<{
          creativeId: string
          url: string
          bytes: number
          mime: string
        }> = []
        for (const outcome of outcomes) {
          if (!validIdSet.has(outcome.customId)) {
            logger.warn("rehost.unknown_custom_id", { customId: outcome.customId })
            continue
          }
          if (outcome.ok) {
            inserts.push({
              creativeId: outcome.customId,
              url: outcome.url,
              bytes: outcome.bytes,
              mime: outcome.mime,
            })
            burnIds.add(outcome.customId)
          } else {
            failed += 1
            logger.warn("rehost.upload_failed", {
              creativeId: outcome.customId,
              error: outcome.error,
            })
          }
        }

        if (inserts.length > 0) {
          await withUser(userId, async (db) => {
            await db
              .insert(assets)
              .values(
                inserts.map((i) => ({
                  ownerType: "creative" as const,
                  ownerId: i.creativeId,
                  kind: "original_video" as const,
                  url: i.url,
                  bytes: i.bytes,
                  mime: i.mime,
                })),
              )
              .onConflictDoNothing({
                target: [assets.ownerType, assets.ownerId, assets.kind],
              })
          })
        }
        rehosted = inserts.length
        metadata.set("rehosted", rehosted)

        if (rehosted === 0 && failed > 0 && burnIds.size === 0) {
          rehostError(
            "uploadthing_failed",
            `rehost: every upload failed (${failed.toString()}/${toRehost.length.toString()}), no creatives to burn`,
          )
        }
      }

      let burnSucceeded = 0
      let burnFailed = 0
      if (burnIds.size > 0) {
        metadata.set("phase", "burning" satisfies RehostPhase)
        metadata.set("burnTotal", burnIds.size)
        metadata.set("burnDone", 0)
        // Block rehost on burn completion so the publish lane can read complete
        // edited_video state without a race. Pin attempt=1 so re-runs of
        // rehostCreatives for the same creatives replay translateAndBurnSubs's
        // idempotency keys (loadPersistedAssets) instead of re-burning.
        const burnBatch = await tasks.batchTriggerAndWait<typeof translateAndBurnSubsTask>(
          "translateAndBurnSubs",
          [...burnIds].map((creativeId) => ({
            payload: { creativeId, userId, attempt: 1 },
            options: { tags: [burnTag] },
          })),
        )
        for (const run of burnBatch.runs) {
          if (run.ok) {
            burnSucceeded += 1
          } else {
            burnFailed += 1
            logger.warn("burn_run_failed", {
              runId: run.id,
              error: run.error instanceof Error ? run.error.message : String(run.error),
            })
          }
          metadata.increment("burnDone", 1)
        }

        if (burnSucceeded === 0 && burnFailed > 0) {
          rehostError(
            "burn_batch_failed",
            `rehost: every burn failed (${burnFailed.toString()}/${burnIds.size.toString()})`,
          )
        }
      }

      const summary: RehostSummary = {
        rehosted,
        alreadyHosted: alreadyHosted.size,
        failed,
        burnTriggered: burnIds.size,
        burnSucceeded,
        burnFailed,
      }

      logEvent("task.rehost.summary", {
        userId,
        ...summary,
        ms: Date.now() - startedAt,
      })

      return summary
    } catch (err) {
      // Preserve structured TASK_ERROR envelopes; wrap anything else so the
      // translator gets a deterministic code (`generic_fallback` → LLM path).
      if (err instanceof Error && parseTaskErrorPayload(err.message) !== null) {
        throw err
      }
      const reason = err instanceof Error ? err.message : String(err)
      rehostError("generic_fallback", reason)
    }
  },
})
