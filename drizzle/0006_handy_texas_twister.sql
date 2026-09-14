CREATE TABLE "campaign_jobs" (
	"campaign_key" text NOT NULL,
	"job_case_id" varchar(18) NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_jobs_campaign_key_job_case_id_pk" PRIMARY KEY("campaign_key","job_case_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_settings" (
	"campaign_key" text PRIMARY KEY NOT NULL,
	"label" text,
	"smoov_campaign_id" integer,
	"send_day" date,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ga_campaign_daily" (
	"date" date NOT NULL,
	"campaign" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"sessions" integer NOT NULL,
	"new_users" integer NOT NULL,
	"engaged_sessions" integer NOT NULL,
	CONSTRAINT "ga_campaign_daily_date_campaign_source_medium_pk" PRIMARY KEY("date","campaign","source","medium")
);
--> statement-breakpoint
CREATE TABLE "ga_campaign_event_daily" (
	"date" date NOT NULL,
	"campaign" text NOT NULL,
	"event_name" text NOT NULL,
	"event_count" integer NOT NULL,
	CONSTRAINT "ga_campaign_event_daily_date_campaign_event_name_pk" PRIMARY KEY("date","campaign","event_name")
);
--> statement-breakpoint
CREATE TABLE "ga_campaign_landing_daily" (
	"date" date NOT NULL,
	"campaign" text NOT NULL,
	"landing_page" text NOT NULL,
	"site_job_key" varchar(24),
	"sessions" integer NOT NULL,
	CONSTRAINT "ga_campaign_landing_daily_date_campaign_landing_page_pk" PRIMARY KEY("date","campaign","landing_page")
);
--> statement-breakpoint
CREATE INDEX "campaign_jobs_job_idx" ON "campaign_jobs" USING btree ("job_case_id");--> statement-breakpoint
CREATE INDEX "ga_campaign_daily_campaign_idx" ON "ga_campaign_daily" USING btree ("campaign","date");--> statement-breakpoint
CREATE INDEX "ga_campaign_landing_campaign_idx" ON "ga_campaign_landing_daily" USING btree ("campaign");--> statement-breakpoint
-- New GA campaign reports need history: restart the GA mirror from its start date.
DELETE FROM "sync_state" WHERE "object" = 'GA4';
