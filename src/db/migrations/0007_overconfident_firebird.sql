ALTER TYPE "public"."bot_post_shape" ADD VALUE 'weekly_recap';--> statement-breakpoint
ALTER TABLE "bot_posts" ADD COLUMN "thread" jsonb;