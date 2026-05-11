CREATE TYPE "public"."task_kind" AS ENUM('scrape_product', 'translate_burn', 'rehost_creatives', 'publish_landing', 'launch_campaign', 'sync_insights');--> statement-breakpoint
CREATE TYPE "public"."task_run_status" AS ENUM('queued', 'executing', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "error_translations" (
	"hash" text PRIMARY KEY NOT NULL,
	"translated" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_run_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"kind" "task_kind" NOT NULL,
	"status" "task_run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"phase_transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	CONSTRAINT "task_runs_trigger_run_id_unique" UNIQUE("trigger_run_id")
);
--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_runs_user_status_idx" ON "task_runs" USING btree ("user_id","status");