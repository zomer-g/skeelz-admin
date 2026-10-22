CREATE TABLE "cv_topic_scans" (
	"document_id" varchar(18) PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
