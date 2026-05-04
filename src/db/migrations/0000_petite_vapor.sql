CREATE TYPE "public"."news_category" AS ENUM('campania', 'gobierno', 'economia', 'escandalo', 'debate', 'otro');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"candidate" text NOT NULL,
	"price" numeric(6, 4) NOT NULL,
	"volume_24h" numeric(14, 2),
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"question" text NOT NULL,
	"candidates" jsonb NOT NULL,
	"end_date" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"headline" text NOT NULL,
	"body_excerpt" text,
	"published_at" timestamp with time zone NOT NULL,
	"candidates_mentioned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" "news_category",
	"relevance_score" numeric(3, 2),
	"tagged_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_pending_idx" ON "events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_prices_candidate_ts_idx" ON "market_prices" USING btree ("candidate","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_prices_market_candidate_ts_idx" ON "market_prices" USING btree ("market_id","candidate","ts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "news_url_uq" ON "news" USING btree ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_published_idx" ON "news" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_pending_tag_idx" ON "news" USING btree ("tagged_at") WHERE tagged_at IS NULL;