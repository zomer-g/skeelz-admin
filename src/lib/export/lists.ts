import { companyFilters, COMPANY_SORTS, jobStatusLabel, searchCompanies } from "@/lib/entities/companies";
import { leadFilters, LEAD_SORTS, searchLeads } from "@/lib/entities/leads";
import { loadPayments, paymentFilters, PAYMENT_SORT_FIELDS, PAYMENT_SORTS } from "@/lib/entities/payments";
import { positionFilters, POSITION_SORTS, searchPositions } from "@/lib/entities/positions";
import type { SearchParams } from "@/lib/entities/search";
import { sortParam, sortRows } from "@/lib/entities/sort";
import { placeText } from "@/lib/geo/filters";
import type { ExportTable } from "./tabular";

/**
 * The record lists that download whole (every row the filter finds, not the page on screen), through
 * /api/lists/[list]/export. Only lists with no personal data of candidates or employees: jobs,
 * employers and their leads (an employer's contact details are not personal data here), and the
 * payments list, which names the hired candidate and so also counts in the daily export budget
 * (`people`). Each reads the same filters and sort as its page.
 */

/** More than this is a database job, not a report. */
export const MAX_LIST_ROWS = 20_000;

const day = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : d;
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
};

export interface ListExport {
  title: string;
  /** Rows name people (candidates): the download counts in the daily export budget. */
  people?: boolean;
  load(search: SearchParams): Promise<ExportTable>;
}

export const LIST_EXPORTS: Record<string, ListExport> = {
  positions: {
    title: "משרות",
    async load(search) {
      const { rows } = await searchPositions(positionFilters(search), { page: 1, pageSize: MAX_LIST_ROWS, sort: sortParam(search, POSITION_SORTS, "created") });
      return {
        name: "משרות",
        headers: ["משרה", "Case", "מעסיק", "סטטוס באתר", "בתשלום", "בכתר", "מיקום", "נפה / מחוז", "כישורים נדרשים", "הגשות", "נפתחה"],
        rows: rows.map((j) => [
          j.title,
          j.caseNumber,
          j.company,
          j.status ? jobStatusLabel(j.status) : null,
          j.paid ? "כן" : "לא",
          j.marked ? "כן" : "לא",
          j.location ?? j.place.locality,
          placeText(j.place, true),
          j.skills.join(" · ") || null,
          j.applications,
          day(j.createdAt),
        ]),
      };
    },
  },
  companies: {
    title: "מעסיקים",
    async load(search) {
      const { rows } = await searchCompanies(companyFilters(search), { page: 1, pageSize: MAX_LIST_ROWS, sort: sortParam(search, COMPANY_SORTS, "active") });
      return {
        name: "מעסיקים",
        headers: ["מעסיק", "משרות פעילות", "פעילות בתשלום", "פעילות בכתר", "כל המשרות", "הגשות", "משרה אחרונה", "איש קשר", "מייל", "טלפון", "מיקומים"],
        rows: rows.map((c) => [
          c.name,
          c.activeJobs,
          c.paidActiveJobs,
          c.markedActiveJobs,
          c.jobs,
          c.applications,
          day(c.lastJobAt),
          c.contactName,
          c.contactEmail,
          c.contactPhone,
          c.locations.join(" · ") || null,
        ]),
      };
    },
  },
  leads: {
    title: "לידי מעסיקים",
    async load(search) {
      const { rows } = await searchLeads(leadFilters(search), { page: 1, pageSize: MAX_LIST_ROWS, sort: sortParam(search, LEAD_SORTS, "created") });
      return {
        name: "לידי מעסיקים",
        headers: ["מעסיק", "נושא", "Case", "סטטוס מעסיק", "איש קשר", "מייל", "טלפון", "סטטוס", "מטפל", "נפתח", "שינוי סטטוס אחרון"],
        rows: rows.map((l) => [
          l.accountName,
          l.subject,
          l.caseNumber,
          l.accountStatus,
          l.contactName,
          l.contactEmail,
          l.contactPhone,
          l.status,
          l.ownerName,
          day(l.createdAt),
          day(l.statusChangedAt),
        ]),
      };
    },
  },
  payments: {
    title: "מעקב תשלומים",
    people: true,
    async load(search) {
      const rows = sortRows(await loadPayments(paymentFilters(search)), PAYMENT_SORT_FIELDS, sortParam(search, PAYMENT_SORTS, "start")).slice(0, MAX_LIST_ROWS);
      return {
        name: "מעקב תשלומים",
        headers: [
          "מועמד",
          "שולם",
          "Case",
          "נושא",
          "חברה",
          "איש קשר במעסיק",
          "טלפון משרה",
          "תחילת עבודה",
          "תאריך החשבונית",
          "אחוז משכר",
          'לגבייה לפני מע"מ',
          "עמלה 7.5%",
          "סטטוס מועמד",
          "סטטוס פרויקט",
          "תאריך לתשלום",
        ],
        rows: rows.map((r) => [
          r.candidateName,
          r.paid ? "שולם" : "לא שולם",
          r.caseNumber,
          r.subject,
          r.company,
          r.employerContact,
          r.employerPhone,
          day(r.startDate),
          day(r.invoiceDate),
          r.salaryPercent,
          r.collection,
          r.commission,
          r.candidateStatus,
          r.projectStatus,
          day(r.paymentDate),
        ]),
      };
    },
  },
};
