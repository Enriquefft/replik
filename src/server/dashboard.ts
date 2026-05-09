import "server-only"

import { and, count, eq, gte, sql } from "drizzle-orm"
import { withUser } from "@/db/client"
import { ads, campaigns, metrics, orders, type Product, products } from "@/db/schema"

export interface DashboardProductMetrics {
  spendCents: number
  results: number
  cpaCents: number | null
  roas: number | null
}

export interface DashboardProduct {
  id: string
  name: string | null
  imageUrls: string[]
  status: Product["status"]
  shopifyPageHandle: string | null
  metrics: DashboardProductMetrics
  ordersCount: number
  createdAt: Date
}

export interface DashboardData {
  products: DashboardProduct[]
}

/**
 * Loads the dashboard payload for `userId` in a single round-trip of three
 * parallel queries (products + last-7d metric aggregates joined through ads
 * and campaigns + per-product order counts). Aggregates are computed in SQL,
 * results merged in JS so unmatched products surface with zeroed metrics.
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  return await withUser(userId, async (db) => {
    const [productRows, metricRows, orderRows] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          imageUrls: products.imageUrls,
          status: products.status,
          shopifyPageHandle: products.shopifyPageHandle,
          createdAt: products.createdAt,
        })
        .from(products)
        .where(eq(products.userId, userId)),

      db
        .select({
          productId: campaigns.productId,
          spendCents: sql<number>`COALESCE(SUM(${metrics.spendCents}), 0)`.mapWith(Number),
          results: sql<number>`COALESCE(SUM(${metrics.results}), 0)`.mapWith(Number),
          cpaCents: sql<number | null>`
            CASE
              WHEN COALESCE(SUM(${metrics.results}), 0) = 0 THEN NULL
              ELSE (SUM(${metrics.spendCents})::float / SUM(${metrics.results}))::int
            END
          `.mapWith((v: unknown) => (v == null ? null : Number(v))),
          roas: sql<number | null>`AVG(${metrics.roas})`.mapWith((v: unknown) =>
            v == null ? null : Number(v),
          ),
        })
        .from(metrics)
        .innerJoin(ads, eq(ads.id, metrics.adId))
        .innerJoin(campaigns, eq(campaigns.id, ads.campaignId))
        .where(and(eq(metrics.userId, userId), gte(metrics.date, sevenDaysAgo)))
        .groupBy(campaigns.productId),

      db
        .select({
          productId: orders.productId,
          ordersCount: count(orders.id).mapWith(Number),
        })
        .from(orders)
        .where(eq(orders.userId, userId))
        .groupBy(orders.productId),
    ])

    const metricsByProduct = new Map(metricRows.map((m) => [m.productId, m]))
    const ordersByProduct = new Map(orderRows.map((o) => [o.productId, o.ordersCount]))

    const productsOut: DashboardProduct[] = productRows.map((p) => {
      const m = metricsByProduct.get(p.id)
      return {
        id: p.id,
        name: p.name,
        imageUrls: p.imageUrls,
        status: p.status,
        shopifyPageHandle: p.shopifyPageHandle,
        metrics: {
          spendCents: m?.spendCents ?? 0,
          results: m?.results ?? 0,
          cpaCents: m?.cpaCents ?? null,
          roas: m?.roas ?? null,
        },
        ordersCount: ordersByProduct.get(p.id) ?? 0,
        createdAt: p.createdAt,
      }
    })

    return { products: productsOut }
  })
}
