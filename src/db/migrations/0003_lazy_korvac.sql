CREATE TYPE "public"."bot_post_shape" AS ENUM('morning_brief', 'market_move', 'new_poll', 'hot_news');--> statement-breakpoint
CREATE TYPE "public"."bot_post_status" AS ENUM('draft', 'scheduled', 'published', 'killed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"shape" "bot_post_shape" NOT NULL,
	"status" "bot_post_status" DEFAULT 'draft' NOT NULL,
	"caption" text NOT NULL,
	"card_path" text NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"llm_metadata" jsonb NOT NULL,
	"event_id" integer,
	"candidate_focus" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"x_post_id" text,
	"metrics" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bot_posts" ADD CONSTRAINT "bot_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_posts_status_idx" ON "bot_posts" USING btree ("status","generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_posts_candidate_idx" ON "bot_posts" USING btree ("candidate_focus","generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_posts_event_idx" ON "bot_posts" USING btree ("event_id");