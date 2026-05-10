DROP INDEX "creatives_play_count_idx";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "collect_count";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "active_days";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "eu_total_reach";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "author_fans";--> statement-breakpoint
ALTER TABLE "creatives" DROP COLUMN "brand_match_score";