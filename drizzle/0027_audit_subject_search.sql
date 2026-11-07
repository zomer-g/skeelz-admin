CREATE INDEX "audit_log_details_idx" ON "audit_log" USING gin ("details" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target" text_pattern_ops);--> statement-breakpoint
-- The activity log is append-only (docs/cv-security.md): no entry is changed, and none is deleted
-- before the 24-month retention (LOG_RETENTION_MONTHS in src/lib/audit.ts; purgeOldLogs deletes past it).
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log entries cannot be changed' USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' AND OLD.at >= now() - make_interval(months => 24) THEN
    RAISE EXCEPTION 'audit_log entries are kept for 24 months' USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_log cannot be truncated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_append_only_rows ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only_rows BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_truncate ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
