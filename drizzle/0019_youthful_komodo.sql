CREATE TABLE "staff_source_state" (
	"source" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"items" integer
);
--> statement-breakpoint
CREATE TABLE "staff_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"url" text,
	"done_on" date,
	"hours" numeric(6, 2),
	"notes" text,
	"shared" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monday_user_id" text;--> statement-breakpoint
CREATE INDEX "staff_work_items_user_idx" ON "staff_work_items" USING btree ("user_id","done_on");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_monday_user_id_unique" UNIQUE("monday_user_id");