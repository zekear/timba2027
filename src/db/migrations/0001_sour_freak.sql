CREATE TYPE "public"."poll_confidence" AS ENUM('alto', 'medio', 'bajo');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('pending_review', 'approved', 'auto_approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"pollster_id" integer NOT NULL,
	"source_url" text NOT NULL,
	"source_tweet_id" text NOT NULL,
	"fecha_campo" timestamp with time zone,
	"sample_size" integer,
	"metodologia" text,
	"results" jsonb NOT NULL,
	"confidence" "poll_confidence" NOT NULL,
	"status" "poll_status" DEFAULT 'pending_review' NOT NULL,
	"raw_classifier_output" text,
	"raw_extractor_output" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pollsters" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"x_handle" text NOT NULL,
	"x_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pollsters_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pollsters_x_handle_unique" UNIQUE("x_handle")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "polls" ADD CONSTRAINT "polls_pollster_id_pollsters_id_fk" FOREIGN KEY ("pollster_id") REFERENCES "public"."pollsters"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "polls_source_tweet_uq" ON "polls" USING btree ("source_tweet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polls_pending_idx" ON "polls" USING btree ("status","ingested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polls_pollster_idx" ON "polls" USING btree ("pollster_id","ingested_at");