import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { PAYMENTS_EXPORTED, REPORT_EXPORTED } from "@/lib/export/audit";
import { LIST_EXPORTS, MAX_LIST_ROWS } from "@/lib/export/lists";
import { encode, fileName, MIME, type ExportFormat } from "@/lib/export/tabular";
import type { SearchParams } from "@/lib/entities/search";
import { afterExport, atExportLimit, dailyExportUsage, exportAllowance, exportLimitMessage } from "@/lib/security/exports";

export const dynamic = "force-dynamic";

/**
 * A whole record list as CSV or XLSX: every row its filters find (up to MAX_LIST_ROWS), in its sort,
 * with the same query parameters as the page. Only the lists in LIST_EXPORTS (no candidates' or
 * employees' details). Every download is logged with the filters and the row count; the payments
 * list names hired candidates, so it also draws on the daily export budget and is cut, then refused,
 * past it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ list: string }> }) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }

  const { list } = await params;
  const spec = Object.hasOwn(LIST_EXPORTS, list) ? LIST_EXPORTS[list] : undefined;
  if (!spec) return new Response("אין רשימה כזו להורדה", { status: 404 });

  const url = new URL(request.url);
  const format: ExportFormat = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const search = Object.fromEntries(url.searchParams.entries()) as SearchParams;
  const filters = Object.fromEntries([...url.searchParams.entries()].filter(([k, v]) => v && k !== "format" && k !== "page"));

  const usage = spec.people ? await dailyExportUsage(user.email) : null;
  if (usage && usage.exported >= usage.allowed) {
    await atExportLimit(user.email, usage, `/api/lists/${list}/export`);
    return new Response(exportLimitMessage(usage), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const table = await spec.load(search);
  const found = table.rows.length;
  let limited = false;
  if (usage) {
    const allowance = exportAllowance(usage, found);
    table.rows = table.rows.slice(0, allowance.take);
    limited = allowance.limited;
  }

  const details = { list, format, rows: table.rows.length, truncated: found >= MAX_LIST_ROWS, limited, filters };
  if (usage) {
    // `count` is what the daily export budget sums (lib/security/exports.ts).
    await writeAudit(user.email, PAYMENTS_EXPORTED, list, { ...details, count: table.rows.length });
    await afterExport(user.email, usage, table.rows.length);
    if (limited) await atExportLimit(user.email, usage, `/api/lists/${list}/export`);
  } else {
    await writeAudit(user.email, REPORT_EXPORTED, spec.title, { screen: `/${list}`, ...details });
  }

  const name = fileName(`${spec.title}_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date())}`, format);
  return new Response(encode(table, format) as BodyInit, {
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="export.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
