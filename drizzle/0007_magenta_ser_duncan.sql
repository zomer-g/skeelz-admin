CREATE TABLE "webhook_case_state" (
	"case_id" varchar(18) PRIMARY KEY NOT NULL,
	"status" text,
	"site_status" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE delivered_at is null and failed_at is null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_type_created_idx" ON "webhook_deliveries" USING btree ("type","created_at");