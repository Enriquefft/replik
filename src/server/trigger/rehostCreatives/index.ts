import { logger, task, tasks } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { withUser } from "@/db/client"
import { assets, creatives } from "@/db/schema"
import { logEvent } from "@/lib/observability/log.ts"
import { uploadOriginalsFromUrl } from "@/lib/video"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs"

/**
 * Rehost selected ad creatives from their source CDN (Meta / Apify) to
 * UploadThing, then chain `translateAndBurnSubs` for every creative that
 * has a persisted `original_video` asset. Runs once per `selectCreatives`
 * action — only the user-picked creatives are rehosted, not the entire
 * scrape inventory (see scrapeProduct/index.ts).
 *
 * Idempotent: creatives that already have an `original_video` asset row
 * skip the upload but are still included in the burn batch.
 */

const RehostCreativesPayloadSchema = z.object({
  creativeIds: z.array(z.uuid()).min(1),
  userId: z.uuid(),
})

type RehostCreativesPayload = z.infer<typeof RehostCreativesPayloadSchema>

interface RehostSummary {
  rehosted: number
  alreadyHosted: number
  failed: number
  burnTriggered: number
}

const TASK_ID = "rehostCreatives"

export const rehostCreativesTask = task({
  id: TASK_ID,
  maxDuration: 300,
  machine: { preset: "small-1x" },
  run: async (rawPayload: RehostCreativesPayload): Promise<RehostSummary> => {
    const payload = RehostCreativesPayloadSchema.parse(rawPayload)
    const { creativeIds, userId } = payload
    const startedAt = Date.now()

    logger.info("rehost.start", { count: creativeIds.length })

    const rows = await withUser(userId, async (db) => {
      return await db
        .select({
          id: creatives.id,
          scrapeUrl: creatives.scrapeUrl,
        })
        .from(creatives)
        .where(and(inArray(creatives.id, creativeIds), eq(creatives.userId, userId)))
    })

    const existing = await withUser(userId, async (db) => {
      return await db
        .select({ ownerId: assets.ownerId })
        .from(assets)
        .where(
          and(
            eq(assets.ownerType, "creative"),
            eq(assets.kind, "original_video"),
            inArray(assets.ownerId, creativeIds),
          ),
        )
    })
    const alreadyHosted = new Set(existing.map((a) => a.ownerId))
    const toRehost = rows.filter((r) => !alreadyHosted.has(r.id))

    let rehosted = 0
    let failed = 0
    const burnIds: string[] = [...alreadyHosted]

    if (toRehost.length > 0) {
      const urls = toRehost.map((r) => r.scrapeUrl)
      const outcomes = await uploadOriginalsFromUrl(urls)

      const inserts: Array<{
        creativeId: string
        url: string
        bytes: number
        mime: string
      }> = []
      for (let i = 0; i < toRehost.length; i++) {
        const creative = toRehost[i]
        const outcome = outcomes[i]
        if (!creative || !outcome) continue
        if (outcome.ok) {
          inserts.push({
            creativeId: creative.id,
            url: outcome.url,
            bytes: outcome.bytes,
            mime: outcome.mime,
          })
          burnIds.push(creative.id)
        } else {
          failed += 1
          logger.warn("rehost.upload_failed", {
            creativeId: creative.id,
            scrapeUrl: creative.scrapeUrl,
            error: outcome.error,
          })
        }
      }

      if (inserts.length > 0) {
        await withUser(userId, async (db) => {
          await db.insert(assets).values(
            inserts.map((i) => ({
              ownerType: "creative" as const,
              ownerId: i.creativeId,
              kind: "original_video" as const,
              url: i.url,
              bytes: i.bytes,
              mime: i.mime,
            })),
          )
        })
      }
      rehosted = inserts.length
    }

    if (burnIds.length > 0) {
      await tasks.batchTrigger<typeof translateAndBurnSubsTask>(
        "translateAndBurnSubs",
        burnIds.map((creativeId) => ({ payload: { creativeId, userId } })),
      )
    }

    const summary: RehostSummary = {
      rehosted,
      alreadyHosted: alreadyHosted.size,
      failed,
      burnTriggered: burnIds.length,
    }

    logEvent("task.rehost.summary", {
      userId,
      ...summary,
      ms: Date.now() - startedAt,
    })

    return summary
  },
})
