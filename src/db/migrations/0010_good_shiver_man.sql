ALTER TABLE "pollsters" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pollsters" ADD COLUMN "last_active_at" timestamp with time zone;