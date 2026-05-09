ALTER TABLE "creatives" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
UPDATE "creatives" SET "source" = 'apify_fb' WHERE "source" = 'meta_ad_library';--> statement-breakpoint
DROP TYPE "public"."creative_source";--> statement-breakpoint
CREATE TYPE "public"."creative_source" AS ENUM('apify_fb');--> statement-breakpoint
ALTER TABLE "creatives" ALTER COLUMN "source" SET DATA TYPE "public"."creative_source" USING "source"::"public"."creative_source";--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "advertiser_name" text;