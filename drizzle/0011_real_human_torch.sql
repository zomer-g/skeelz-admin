CREATE TABLE "sf_account_history" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"account_id" varchar(18) NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"data_type" text,
	"created_date" timestamp with time zone NOT NULL,
	"created_by_id" varchar(18),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sf_account_history_account_field_idx" ON "sf_account_history" USING btree ("account_id","field","created_date");