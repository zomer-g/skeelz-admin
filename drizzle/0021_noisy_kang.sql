CREATE TABLE "api_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"key_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"ip" text,
	"ms" integer
);
--> statement-breakpoint
CREATE INDEX "api_calls_key_idx" ON "api_calls" USING btree ("key_id","at");