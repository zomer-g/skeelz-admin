import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { candidateFilters, CONTACT_FIELDS, loadCandidateContacts, MAX_CONTACTS, type ContactField } from "@/lib/entities/candidates";
import type { SearchParams } from "@/lib/entities/search";
import { afterExport, atExportLimit, dailyExportUsage, exportAllowance, exportLimitMessage } from "@/lib/security/exports";

export const dynamic = "force-dynamic";

/**
 * The addresses (or phone numbers) behind a candidate search, for the copy
 * buttons on `/candidates`. It takes the same query parameters as the list, so
 * what is copied is exactly what the filter shows — every match, not the page.
 * Handing over contact details in bulk is worth a line in the audit log, so
 * every call writes one with the filter and the count — and that count is what
 * the daily export budget (lib/security/exports.ts) is made of: past it the
 * list is cut to what is left, then refused until an admin allows more.
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
  const field: ContactField = url.searchParams.get("field") === "phone" ? "phone" : "email";
  const search = Object.fromEntries(url.searchParams.entries()) as SearchParams;
  const filters = candidateFilters(search);

  const usage = await dailyExportUsage(user.email);
  if (usage.exported >= usage.allowed) {
    await atExportLimit(user.email, usage, "/api/candidates/contacts");
    return new Response(exportLimitMessage(usage), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const found = await loadCandidateContacts(filters, field);
  const { take, limited } = exportAllowance(usage, found.values.length);
  const values = found.values.slice(0, take);
  const used = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  await writeAudit(user.email, "candidates.contacts_copied", field, { count: values.length, truncated: found.truncated, limited, filters: used });
  await afterExport(user.email, usage, values.length);
  if (limited) await atExportLimit(user.email, usage, "/api/candidates/contacts");

  return Response.json(
    {
      field,
      label: CONTACT_FIELDS[field],
      count: values.length,
      truncated: found.truncated,
      limit: MAX_CONTACTS,
      // The daily export budget: how many people were left out of this copy because of it, and where it stands.
      limited,
      left_out: found.values.length - values.length,
      daily: { used: usage.exported + values.length, allowed: usage.allowed },
      values,
    },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
