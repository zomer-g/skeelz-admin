ALTER TABLE "mcp_grants" ADD COLUMN "prev_refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "code_hash" text;--> statement-breakpoint
CREATE INDEX "mcp_grants_prev_refresh_idx" ON "mcp_grants" USING btree ("prev_refresh_hash");--> statement-breakpoint
CREATE INDEX "mcp_grants_code_idx" ON "mcp_grants" USING btree ("code_hash");