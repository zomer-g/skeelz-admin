CREATE TABLE "ga_channel_daily" (
	"date" date NOT NULL,
	"channel_group" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"sessions" integer NOT NULL,
	"active_users" integer NOT NULL,
	"new_users" integer NOT NULL,
	"engaged_sessions" integer NOT NULL,
	CONSTRAINT "ga_channel_daily_date_channel_group_source_medium_pk" PRIMARY KEY("date","channel_group","source","medium")
);
--> statement-breakpoint
CREATE TABLE "ga_event_daily" (
	"date" date NOT NULL,
	"event_name" text NOT NULL,
	"page_path" text NOT NULL,
	"site_job_key" varchar(24),
	"event_count" integer NOT NULL,
	"total_users" integer NOT NULL,
	CONSTRAINT "ga_event_daily_date_event_name_page_path_pk" PRIMARY KEY("date","event_name","page_path")
);
--> statement-breakpoint
CREATE TABLE "ga_page_daily" (
	"date" date NOT NULL,
	"page_path" text NOT NULL,
	"site_job_key" varchar(24),
	"views" integer NOT NULL,
	"active_users" integer NOT NULL,
	"sessions" integer NOT NULL,
	CONSTRAINT "ga_page_daily_date_page_path_pk" PRIMARY KEY("date","page_path")
);
--> statement-breakpoint
CREATE TABLE "gtm_versions" (
	"version_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"fingerprint" text,
	"tag_count" integer NOT NULL,
	"trigger_count" integer NOT NULL,
	"variable_count" integer NOT NULL,
	"sends_job_id" boolean NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoov_campaign_stats" (
	"campaign_id" integer PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone,
	"sent" integer,
	"opens" integer,
	"clicks" integer,
	"bounces" integer,
	"unsubscribes" integer,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoov_campaigns" (
	"id" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoov_lists" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"contacts_count" integer,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ga_event_daily_event_idx" ON "ga_event_daily" USING btree ("event_name","date");--> statement-breakpoint
CREATE INDEX "ga_event_daily_job_idx" ON "ga_event_daily" USING btree ("site_job_key","date");--> statement-breakpoint
CREATE INDEX "ga_page_daily_job_idx" ON "ga_page_daily" USING btree ("site_job_key","date");