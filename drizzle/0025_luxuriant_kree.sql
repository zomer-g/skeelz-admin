ALTER TABLE "sync_runs" ADD COLUMN "note" text;--> statement-breakpoint
-- Google and SMOOV wrote a successful run's report into "error"; it moves to "note". A run that failed wrote no rows.
UPDATE "sync_runs" SET "note" = "error", "error" = NULL WHERE "mode" = 'marketing' AND "error" IS NOT NULL AND "upserted" > 0;
