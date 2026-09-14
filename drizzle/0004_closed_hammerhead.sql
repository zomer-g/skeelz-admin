ALTER TABLE "sf_task" ADD COLUMN "call_party" text;--> statement-breakpoint
ALTER TABLE "sf_task" ADD COLUMN "call_answered" boolean;--> statement-breakpoint
-- New Task columns come from all-fields sync: restart the Task mirror from scratch.
DELETE FROM "sync_state" WHERE "object" = 'Task';
