import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { cvFilters, loadCvContacts, MAX_CV_CONTACTS, type CvContactField } from "@/lib/entities/cvs";
import type { SearchParams } from "@/lib/entities/search";
import { afterExport, atExportLimit, dailyExportUsage, exportAllowance, exportLimitMessage } from "@/lib/security/exports";

export const dynamic = "force-dynamic";

const LABELS: Record<CvContactField, string> = { email: "כתובות מייל", phone: "מספרי טלפון" };

/**
 * The emails (or phones) of the people behind a CV search, for the copy buttons on `/cvs`. Same
 * query parameters as the list — words inside the files, topic and district included — so what is
 * copied is every file the filter finds, not the page. Every call is logged with the filter and the count,
 * which feeds the daily export budget (lib/security/exports.ts): past it the list is cut, then refused.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }

  const url = new URL(request.url);
  const field: CvContactField = url.searchParams.get("field") === "phone" ? "phone" : "email";
  const filters = cvFilters(Object.fromEntries(url.searchParams.entries()) as SearchParams);

  const usage = await dailyExportUsage(user.email);
  if (usage.exported >= usage.allowed) {
    await atExportLimit(user.email, usage, "/api/cvs/contacts");
    return new Response(exportLimitMessage(usage), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const found = await loadCvContacts(filters, field);
  const { take, limited } = exportAllowance(usage, found.values.length);
  const values = found.values.slice(0, take);
  const used = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  await writeAudit(user.email, "cvs.contacts_copied", field, {
    count: values.length,
    files: found.files,
    truncated: found.truncated,
    limited,
    text_search: found.textSearch,
    filters: used,
  });
  await afterExport(user.email, usage, values.length);
  if (limited) await atExportLimit(user.email, usage, "/api/cvs/contacts");

  return Response.json(
    {
      field,
      label: LABELS[field],
      count: values.length,
      truncated: found.truncated,
      limit: MAX_CV_CONTACTS,
      limited,
      left_out: found.values.length - values.length,
      daily: { used: usage.exported + values.length, allowed: usage.allowed },
      values,
    },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
