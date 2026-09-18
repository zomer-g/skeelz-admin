"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { sfSchemaReports } from "@/lib/db/schema";
import { salesforceConfigured } from "@/lib/sf/client";
import { testConnection, type ConnectionResult } from "@/lib/sf/diagnostics";
import { buildSchemaReport, reportToMarkdown } from "@/lib/sf/schema-report";
import { logError, safeErrorMessage } from "@/lib/log";

export type ConnectionState = ({ ok: true } & ConnectionResult) | { ok: false; message: string } | null;
export type ReportState = { ok: boolean; message: string } | null;

const NOT_CONFIGURED = "חסרים משתני סביבה ב-xhostd: SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET (אחרי הגדרה נדרשת פריסה מחדש)";

/** Salesforce's own message helps; a database error's message would carry values, so it becomes its code. */
const describeError = safeErrorMessage;

export async function testSalesforceConnection(_prev: ConnectionState, _form: FormData): Promise<ConnectionState> {
  const admin = await requireUser("admin");
  if (!salesforceConfigured()) return { ok: false, message: NOT_CONFIGURED };

  try {
    const result = await testConnection();
    const failed = result.objects.filter((o) => !o.ok).map((o) => o.name);
    console.log(`[salesforce] connection test ok in ${result.ms}ms; unreadable objects: ${failed.join(", ") || "none"}`);
    await writeAudit(admin.email, "salesforce.connection_test", null, { ok: true, unreadable: failed });
    return { ok: true, ...result };
  } catch (err) {
    const message = describeError(err);
    logError("salesforce connection test", err);
    await writeAudit(admin.email, "salesforce.connection_test", null, { ok: false, message });
    return { ok: false, message };
  }
}

export async function generateSchemaReport(_prev: ReportState, _form: FormData): Promise<ReportState> {
  const admin = await requireUser("admin");
  if (!salesforceConfigured()) return { ok: false, message: NOT_CONFIGURED };

  try {
    const report = await buildSchemaReport();
    const markdown = reportToMarkdown(report);
    const [row] = await getDb()
      .insert(sfSchemaReports)
      .values({ createdBy: admin.email, report, markdown })
      .returning({ id: sfSchemaReports.id });

    // Also to stdout, line by line with a marker, so the report can be read from
    // the runtime log without anyone copying it out of the browser. It holds
    // schema metadata and public job links only — no secrets, no contact data.
    console.log(`[sf-schema-report] BEGIN id=${row!.id}`);
    for (const line of markdown.split("\n")) console.log(`[sf-schema-report] ${line}`);
    console.log(`[sf-schema-report] END id=${row!.id}`);

    await writeAudit(admin.email, "salesforce.schema_report", String(row!.id));
    revalidatePath("/admin/salesforce");
    return { ok: true, message: "הדו״ח הופק ונשמר" };
  } catch (err) {
    const message = describeError(err);
    logError("sf-schema-report", err);
    await writeAudit(admin.email, "salesforce.schema_report", null, { ok: false, message });
    return { ok: false, message };
  }
}
