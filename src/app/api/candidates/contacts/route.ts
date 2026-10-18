import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { candidateFilters, CONTACT_FIELDS, loadCandidateContacts, MAX_CONTACTS, type ContactField } from "@/lib/entities/candidates";
import type { SearchParams } from "@/lib/entities/search";

export const dynamic = "force-dynamic";

/**
 * The addresses (or phone numbers) behind a candidate search, for the copy
 * buttons on `/candidates`. It takes the same query parameters as the list, so
 * what is copied is exactly what the filter shows — every match, not the page.
 * Handing over contact details in bulk is worth a line in the audit log, so
 * every call writes one with the filter and the count.
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

  const { values, truncated } = await loadCandidateContacts(filters, field);
  const used = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  await writeAudit(user.email, "candidates.contacts_copied", field, { count: values.length, truncated, filters: used });

  return Response.json(
    {
      field,
      label: CONTACT_FIELDS[field],
      count: values.length,
      truncated,
      limit: MAX_CONTACTS,
      values,
    },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
