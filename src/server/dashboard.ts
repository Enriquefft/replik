import "server-only";

import { and, count, eq, gte, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import {
  ads,
  campaigns,
  metrics,
  orders,
  products,
  type Product,
} from "@/db/schema";

export interface DashboardProductMetrics {
  spend_cents: number;
  results: number;
  cpa_cents: number | null;
  roas: number | null;
}

export interface DashboardProduct {
  id: string;
  name: string | null;
  status: Product["status"];
  shopify_page_handle: string | null;
  metrics: DashboardProductMetrics;
  orders_count: number;
  created_at: Date;
}

export interface DashboardData {
  products: DashboardProduct[];
}

/**
 * Loads the dashboard payload for `userId` in a single round-trip of three
 * parallel queries (products + last-7d metric aggregates joined through ads
 * and campaigns + per-product order counts). Aggregates are computed in SQL,
 * results merged in JS so unmatched products surface with zeroed metrics.
 */
export async function getDashboardData(
  userId: string,
): Promise<DashboardData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return await withUser(userId, async (db) => {
    const [productRows, metricRows, orderRows] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          status: products.status,
          shopify_page_handle: products.shopifyPageHandle,
          created_at: products.createdAt,
        })
        .from(products)
        .where(eq(products.userId, userId)),

      db
        .select({
          product_id: campaigns.productId,
          spend_cents:
            sql<number>`COALESCE(SUM(${metrics.spendCents}), 0)`.mapWith(
              Number,
            ),
          results:
            sql<number>`COALESCE(SUM(${metrics.results}), 0)`.mapWith(Number),
          cpa_cents: sql<number | null>`
            CASE
              WHEN COALESCE(SUM(${metrics.results}), 0) = 0 THEN NULL
              ELSE (SUM(${metrics.spendCents})::float / SUM(${metrics.results}))::int
            END
          `.mapWith((v: unknown) => (v == null ? null : Number(v))),
          roas: sql<number | null>`AVG(${metrics.roas})`.mapWith(
            (v: unknown) => (v == null ? null : Number(v)),
          ),
        })
        .from(metrics)
        .innerJoin(ads, eq(ads.id, metrics.adId))
        .innerJoin(campaigns, eq(campaigns.id, ads.campaignId))
        .where(
          and(eq(metrics.userId, userId), gte(metrics.date, sevenDaysAgo)),
        )
        .groupBy(campaigns.productId),

      db
        .select({
          product_id: orders.productId,
          orders_count: count(orders.id).mapWith(Number),
        })
        .from(orders)
        .where(eq(orders.userId, userId))
        .groupBy(orders.productId),
    ]);

    const metricsByProduct = new Map(
      metricRows.map((m) => [m.product_id, m]),
    );
    const ordersByProduct = new Map(
      orderRows.map((o) => [o.product_id, o.orders_count]),
    );

    const productsOut: DashboardProduct[] = productRows.map((p) => {
      const m = metricsByProduct.get(p.id);
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        shopify_page_handle: p.shopify_page_handle,
        metrics: {
          spend_cents: m?.spend_cents ?? 0,
          results: m?.results ?? 0,
          cpa_cents: m?.cpa_cents ?? null,
          roas: m?.roas ?? null,
        },
        orders_count: ordersByProduct.get(p.id) ?? 0,
        created_at: p.created_at,
      };
    });

    return { products: productsOut };
  });
}
