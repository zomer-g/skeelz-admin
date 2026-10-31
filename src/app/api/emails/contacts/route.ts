import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { emailFilters, loadEmailListContacts, MAX_EMAIL_CONTACTS, type EmailContactField } from "@/lib/entities/emails";
import type { SearchParams } from "@/lib/entities/search";
import { afterExport, atExportLimit, dailyExportUsage, exportAllowance, exportLimitMessage } from "@/lib/security/exports";

export const dynamic = "force-dynamic";

const LABELS: Record<EmailContactField, string> = { email: "כתובות מייל", phone: "מספרי טלפון" };

/**
 * The addresses (or phones) behind a search on `/emails`, for its copy buttons. Same query
 * parameters as the list, so what is copied is every address the filter finds, not the page.
 * Every call is logged with the filter and the count, which feeds the daily export budget
 * (lib/security/exports.ts): past it the list is cut, then refused.
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
  const field: EmailContactField = url.searchParams.get("field") === "phone" ? "phone" : "email";
  const filters = emailFilters(Object.fromEntries(url.searchParams.entries()) as SearchParams);

  const usage = await dailyExportUsage(user.email);
  if (usage.exported >= usage.allowed) {
    await atExportLimit(user.email, usage, "/api/emails/contacts");
    return new Response(exportLimitMessage(usage), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const found = await loadEmailListContacts(filters, field);
  const { take, limited } = exportAllowance(usage, found.values.length);
  const values = found.values.slice(0, take);
  const used = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  await writeAudit(user.email, "emails.contacts_copied", field, { count: values.length, truncated: found.truncated, limited, filters: used });
  await afterExport(user.email, usage, values.length);
  if (limited) await atExportLimit(user.email, usage, "/api/emails/contacts");

  return Response.json(
    {
      field,
      label: LABELS[field],
      count: values.length,
      truncated: found.truncated,
      limit: MAX_EMAIL_CONTACTS,
      limited,
      left_out: found.values.length - values.length,
      daily: { used: usage.exported + values.length, allowed: usage.allowed },
      values,
    },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
