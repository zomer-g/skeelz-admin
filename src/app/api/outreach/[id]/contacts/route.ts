import { writeAuditStrict } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { MAX_CV_CONTACTS, type CvContactField } from "@/lib/entities/cvs";
import { loadOutreachContacts, loadOutreachJob, outreachFilters } from "@/lib/entities/outreach";
import { isSfId, type SearchParams } from "@/lib/entities/search";
import { afterExport, atExportLimit, dailyExportUsage, exportAllowance, exportLimitMessage, guardedExport } from "@/lib/security/exports";

export const dynamic = "force-dynamic";

const LABELS: Record<CvContactField, string> = { email: "כתובות מייל", phone: "מספרי טלפון" };

/**
 * The emails (or phones) of the candidates who fit a job, for the copy buttons on `/outreach/[id]`.
 * Same query parameters as the page (topics, words, reach, applied), so what is copied is every
 * person the search ranks, not the page. Logged as `cvs.contacts_copied` with the job and the
 * search, which feeds the daily export budget (lib/security/exports.ts): past it the list is cut, then refused.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }

  const { id } = await params;
  const job = isSfId(id) ? await loadOutreachJob(id) : null;
  if (!job) return new Response("not found", { status: 404 });
  const url = new URL(request.url);
  const field: CvContactField = url.searchParams.get("field") === "phone" ? "phone" : "email";
  const search: SearchParams = {};
  for (const [k, v] of url.searchParams.entries()) {
    const had = search[k];
    search[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v];
  }
  const filters = outreachFilters(search, job);

  return guardedExport(user.email, async () => {
    const usage = await dailyExportUsage(user.email);
    if (usage.exported >= usage.allowed) {
      await atExportLimit(user.email, usage, `/api/outreach/${job.id}/contacts`);
      return new Response(exportLimitMessage(usage), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }

    const found = await loadOutreachContacts(job, filters, field, { actor: user.email, via: "screen" });
    const { take, limited } = exportAllowance(usage, found.values.length);
    const values = found.values.slice(0, take);
    await writeAuditStrict(user.email, "cvs.contacts_copied", field, {
      count: values.length,
      people: found.people,
      truncated: found.truncated,
      limited,
      text_search: found.wordSearch,
      outreach: { jobId: job.id, title: job.title },
      filters: { topic: filters.topics.join(","), words: filters.words.join(" "), reach: filters.reach, applied: filters.withApplied },
    });
    await afterExport(user.email, usage, values.length);
    if (limited) await atExportLimit(user.email, usage, `/api/outreach/${job.id}/contacts`);

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
  });
}
