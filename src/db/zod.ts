import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { z } from "zod"
import {
  ads,
  assets,
  campaigns,
  creatives,
  idempotencyKeys,
  integrations,
  metrics,
  orders,
  products,
  users,
} from "./schema"

export const User = createSelectSchema(users)
export type User = z.infer<typeof User>
export const UserInsert = createInsertSchema(users)
export type UserInsert = z.infer<typeof UserInsert>

export const Integration = createSelectSchema(integrations)
export type Integration = z.infer<typeof Integration>
export const IntegrationInsert = createInsertSchema(integrations)
export type IntegrationInsert = z.infer<typeof IntegrationInsert>

export const Product = createSelectSchema(products)
export type Product = z.infer<typeof Product>
export const ProductInsert = createInsertSchema(products)
export type ProductInsert = z.infer<typeof ProductInsert>

export const Creative = createSelectSchema(creatives)
export type Creative = z.infer<typeof Creative>
export const CreativeInsert = createInsertSchema(creatives)
export type CreativeInsert = z.infer<typeof CreativeInsert>

export const Asset = createSelectSchema(assets)
export type Asset = z.infer<typeof Asset>
export const AssetInsert = createInsertSchema(assets)
export type AssetInsert = z.infer<typeof AssetInsert>

export const Campaign = createSelectSchema(campaigns)
export type Campaign = z.infer<typeof Campaign>
export const CampaignInsert = createInsertSchema(campaigns)
export type CampaignInsert = z.infer<typeof CampaignInsert>

export const Ad = createSelectSchema(ads)
export type Ad = z.infer<typeof Ad>
export const AdInsert = createInsertSchema(ads)
export type AdInsert = z.infer<typeof AdInsert>

export const Metric = createSelectSchema(metrics)
export type Metric = z.infer<typeof Metric>
export const MetricInsert = createInsertSchema(metrics)
export type MetricInsert = z.infer<typeof MetricInsert>

export const Order = createSelectSchema(orders)
export type Order = z.infer<typeof Order>
export const OrderInsert = createInsertSchema(orders)
export type OrderInsert = z.infer<typeof OrderInsert>

export const IdempotencyKey = createSelectSchema(idempotencyKeys)
export type IdempotencyKey = z.infer<typeof IdempotencyKey>
export const IdempotencyKeyInsert = createInsertSchema(idempotencyKeys)
export type IdempotencyKeyInsert = z.infer<typeof IdempotencyKeyInsert>

export const EncryptedExtraJson = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("shopify"), shop_domain: z.string() }),
  z.object({
    provider: z.literal("meta"),
    ad_account_id: z.string(),
    page_id: z.string(),
    pixel_id: z.string(),
  }),
])
export type EncryptedExtraJson = z.infer<typeof EncryptedExtraJson>
