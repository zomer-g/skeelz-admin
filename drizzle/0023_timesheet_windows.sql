CREATE TABLE "staff_time_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_time_entries_source_check" CHECK ("staff_time_entries"."source" in ('demo', 'sheet', 'api', 'manual')),
	CONSTRAINT "staff_time_entries_order_check" CHECK ("staff_time_entries"."end_at" > "staff_time_entries"."start_at")
);
--> statement-breakpoint
ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_time_entries_user_start_idx" ON "staff_time_entries" USING btree ("user_id","start_at");