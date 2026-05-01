import {
  boolean,
  customType,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { z } from "zod"

import type { CopyContent } from "@/lib/ai/schemas.ts"
import type { InterestCategory, SalesAngle } from "@/lib/ai/taxonomies.ts"

type SalesAngleT = z.infer<typeof SalesAngle>
type InterestCategoryT = z.infer<typeof InterestCategory>

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea"
  },
})

export const integrationProviderEnum = pgEnum("integration_provider", ["meta", "shopify"])

export const productStatusEnum = pgEnum("product_status", [
  "SCRAPING",
  "READY",
  "LANDING_PUBLISHED",
  "CAMPAIGN_LAUNCHED",
  "SCRAPE_EMPTY",
  "SCRAPE_PARTIAL",
  "FAILED",
])

export const creativeSourceEnum = pgEnum("creative_source", ["meta_ad_library", "apify_fb"])

export const assetOwnerTypeEnum = pgEnum("asset_owner_type", ["creative", "product"])

export const assetKindEnum = pgEnum("asset_kind", ["original_video", "edited_video", "srt"])

export const campaignStatusEnum = pgEnum("campaign_status", ["DRAFT", "PAUSED", "ACTIVE", "FAILED"])

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "CONTACTED",
  "DELIVERED",
  "CANCELLED",
])

export const ctaTypeEnum = pgEnum("cta_type", ["SHOP_NOW", "ORDER_NOW"])

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  whatsappNumber: text("whatsapp_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    encryptedToken: bytea("encrypted_token").notNull(),
    encryptedExtraJson: bytea("encrypted_extra_json").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integrations_user_provider_key").on(t.userId, t.provider)],
)

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),
  category: text("category").$type<InterestCategoryT | null>(),
  pricingCents: integer("pricing_cents"),
  bundle2PricingCents: integer("bundle_2_pricing_cents"),
  bundle3PricingCents: integer("bundle_3_pricing_cents"),
  status: productStatusEnum("status").notNull().default("SCRAPING"),
  description: text("description"),
  scrapeReason: text("scrape_reason"),
  brandTokens: jsonb("brand_tokens").$type<string[]>().notNull().default([]),
  shopifyProductId: text("shopify_product_id"),
  shopifyPageHandle: text("shopify_page_handle"),
  shopifyTemplateId: integer("shopify_template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const creatives = pgTable("creatives", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: creativeSourceEnum("source").notNull(),
  scrapeUrl: text("scrape_url").notNull(),
  angle: text("angle").$type<SalesAngleT | null>(),
  transcriptText: text("transcript_text"),
  language: text("language"),
  selectedBool: boolean("selected_bool").notNull().default(false),
  translated: boolean("translated"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
})

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerType: assetOwnerTypeEnum("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  kind: assetKindEnum("kind").notNull(),
  url: text("url").notNull(),
  bytes: integer("bytes"),
  mime: text("mime"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  metaCampaignId: text("meta_campaign_id"),
  structure: text("structure").notNull().default("CBO"),
  budgetDailyCents: integer("budget_daily_cents").notNull(),
  status: campaignStatusEnum("status").notNull().default("DRAFT"),
  idempotencyKey: text("idempotency_key"),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
})

export const ads = pgTable("ads", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  creativeId: uuid("creative_id")
    .notNull()
    .references(() => creatives.id, { onDelete: "cascade" }),
  metaAdId: text("meta_ad_id"),
  primaryText: text("primary_text").notNull(),
  headline: text("headline").notNull(),
  description: text("description").notNull(),
  ctaType: ctaTypeEnum("cta_type").notNull(),
  copyJson: jsonb("copy_json").$type<CopyContent>().notNull(),
})

export const metrics = pgTable("metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  adId: uuid("ad_id")
    .notNull()
    .references(() => ads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date", { withTimezone: true }).notNull(),
  spendCents: integer("spend_cents").notNull().default(0),
  results: integer("results").notNull().default(0),
  cpaCents: integer("cpa_cents"),
  impressions: integer("impressions").notNull().default(0),
  ctr: numeric("ctr", { precision: 6, scale: 4 }),
  roas: numeric("roas", { precision: 8, scale: 4 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
})

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  qty: integer("qty").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: orderStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

export type User = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

export type Integration = typeof integrations.$inferSelect
export type IntegrationInsert = typeof integrations.$inferInsert

export type Product = typeof products.$inferSelect
export type ProductInsert = typeof products.$inferInsert

export type Creative = typeof creatives.$inferSelect
export type CreativeInsert = typeof creatives.$inferInsert

export type Asset = typeof assets.$inferSelect
export type AssetInsert = typeof assets.$inferInsert

export type Campaign = typeof campaigns.$inferSelect
export type CampaignInsert = typeof campaigns.$inferInsert

export type Ad = typeof ads.$inferSelect
export type AdInsert = typeof ads.$inferInsert

export type Metric = typeof metrics.$inferSelect
export type MetricInsert = typeof metrics.$inferInsert

export type Order = typeof orders.$inferSelect
export type OrderInsert = typeof orders.$inferInsert

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert
