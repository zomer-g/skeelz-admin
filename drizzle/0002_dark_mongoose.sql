CREATE TABLE "sf_account" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"name" text,
	"created_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_case" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"record_type_id" varchar(18),
	"status" text,
	"parent_id" varchar(18),
	"contact_id" varchar(18),
	"account_id" varchar(18),
	"owner_id" varchar(18),
	"site_job_key" varchar(24),
	"created_date" timestamp with time zone,
	"closed_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_case_history" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"case_id" varchar(18) NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"data_type" text,
	"created_date" timestamp with time zone NOT NULL,
	"created_by_id" varchar(18),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_contact" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"account_id" varchar(18),
	"name" text,
	"email" text,
	"created_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_email_message" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"parent_id" varchar(18),
	"incoming" boolean NOT NULL,
	"message_date" timestamp with time zone,
	"from_address" text,
	"to_address" text,
	"cc_address" text,
	"subject" text,
	"created_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_event" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"what_id" varchar(18),
	"who_id" varchar(18),
	"subject" text,
	"type" text,
	"start_at" timestamp with time zone,
	"owner_id" varchar(18),
	"created_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_record_type" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"sobject_type" text NOT NULL,
	"developer_name" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean NOT NULL,
	"system_modstamp" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_task" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"what_id" varchar(18),
	"who_id" varchar(18),
	"task_subtype" text,
	"type" text,
	"subject" text,
	"status" text,
	"activity_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_id" varchar(18),
	"created_date" timestamp with time zone,
	"system_modstamp" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_user" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"is_active" boolean NOT NULL,
	"system_modstamp" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"object" text NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"upserted" integer,
	"deleted" integer,
	"api_usage" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"object" text PRIMARY KEY NOT NULL,
	"cursor" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"row_count" integer
);
--> statement-breakpoint
CREATE INDEX "sf_case_record_type_created_idx" ON "sf_case" USING btree ("record_type_id","created_date");--> statement-breakpoint
CREATE INDEX "sf_case_parent_idx" ON "sf_case" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "sf_case_contact_idx" ON "sf_case" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sf_case_status_idx" ON "sf_case" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sf_case_site_job_key_idx" ON "sf_case" USING btree ("site_job_key");--> statement-breakpoint
CREATE INDEX "sf_case_history_case_field_idx" ON "sf_case_history" USING btree ("case_id","field","created_date");--> statement-breakpoint
CREATE INDEX "sf_contact_email_idx" ON "sf_contact" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sf_email_message_parent_idx" ON "sf_email_message" USING btree ("parent_id","message_date");--> statement-breakpoint
CREATE INDEX "sf_event_what_idx" ON "sf_event" USING btree ("what_id","start_at");--> statement-breakpoint
CREATE INDEX "sf_task_what_idx" ON "sf_task" USING btree ("what_id","created_date");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");