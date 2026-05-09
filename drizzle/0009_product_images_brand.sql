-- Phase 1 — multi-image support + LLM-emitted brand string.
--
-- Drops `image_url` (singular, text) and replaces it with `image_urls`
-- (text[] not null default '{}'). Backfill preserves any existing single
-- URL by wrapping it into a one-element array. Adds `brand` (nullable
-- text) so the LLM can emit the source-store brand for downstream
-- exclusion (srt-translate, hero-title generation).
--
-- `brand_tokens` (legacy column read by srt-translate) stays in place;
-- the new pipeline writes it from `brand` via a deterministic split,
-- so the API contract for srt-translate is unchanged.

ALTER TABLE "products" ADD COLUMN "image_urls" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "products" SET "image_urls" = ARRAY["image_url"] WHERE "image_url" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "image_url";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand" text;
