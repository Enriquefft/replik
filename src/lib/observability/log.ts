import "server-only"
import { logger } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"
import { withUser } from "@/db/client.ts"
import { products } from "@/db/schema.ts"

type Fields = Record<string, unknown>

function emit(level: "info" | "error", event: string, fields?: Fields): void {
  const payload = { event, level, ts: new Date().toISOString(), ...(fields ?? {}) }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  logger[level](event, fields)
}

export function logEvent(event: string, fields?: Fields): void {
  emit("info", event, fields)
}

export function logError(event: string, fields?: Fields): void {
  emit("error", event, fields)
}

export async function withTiming<T>(
  event: string,
  fn: () => Promise<T>,
  fields?: Fields,
): Promise<T> {
  const start = Date.now()
  emit("info", `${event}.start`, fields)
  try {
    const result = await fn()
    emit("info", `${event}.done`, { ...(fields ?? {}), ms: Date.now() - start })
    return result
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    emit("error", `${event}.error`, {
      ...(fields ?? {}),
      ms: Date.now() - start,
      reason,
    })
    throw err
  }
}

export async function markProductFailed(
  userId: string,
  productId: string,
  reason: string,
  scrapeReason: string,
): Promise<void> {
  await withUser(userId, async (db) => {
    await db
      .update(products)
      .set({ status: "FAILED", scrapeReason })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
  })
  logError("product.marked_failed", { userId, productId, reason, scrapeReason })
}
