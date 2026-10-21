CREATE TABLE "access_reviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_quota_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"day" date NOT NULL,
	"extra" integer NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_email" text NOT NULL,
	"day" date NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by" text
);
--> statement-breakpoint
CREATE INDEX "access_reviews_user_idx" ON "access_reviews" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "file_quota_grants_user_day_idx" ON "file_quota_grants" USING btree ("user_email","day");--> statement-breakpoint
CREATE UNIQUE INDEX "security_alerts_once_idx" ON "security_alerts" USING btree ("kind","user_email","day","threshold");