CREATE TABLE "cv_topics" (
	"document_id" varchar(18) NOT NULL,
	"topic_id" text NOT NULL,
	"phrases" text[] NOT NULL,
	CONSTRAINT "cv_topics_document_id_topic_id_pk" PRIMARY KEY("document_id","topic_id")
);
--> statement-breakpoint
CREATE INDEX "cv_topics_topic_idx" ON "cv_topics" USING btree ("topic_id");