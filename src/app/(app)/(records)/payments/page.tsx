import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm } from "@/components/entities/Search";
import { Badge, Card, NewTabNote, PageHeader, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { israelDay, viewPath } from "@/lib/dashboard/params";
import { AUTO_SUBJECT, loadPaymentStatuses, loadPayments, PAYMENTS_SINCE, type PaymentFilters, type PaymentRow } from "@/lib/entities/payments";
import { choice, param, type SearchParams } from "@/lib/entities/search";
import { fieldSorts, sortParam, sortRows, tableSort, type SortField } from "@/lib/entities/sort";
import { fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "מעקב תשלומים" };
export const dynamic = "force-dynamic";

const ACTION = "/payments";
const KEYS = ["q", "paid", "cstatus", "sort", "dir"];
/** A payment date this close counts as due soon. */
const DUE_SOON_DAYS = 14;

const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
const fmtMoney = (n: number | null) => (n == null ? "—" : money.format(n));
const fmtDay = (d: string | null) => (d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}` : "—");

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** The columns the list can be sorted by; the newest start date first, as the Salesforce view has it. */
const SORT_FIELDS: readonly SortField<PaymentRow>[] = [
  { key: "start", kind: "date", value: (r) => r.startDate },
  { key: "candidate", kind: "text", value: (r) => r.candidateName },
  { key: "paid", kind: "number", value: (r) => r.paid },
  { key: "case", kind: "text", value: (r) => r.caseNumber },
  { key: "subject", kind: "text", value: (r) => r.subject },
  { key: "company", kind: "text", value: (r) => r.company },
  { key: "contact", kind: "text", value: (r) => r.employerContact },
  { key: "invoice", kind: "date", value: (r) => r.invoiceDate },
  { key: "percent", kind: "number", value: (r) => r.salaryPercent },
  { key: "collection", kind: "number", value: (r) => r.collection },
  { key: "commission", kind: "number", value: (r) => r.commission },
  { key: "cstatus", kind: "text", value: (r) => r.candidateStatus },
  { key: "pstatus", kind: "text", value: (r) => r.projectStatus },
  { key: "due", kind: "date", value: (r) => r.paymentDate },
];
const PAYMENT_SORTS = fieldSorts(SORT_FIELDS);

/**
 * Payment tracking: the placements the company invoices for, as in the
 * Salesforce list view "מעקב תשלומים". Read-only — the fields are edited in Salesforce.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters: PaymentFilters = {
    q: param(search, "q"),
    paid: choice(search, "paid", ["yes", "no"] as const),
    candidateStatus: param(search, "cstatus"),
  };
  const sort = sortParam(search, PAYMENT_SORTS, "start");
  const values: Record<string, string> = { q: filters.q, paid: filters.paid, cstatus: filters.candidateStatus };
  const [loaded, statuses] = await Promise.all([loadPayments(filters), loadPaymentStatuses()]);
  const rows = sortRows(loaded, SORT_FIELDS, sort);

  const today = israelDay();
  const sfBase = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");
  const unpaid = rows.filter((r) => !r.paid);
  const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => number | null) => list.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const overdue = unpaid.filter((r) => r.paymentDate && r.paymentDate < today);
  const dueSoon = unpaid.filter((r) => r.paymentDate && r.paymentDate >= today && daysBetween(today, r.paymentDate) <= DUE_SOON_DAYS);

  return (
    <>
      <PageHeader title="מעקב תשלומים" subtitle="השמות שעליהן גובים תשלום, כמו ברשימה “מעקב תשלומים” ב-Salesforce" />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "מועמד, חברה, איש קשר, מספר Case או סטטוס פרויקט", wide: true },
          { kind: "select", name: "paid", label: "שולם", options: [{ value: "yes", label: "שולם" }, { value: "no", label: "לא שולם" }] },
          { kind: "select", name: "cstatus", label: "סטטוס מועמד", options: statuses },
        ]}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="השמות ברשימה" value={fmtInt(rows.length)} hint={`${fmtInt(rows.length - unpaid.length)} שולמו · ${fmtInt(unpaid.length)} לא שולמו`} />
        <StatCard label='לגבייה לפני מע"מ' value={fmtMoney(sum(rows, (r) => r.collection))} hint={`מתוכם לא שולם: ${fmtMoney(sum(unpaid, (r) => r.collection))}`} />
        <StatCard label="עמלות 7.5%" value={fmtMoney(sum(rows, (r) => r.commission))} hint={`מתוכן לא שולם: ${fmtMoney(sum(unpaid, (r) => r.commission))}`} />
        <StatCard
          label="מועד תשלום עבר"
          value={fmtInt(overdue.length)}
          hint={`לא שולמו ותאריך התשלום עבר · ${fmtInt(dueSoon.length)} נוספים ב-${DUE_SOON_DAYS} הימים הקרובים`}
        />
      </div>

      <Card title={`מעקב תשלומים · ${fmtInt(rows.length)}`}>
        <Table
          caption="מעקב תשלומים"
          sort={tableSort(PAYMENT_SORTS, sort, ACTION, values)}
          head={[
            { label: "מועמד", sort: "candidate" },
            { label: "שולם", sort: "paid" },
            { label: "Case", sort: "case" },
            { label: "נושא", sort: "subject" },
            { label: "חברה", sort: "company" },
            { label: "איש קשר במעסיק", sort: "contact" },
            "טלפון משרה",
            { label: "תחילת עבודה", sort: "start" },
            { label: "תאריך החשבונית", sort: "invoice" },
            { label: "אחוז משכר", sort: "percent" },
            { label: 'לגבייה לפני מע"מ', sort: "collection" },
            { label: "עמלה 7.5%", sort: "commission" },
            { label: "סטטוס מועמד", sort: "cstatus" },
            { label: "סטטוס פרויקט", sort: "pstatus" },
            { label: "תאריך לתשלום", sort: "due" },
            "",
          ]}
          empty={rows.length === 0 ? "אין השמות שתואמות לחיפוש" : undefined}
        >
          {rows.map((r) => {
            const late = !r.paid && r.paymentDate && r.paymentDate < today;
            const soon = !r.paid && r.paymentDate && !late && daysBetween(today, r.paymentDate) <= DUE_SOON_DAYS;
            return (
              <tr key={r.id} className="hover:bg-white">
                <td className="min-w-[8rem] px-3 py-2 font-medium">
                  {r.contactId ? (
                    <Link href={`/candidates/${r.contactId}`} className="underline-offset-4 hover:underline">
                      {r.candidateName ?? "(ללא שם)"}
                    </Link>
                  ) : (
                    (r.candidateName ?? "—")
                  )}
                </td>
                <td className="px-3 py-2">{r.paid ? <Badge tone="success">שולם</Badge> : <Badge>לא שולם</Badge>}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  <Link href={`/applications/${r.id}`} className="text-accent-dark underline underline-offset-4">
                    {r.caseNumber ?? "—"}
                  </Link>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2" title={r.subject ?? undefined}>
                  {r.subject ?? "—"}
                </td>
                <td className="min-w-[9rem] px-3 py-2">{r.company ?? "—"}</td>
                <td className="min-w-[8rem] px-3 py-2">{r.employerContact ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums" dir="ltr">
                  {r.employerPhone ? <a href={`tel:${r.employerPhone.replace(/[^\d+]/g, "")}`}>{r.employerPhone}</a> : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(r.startDate)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(r.invoiceDate)}</td>
                <td className="px-3 py-2 tabular-nums">{r.salaryPercent == null ? "—" : `${r.salaryPercent}%`}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtMoney(r.collection)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtMoney(r.commission)}</td>
                <td className="px-3 py-2">{r.candidateStatus ?? "—"}</td>
                <td className="min-w-[10rem] px-3 py-2">{r.projectStatus ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {fmtDay(r.paymentDate)}
                  {late ? (
                    <>
                      {" "}
                      <Badge tone="brand">עבר המועד</Badge>
                    </>
                  ) : soon ? (
                    <>
                      {" "}
                      <Badge tone="warning">בקרוב</Badge>
                    </>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-end">
                  {sfBase ? (
                    <a href={`${sfBase}/${r.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-dark underline underline-offset-4">
                      Salesforce<span className="sr-only"> · {r.candidateName ?? r.caseNumber ?? ""}</span>
                      <NewTabNote />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-muted">
          השמות (Placement_cambium) בסטטוס &quot;התקבל&quot;, שלא סומנו &quot;טכני להעלים&quot;, שנפתחו מ-{fmtDay(PAYMENTS_SINCE)}, בלי הנושא האוטומטי &quot;{AUTO_SUBJECT}&quot;.
          ממוינות לפי תאריך תחילת העבודה, מהחדש לישן. העדכון נעשה ב-Salesforce, והנתונים כאן מתעדכנים כל 10 דקות.
        </p>
      </Card>
    </>
  );
}
