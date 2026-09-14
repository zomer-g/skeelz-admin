CREATE TABLE "site_text_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"body" text NOT NULL,
	"saved_by" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_texts" (
	"key" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "site_text_versions_key_idx" ON "site_text_versions" USING btree ("key","id");