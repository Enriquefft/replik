ALTER TABLE "creatives" ADD COLUMN "play_count" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "like_count" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "share_count" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "comment_count" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "collect_count" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "is_active" boolean;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "active_days" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "eu_total_reach" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "hashtags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "author_handle" text;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "author_fans" integer;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "author_verified" boolean;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "brand_match_score" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "engagement_json" jsonb;--> statement-breakpoint
CREATE INDEX "creatives_play_count_idx" ON "creatives" USING btree ("product_id","play_count" DESC NULLS LAST);