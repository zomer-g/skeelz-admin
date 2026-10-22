CREATE TABLE "export_quota_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"day" date NOT NULL,
	"extra" integer NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "export_quota_grants_user_day_idx" ON "export_quota_grants" USING btree ("user_email","day");