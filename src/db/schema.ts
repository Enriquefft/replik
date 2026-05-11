import { sql } from "drizzle-orm"
import {
  bigint,
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

import type { CopyContent } from "@/lib/ai/copy-schema.ts"
import type { BurnedSubsBand, InterestCategory, SalesAngle } from "@/lib/ai/taxonomies.ts"
import type { EngagementSignals } from "@/lib/apify/engagement.ts"
import type { TranslatedError } from "@/lib/errors/translate.ts"

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

export const creativeSourceEnum = pgEnum("creative_source", ["apify_fb", "apify_tiktok"])

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
  imageUrls: text("image_urls").array().notNull().default([]),
  brand: text("brand"),
  canonicalBrand: text("canonical_brand"),
  category: text("category").$type<InterestCategoryT | null>(),
  pricingCents: integer("pricing_cents"),
  bundle2PricingCents: integer("bundle_2_pricing_cents"),
  bundle3PricingCents: integer("bundle_3_pricing_cents"),
  status: productStatusEnum("status").notNull().default("SCRAPING"),
  description: text("description"),
  scrapeReason: text("scrape_reason"),
  brandTokens: text("brand_tokens").array().notNull().default([]),
  keywords: text("keywords").array().notNull().default([]),
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
  advertiserName: text("advertiser_name"),
  angle: text("angle").$type<SalesAngleT | null>(),
  transcriptText: text("transcript_text"),
  language: text("language"),
  selectedBool: boolean("selected_bool").notNull().default(false),
  translated: boolean("translated"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
  // Engagement signals — projected from RawCreative.engagement at the
  // scrape insert site. Counts are `bigint` because viral TikToks
  // exceed int32 (2.1B); `mode: "number"` is safe since
  // Number.MAX_SAFE_INTEGER (9e15) dwarfs any conceivable view count.
  // `engagementJson` mirrors the raw block as a future-proof debugging
  // copy (cheap jsonb storage, used for ad-hoc DB inspection).
  playCount: bigint("play_count", { mode: "number" }),
  likeCount: bigint("like_count", { mode: "number" }),
  shareCount: bigint("share_count", { mode: "number" }),
  commentCount: bigint("comment_count", { mode: "number" }),
  postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }),
  hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
  authorHandle: text("author_handle"),
  authorVerified: boolean("author_verified"),
  /** Deterministic brand match — true when the advertiser page_name
   *  contained any normalized brand key at the relevance gate
   *  (`scrape-brand-match.matchBrandKey`). Used by the composite ranker
   *  as a hard boost: own-brand ads sort to the top of their tier. */
  brandMatched: boolean("brand_matched").notNull().default(false),
  engagementJson: jsonb("engagement_json").$type<EngagementSignals>(),
  /** Detection result from `detectBurnedSubs` — null when not yet probed,
   *  empty array when probed and clean. Each element is a normalised band
   *  `{ topFraction, heightFraction, confidence }` describing a stretch of
   *  the source frame that holds burned-in captions to mask before our own
   *  overlay is drawn. Persisted so retries skip the vision call and the
   *  publish-time burn is deterministic across attempts. */
  burnedSubsBands: jsonb("burned_subs_bands").$type<BurnedSubsBand[]>(),
})

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: assetOwnerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    kind: assetKindEnum("kind").notNull(),
    url: text("url").notNull(),
    bytes: integer("bytes"),
    mime: text("mime"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assets_owner_kind_uniq").on(t.ownerType, t.ownerId, t.kind)],
)

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

/**
 * 24h-TTL cache of LLM-translated error messages, keyed by SHA256 of the
 * raw error string. Reads filter out rows older than the TTL — we keep
 * the row physically (cheap) to amortize one-off blips, but never serve
 * stale copy. See `src/lib/errors/translate.ts`.
 */
export const errorTranslations = pgTable("error_translations", {
  hash: text("hash").primaryKey(),
  translated: jsonb("translated").$type<TranslatedError>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type ErrorTranslation = typeof errorTranslations.$inferSelect
export type ErrorTranslationInsert = typeof errorTranslations.$inferInsert

/**
 * 1h-TTL cache of LLM-narrated progress strings, keyed by SHA256 of
 * `(taskKind + phase + serializedMetadata)`. The narration is contextual
 * UX prose ("Vamos por el creativo 3 de 7…") layered on top of the
 * deterministic phase label. Reads filter rows by `createdAt` against
 * a 1h cutoff so we never serve stale copy. See
 * `src/server/actions/narrate-progress.ts`.
 */
export const narrationCache = pgTable("narration_cache", {
  hash: text("hash").primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type NarrationCache = typeof narrationCache.$inferSelect
export type NarrationCacheInsert = typeof narrationCache.$inferInsert
