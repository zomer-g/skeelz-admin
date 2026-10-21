CREATE TABLE "sf_file_link" (
	"id" varchar(18) PRIMARY KEY NOT NULL,
	"document_id" varchar(18) NOT NULL,
	"linked_entity_id" varchar(18) NOT NULL,
	"entity_type" text NOT NULL,
	"title" text,
	"extension" text,
	"size" integer,
	"version_id" varchar(18),
	"document_created_at" timestamp with time zone,
	"system_modstamp" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sf_file_link_document_idx" ON "sf_file_link" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "sf_file_link_entity_idx" ON "sf_file_link" USING btree ("linked_entity_id");