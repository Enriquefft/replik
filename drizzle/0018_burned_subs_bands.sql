ALTER TABLE "creatives" DROP COLUMN "burned_subs_region";--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "burned_subs_bands" jsonb;
