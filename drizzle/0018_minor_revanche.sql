ALTER TABLE "access_reviews" ADD COLUMN "staff_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staff_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sf_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sf_user_id_unique" UNIQUE("sf_user_id");