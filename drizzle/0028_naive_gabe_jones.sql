CREATE TABLE "application_source" (
	"case_id" varchar(18) PRIMARY KEY NOT NULL,
	"applicant_type" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"delta_seconds" integer NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"channel_group" text NOT NULL,
	"device_category" text NOT NULL,
	"ambiguous" boolean NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ga_application_minute" (
	"minute" timestamp with time zone NOT NULL,
	"event_name" text NOT NULL,
	"page_path" text NOT NULL,
	"site_job_key" varchar(24),
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"channel_group" text NOT NULL,
	"device_category" text NOT NULL,
	"event_count" integer NOT NULL,
	CONSTRAINT "ga_application_minute_pk" PRIMARY KEY("minute","event_name","page_path","source","medium","campaign","channel_group","device_category")
);
--> statement-breakpoint
CREATE INDEX "application_source_channel_idx" ON "application_source" USING btree ("channel_group");--> statement-breakpoint
CREATE INDEX "ga_application_minute_job_idx" ON "ga_application_minute" USING btree ("site_job_key","minute");