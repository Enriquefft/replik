import "server-only";

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Token-expiry side effect. When a Meta call fails with error code 190
 * ("token expired/invalid"), `metaFetch` calls `markIntegrationExpired` so
 * the dashboard reconnect-banner (read off `integrations.expires_at`) lights
 * up immediately — no need to wait for the next manual validation.
 *
 * `withUser` is the only legal way to obtain a tenant DB handle, so this
 * helper consumes the user id directly (typically `MetaCreds.userId`).
 */

import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import { integrations } from "@/db/schema";

export async function markIntegrationExpired(
  userId: string,
  provider: "meta" | "shopify",
): Promise<void> {
  await withUser(userId, async (db) => {
    await db
      .update(integrations)
      .set({ expiresAt: sql`now()` })
      .where(
        and(
          eq(integrations.userId, userId),
          eq(integrations.provider, provider),
        ),
      );
  });
}
