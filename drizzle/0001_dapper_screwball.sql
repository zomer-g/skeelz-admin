CREATE TABLE "sf_schema_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"report" jsonb NOT NULL,
	"markdown" text NOT NULL
);
