CREATE TABLE "staff_sheet_sources" (
	"spreadsheet_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"last_hash" text,
	"last_result" jsonb
);
