ALTER TABLE "mcp_grants" ADD COLUMN "staff_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_work_items" ADD COLUMN "board_id" text;--> statement-breakpoint
ALTER TABLE "staff_work_items" ADD COLUMN "board_name" text;--> statement-breakpoint
ALTER TABLE "staff_work_items" ADD COLUMN "done_at" timestamp with time zone;