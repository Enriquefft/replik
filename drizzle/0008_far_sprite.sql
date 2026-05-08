-- Migrate products.brand_tokens and products.keywords from jsonb to text[].
-- DROP+ADD is destructive but safe here: confirmed no production data.
-- A type-preserving migration would need
--   USING ARRAY(SELECT jsonb_array_elements_text("<col>"))
-- on a populated DB.

ALTER TABLE "products" DROP COLUMN "brand_tokens";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_tokens" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "keywords";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "keywords" text[] DEFAULT '{}' NOT NULL;
