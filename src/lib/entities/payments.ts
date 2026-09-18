import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { RECORD_TYPES, STATUS } from "@/lib/metrics/candidates";
import { containsPattern } from "./search";

/**
 * Payment tracking: the placements the company invoices for. Mirrors the
 * Salesforce list view "מעקב תשלומים" (Payment_board) — same filters, same
 * columns — so both show the same rows:
 * - Case record type Placement_cambium, Status "התקבל"
 * - "טכני להעלים" (Field16__c) not checked
 * - Subject is not the automatic "The Following Candidate Has Applied To The Following Position"
 * - opened on or after 1.1.2024
 * Sorted by the start of work (Placement_Date__c), newest first. Read-only:
 * the fields are edited in Salesforce. Definitions in docs/entities.md.
 */

export const AUTO_SUBJECT = "The Following Candidate Has Applied To The Following Position";
export const PAYMENTS_SINCE = "2024-01-01";

export interface PaymentFilters {
  q: string;
  paid: "" | "yes" | "no";
  candidateStatus: string;
}

export interface PaymentRow {
  id: string;
  caseNumber: string | null;
  contactId: string | null;
  candidateName: string | null;
  subject: string | null;
  company: string | null;
  employerContact: string | null;
  employerPhone: string | null;
  /** תאריך תחילת עבודה */
  startDate: string | null;
  /** תאריך החשבונית */
  invoiceDate: string | null;
  /** אחוז משכר */
  salaryPercent: number | null;
  /** לגביה לפני מע"מ */
  collection: number | null;
  /** עמלה 7.5% (a text field in Salesforce) */
  commission: number | null;
  candidateStatus: string | null;
  projectStatus: string | null;
  /** תאריך לתשלום */
  paymentDate: string | null;
  paid: boolean;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown) => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export async function loadPayments(f: PaymentFilters): Promise<PaymentRow[]> {
  const needle = f.q ? containsPattern(f.q.slice(0, 200)) : null;
  const result = await getDb().execute<Row>(sql`
    SELECT c.id,
           c.data->>'CaseNumber' AS case_number,
           c.contact_id,
           coalesce(ct.name, nullif(c.data->>'full_name__c', ''), nullif(c.data->>'SuppliedName', '')) AS candidate_name,
           c.data->>'Subject' AS subject,
           c.data->>'company_cambium__c' AS company,
           c.data->>'PFullName_cambium__c' AS employer_contact,
           c.data->>'PPhone_cambium__c' AS employer_phone,
           c.data->>'Placement_Date__c' AS start_date,
           c.data->>'Invoice_Date__c' AS invoice_date,
           c.data->>'Salary_Percentage__c' AS salary_percent,
           c.data->>'Collection_Before_VAT__c' AS collection,
           c.data->>'Commission__c' AS commission,
           c.data->>'Candidate_Status__c' AS candidate_status,
           c.data->>'Project_Status__c' AS project_status,
           c.data->>'Payment_Date__c' AS payment_date,
           coalesce((c.data->>'paid__c') = 'true', false) AS paid
      FROM sf_case c
      JOIN sf_record_type rt ON rt.id = c.record_type_id
      LEFT JOIN sf_contact ct ON ct.id = c.contact_id
     WHERE rt.developer_name = ${RECORD_TYPES.accepted}
       AND NOT c.is_deleted
       AND btrim(regexp_replace(replace(c.status, chr(160), ' '), ' +', ' ', 'g')) = ${STATUS.accepted}
       AND NOT coalesce((c.data->>'Field16__c') = 'true', false)
       AND coalesce(c.data->>'Subject', '') <> ${AUTO_SUBJECT}
       AND c.created_date >= ${PAYMENTS_SINCE}::date
       ${f.paid === "yes" ? sql`AND (c.data->>'paid__c') = 'true'` : f.paid === "no" ? sql`AND NOT coalesce((c.data->>'paid__c') = 'true', false)` : sql.raw("")}
       ${f.candidateStatus ? sql`AND c.data->>'Candidate_Status__c' = ${f.candidateStatus}` : sql.raw("")}
       ${
         needle
           ? sql`AND (ct.name ILIKE ${needle} OR c.data->>'Subject' ILIKE ${needle} OR c.data->>'company_cambium__c' ILIKE ${needle}
                  OR c.data->>'PFullName_cambium__c' ILIKE ${needle} OR c.data->>'CaseNumber' ILIKE ${needle}
                  OR c.data->>'Project_Status__c' ILIKE ${needle})`
           : sql.raw("")
       }
     ORDER BY c.data->>'Placement_Date__c' DESC NULLS LAST, c.data->>'CaseNumber' DESC`);

  return result.rows.map((r) => ({
    id: String(r.id),
    caseNumber: str(r.case_number),
    contactId: str(r.contact_id),
    candidateName: str(r.candidate_name),
    subject: str(r.subject),
    company: str(r.company),
    employerContact: str(r.employer_contact),
    employerPhone: str(r.employer_phone),
    startDate: day(r.start_date),
    invoiceDate: day(r.invoice_date),
    salaryPercent: num(r.salary_percent),
    collection: num(r.collection),
    commission: num(r.commission),
    candidateStatus: str(r.candidate_status),
    projectStatus: str(r.project_status),
    paymentDate: day(r.payment_date),
    paid: r.paid === true,
  }));
}

/** The candidate statuses in use on the board, for the filter. */
export async function loadPaymentStatuses(): Promise<string[]> {
  const result = await getDb().execute<Row>(sql`
    SELECT DISTINCT c.data->>'Candidate_Status__c' AS s
      FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
     WHERE rt.developer_name = ${RECORD_TYPES.accepted} AND NOT c.is_deleted AND nullif(c.data->>'Candidate_Status__c', '') IS NOT NULL
     ORDER BY 1`);
  return result.rows.map((r) => String(r.s));
}
