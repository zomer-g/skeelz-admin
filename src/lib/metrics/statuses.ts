import { sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { getDb } from "@/lib/db/client";
import { EMPLOYER_RESPONSE_STATUSES, normStatus, RECORD_TYPES, STATUS, type ApplicationFacts, type Basis } from "./candidates";

/**
 * Applications by status: where each one stands now, and which statuses they moved into in a
 * range. A status is entered when the application is created (its first status) and on every
 * change in the status history (CaseHistory, kept since 13.3.2025). Statuses are compared after
 * normStatus, as everywhere.
 */

export interface StatusEvent {
  at: Date;
  status: string;
}

/** Status changes per application, oldest first, with the status it was created in as `initial`. */
export interface StatusHistory {
  initial: string | null;
  changes: StatusEvent[];
}

type Row = Record<string, unknown>;

/** Cached briefly (lib/cache.ts). */
export function loadStatusHistories(): Promise<Map<string, StatusHistory>> {
  return cached("status-histories", async () => {
    const rows = (
      await getDb().execute<Row>(sql`
        SELECT h.case_id, h.old_value, h.new_value, h.created_date
          FROM sf_case_history h
          JOIN sf_case a ON a.id = h.case_id
          JOIN sf_record_type rt ON rt.id = a.record_type_id
         WHERE h.field = 'Status' AND NOT a.is_deleted
           AND rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
         ORDER BY h.case_id, h.created_date, h.id`)
    ).rows;
    const out = new Map<string, StatusHistory>();
    for (const r of rows) {
      const id = String(r.case_id);
      let h = out.get(id);
      if (!h) {
        h = { initial: normStatus(r.old_value == null ? null : String(r.old_value)), changes: [] };
        out.set(id, h);
      }
      const status = normStatus(r.new_value == null ? null : String(r.new_value));
      const at = r.created_date instanceof Date ? r.created_date : new Date(String(r.created_date));
      if (status) h.changes.push({ at, status });
    }
    return out;
  });
}

/** Every status the application was in, with when it entered it; the first is its creation. */
export function statusEvents(f: ApplicationFacts, h: StatusHistory | undefined): StatusEvent[] {
  const first = h?.initial ?? (h?.changes.length ? null : f.status) ?? STATUS.new;
  return [{ at: f.createdAt, status: first }, ...(h?.changes ?? [])];
}

export interface StatusRow {
  status: string;
  /** Applications in this status now (all of them, with the page's filters). */
  now: number;
  /** In the range: applications that moved into it (event basis), or of those created in it, how many passed through it (application basis). */
  entered: number;
  /** Application basis: of those created in the range, how many are in it now. */
  nowOfCohort: number;
}

/** Pipeline order for the statuses the dashboard knows; the rest follow by size. */
const ORDER = [
  STATUS.new,
  STATUS.requestedCv,
  STATUS.inHandling,
  STATUS.sent,
  ...EMPLOYER_RESPONSE_STATUSES.filter((s) => s !== STATUS.accepted),
  STATUS.accepted,
  STATUS.rejectedByUs,
];

export function statusSummary(
  facts: ApplicationFacts[],
  histories: Map<string, StatusHistory>,
  { basis, from, to }: { basis: Basis; from: Date; to: Date },
): StatusRow[] {
  const inRange = (d: Date) => d >= from && d < to;
  const rows = new Map<string, StatusRow>();
  const row = (status: string) => {
    let r = rows.get(status);
    if (!r) rows.set(status, (r = { status, now: 0, entered: 0, nowOfCohort: 0 }));
    return r;
  };
  for (const f of facts) {
    const current = f.status ?? "ללא סטטוס";
    row(current).now++;
    const events = statusEvents(f, histories.get(f.id));
    if (basis === "event") {
      for (const s of new Set(events.filter((e) => inRange(e.at)).map((e) => e.status))) row(s).entered++;
    } else if (inRange(f.createdAt)) {
      for (const s of new Set(events.map((e) => e.status))) row(s).entered++;
      row(current).nowOfCohort++;
    }
  }
  const rank = (s: string) => {
    const i = ORDER.indexOf(s);
    return i === -1 ? ORDER.length : i;
  };
  return [...rows.values()].sort((a, b) => rank(a.status) - rank(b.status) || b.now + b.entered - (a.now + a.entered));
}
