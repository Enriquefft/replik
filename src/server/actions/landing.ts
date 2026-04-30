"use server";

import { and, eq } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk";
import { requireUser, withUser } from "@/db/client";
import { products } from "@/db/schema";
import {
  IntegrationMissingError,
  requireIntegration,
} from "@/server/integrations";
import type { publishLandingTask } from "@/server/trigger/publishLanding";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; needs: "meta" | "shopify"; error?: string };

/**
 * JIT credential gate + run trigger for the publishLanding pipeline.
 * Returns `{ ok:false, needs:'shopify' }` when the user has no Shopify
 * integration so the client can mount `<CredentialsModal provider="shopify"/>`.
 */
export async function publishLanding(
  productId: string,
): Promise<ActionResult<{ runId: string }>> {
  if (typeof productId !== "string" || productId.length === 0) {
    return { ok: false, needs: "shopify", error: "productId requerido." };
  }
  const { userId } = await requireUser();

  // Verify product belongs to user before doing anything else.
  const owned = await withUser(userId, async (db) => {
    const rows = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);
    return rows[0];
  });
  if (!owned) {
    return { ok: false, needs: "shopify", error: "Producto no encontrado." };
  }

  // Gate on Shopify integration. We do not need Meta to publish a landing —
  // pixel_id is injected when present, otherwise empty string at render time.
  try {
    await requireIntegration(userId, "shopify");
  } catch (err) {
    if (err instanceof IntegrationMissingError) {
      return { ok: false, needs: "shopify" };
    }
    throw err;
  }

  const handle = await tasks.trigger<typeof publishLandingTask>(
    "publishLanding",
    { productId, userId },
  );

  return { ok: true, data: { runId: handle.id } };
}
