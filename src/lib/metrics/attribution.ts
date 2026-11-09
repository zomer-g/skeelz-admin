import { inArray, sql } from "drizzle-orm";
import { addDays, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { applicationSource } from "@/lib/db/schema";
import { RECORD_TYPES, type ApplicationFacts } from "./candidates";
import { applicationFunnel, APPLIED_EVENTS_SINCE, JOB_EVENTS, type ApplicationFunnel } from "./jobs";

/**
 * Where each site application came from.
 *
 * Google Analytics knows the session's source, medium, campaign, channel and the device of every
 * accepted application (job_application_registered / job_application_guest), but its API returns
 * sums, not single events. Salesforce knows the application, its job and when it was created, but
 * not where the candidate came from. The two meet on what both have: the job, the applicant type
 * (a guest application is `fast_applied__c` in Salesforce) and the time — the site creates the Case
 * and only then shows "המשרה הוגשה", so the event lands within seconds of the Case's CreatedDate.
 *
 * GA is read per minute (`dateHourMinute`, ga_application_minute), and each Salesforce application
 * takes the nearest unused event of its job and type within MAX_DISTANCE_S. With about a dozen
 * applications a day, two to the same job in the same minute are rare; when another event with
 * different attributes was a candidate too, the match is marked ambiguous.
 *
 * An application with no match had no event: measurement blocked in the browser (ad blockers,
 * cookies declined), or a Case created outside the site.
 */

export type ApplicantType = "registered" | "guest";

export interface SourceAttrs {
  source: string;
  medium: string;
  campaign: string;
  channelGroup: string;
  deviceCategory: string;
}

export interface GaApplyRow extends SourceAttrs {
  /** The GA minute's start, UTC. */
  minute: Date;
  key: string | null;
  type: ApplicantType;
  count: number;
}

export interface SiteApplication {
  id: string;
  key: string | null;
  type: ApplicantType;
  createdAt: Date;
}

export interface SourceMatch extends SourceAttrs {
  caseId: string;
  applicantType: ApplicantType;
  minute: Date;
  deltaSeconds: number;
  ambiguous: boolean;
}

/** Drops the invisible direction marks ad platforms put in UTM values (Facebook campaigns start with two). */
export const stripMarks = (v: string) => v.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();

/** How far the middle of a GA minute may be from the Case's creation: the minute before or after it. */
export const MAX_DISTANCE_S = 90;

/** The GA property's time zone: `dateHourMinute` is in it. */
export const GA_TIME_ZONE = "Asia/Jerusalem";

export const eventType = (eventName: string): ApplicantType | null =>
  eventName === JOB_EVENTS.appliedRegistered ? "registered" : eventName === JOB_EVENTS.appliedGuest ? "guest" : null;

const sameAttrs = (a: SourceAttrs, b: SourceAttrs) =>
  a.source === b.source && a.medium === b.medium && a.campaign === b.campaign && a.channelGroup === b.channelGroup && a.deviceCategory === b.deviceCategory;

/** Minutes east of UTC that `zone` is at this instant. */
function zoneOffsetMinutes(at: Date, zone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** GA's "202611091235" (property time) → the UTC instant that minute starts. */
export function gaMinuteToUtc(value: string, zone = GA_TIME_ZONE): Date {
  const [y, mo, d, h, mi] = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12)].map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset around a DST change.
  let utc = wall - zoneOffsetMinutes(new Date(wall), zone) * 60_000;
  utc = wall - zoneOffsetMinutes(new Date(utc), zone) * 60_000;
  return new Date(utc);
}

/**
 * Each application to the nearest unused event of its job and type. Closest pairs are settled first,
 * so a near event is never taken by an application it is farther from.
 */
export function matchApplications(apps: SiteApplication[], rows: GaApplyRow[]): SourceMatch[] {
  const left = rows.map((r) => r.count);
  const byKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!r.key) return;
    const k = `${r.key}|${r.type}`;
    const list = byKey.get(k);
    if (list) list.push(i);
    else byKey.set(k, [i]);
  });

  const pairs: { app: number; row: number; distance: number }[] = [];
  const candidates = new Map<number, number[]>();
  apps.forEach((a, ai) => {
    if (!a.key) return;
    for (const ri of byKey.get(`${a.key}|${a.type}`) ?? []) {
      const middle = rows[ri]!.minute.getTime() + 30_000;
      const distance = Math.abs(middle - a.createdAt.getTime()) / 1000;
      if (distance > MAX_DISTANCE_S) continue;
      pairs.push({ app: ai, row: ri, distance });
      candidates.set(ai, [...(candidates.get(ai) ?? []), ri]);
    }
  });
  pairs.sort((x, y) => x.distance - y.distance || apps[x.app]!.createdAt.getTime() - apps[y.app]!.createdAt.getTime());

  const done = new Set<number>();
  const out: SourceMatch[] = [];
  for (const p of pairs) {
    if (done.has(p.app) || left[p.row]! <= 0) continue;
    done.add(p.app);
    left[p.row]!--;
    const app = apps[p.app]!;
    const row = rows[p.row]!;
    out.push({
      caseId: app.id,
      applicantType: app.type,
      minute: row.minute,
      deltaSeconds: Math.round((row.minute.getTime() + 30_000 - app.createdAt.getTime()) / 1000),
      source: row.source,
      medium: row.medium,
      campaign: row.campaign,
      channelGroup: row.channelGroup,
      deviceCategory: row.deviceCategory,
      ambiguous: (candidates.get(p.app) ?? []).some((ri) => !sameAttrs(rows[ri]!, row)),
    });
  }
  return out;
}

type Row = Record<string, unknown>;
const run = async <T extends Row>(query: ReturnType<typeof sql>) => (await getDb().execute<T>(query)).rows as T[];

/** Re-match every site application since the events exist, and replace application_source. */
export async function rebuildApplicationSources(): Promise<{ applications: number; matched: number; ambiguous: number }> {
  const since = new Date(`${APPLIED_EVENTS_SINCE}T00:00:00Z`);
  const [gaRows, appRows] = await Promise.all([
    run(sql`
      SELECT minute, event_name, site_job_key, source, medium, campaign, channel_group, device_category, event_count
        FROM ga_application_minute WHERE minute >= ${since}`),
    run(sql`
      SELECT a.id, a.site_job_key, coalesce(a.data->>'fast_applied__c', 'false') = 'true' AS fast, a.created_date
        FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
       WHERE rt.developer_name = ${RECORD_TYPES.application} AND NOT a.is_deleted AND a.created_date >= ${since}`),
  ]);
  const rows: GaApplyRow[] = gaRows.flatMap((r) => {
    const type = eventType(String(r.event_name));
    return type
      ? [{
          minute: new Date(r.minute as string | Date),
          key: r.site_job_key ? String(r.site_job_key) : null,
          type,
          count: Number(r.event_count ?? 0),
          source: stripMarks(String(r.source)),
          medium: stripMarks(String(r.medium)),
          campaign: stripMarks(String(r.campaign)),
          channelGroup: String(r.channel_group),
          deviceCategory: String(r.device_category),
        }]
      : [];
  });
  const apps: SiteApplication[] = appRows.map((r) => ({
    id: String(r.id),
    key: r.site_job_key ? String(r.site_job_key) : null,
    type: r.fast === true ? "guest" : "registered",
    createdAt: new Date(r.created_date as string | Date),
  }));
  const matches = matchApplications(apps, rows);

  await getDb().transaction(async (tx) => {
    await tx.delete(applicationSource);
    for (let i = 0; i < matches.length; i += 500) await tx.insert(applicationSource).values(matches.slice(i, i + 500));
  });
  return { applications: apps.length, matched: matches.length, ambiguous: matches.filter((m) => m.ambiguous).length };
}

/* ---------------------------------------------------------------- reading */

export const SOURCE_DIMENSIONS = {
  channel: "ערוץ",
  source: "מקור / מדיום",
  campaign: "קמפיין",
  device: "מכשיר",
  type: "סוג מועמד",
} as const;
export type SourceDimension = keyof typeof SOURCE_DIMENSIONS;

export const DEVICE_LABELS: Record<string, string> = { mobile: "נייד", desktop: "מחשב", tablet: "טאבלט", "smart tv": "טלוויזיה" };
export const APPLICANT_LABELS: Record<ApplicantType, string> = { registered: "רשום", guest: "מזדמן" };

export interface StoredSource extends SourceAttrs {
  applicantType: ApplicantType;
  ambiguous: boolean;
}

export async function loadApplicationSources(): Promise<Map<string, StoredSource>> {
  const rows = await getDb().select().from(applicationSource);
  return new Map(
    rows.map((r) => [
      r.caseId,
      {
        applicantType: r.applicantType as ApplicantType,
        ambiguous: r.ambiguous,
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        channelGroup: r.channelGroup,
        deviceCategory: r.deviceCategory,
      },
    ]),
  );
}

/** The group an application falls in; null = no GA event matched it. */
export function sourceGroup(s: StoredSource | undefined, by: SourceDimension, fast: boolean): string | null {
  if (by === "type") return fast ? "guest" : "registered";
  if (!s) return null;
  if (by === "channel") return s.channelGroup;
  if (by === "source") return `${stripMarks(s.source)} / ${stripMarks(s.medium)}`;
  if (by === "campaign") return stripMarks(s.campaign);
  return s.deviceCategory;
}

export interface SourceFunnelRow {
  /** null = applications no GA event matched. */
  group: string | null;
  funnel: ApplicationFunnel;
  ambiguous: number;
}

/**
 * Site applications (RecordType2) created in [from, to) and since the events exist, by source, with
 * the stages each reached whenever it reached them.
 */
export function buildSourceFunnel(
  facts: ApplicationFacts[],
  sources: Map<string, StoredSource>,
  by: SourceDimension,
  from: Date,
  to: Date,
  paidOnly: boolean,
): { rows: SourceFunnelRow[]; total: number; matched: number } {
  const since = new Date(`${APPLIED_EVENTS_SINCE}T00:00:00Z`);
  const start = from > since ? from : since;
  const apps = facts.filter((f) => f.recordType === RECORD_TYPES.application && f.createdAt >= start && f.createdAt < to && (!paidOnly || f.paid));
  const groups = new Map<string | null, ApplicationFacts[]>();
  for (const f of apps) {
    const g = sourceGroup(sources.get(f.id), by, f.fast);
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const rows = [...groups.entries()]
    .map(([group, list]) => ({ group, funnel: applicationFunnel(list), ambiguous: list.filter((f) => sources.get(f.id)?.ambiguous).length }))
    .sort((a, b) => (a.group === null ? 1 : b.group === null ? -1 : b.funnel.applications - a.funnel.applications));
  return { rows, total: apps.length, matched: apps.filter((f) => sources.has(f.id)).length };
}

/** The sources of these applications only (the API and MCP read a page of applications at a time). */
export async function loadSourcesFor(ids: string[]): Promise<Map<string, StoredSource>> {
  if (!ids.length) return new Map();
  const rows = await getDb().select().from(applicationSource).where(inArray(applicationSource.caseId, ids));
  return new Map(
    rows.map((r) => [
      r.caseId,
      {
        applicantType: r.applicantType as ApplicantType,
        ambiguous: r.ambiguous,
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        channelGroup: r.channelGroup,
        deviceCategory: r.deviceCategory,
      },
    ]),
  );
}

/**
 * An application's site source as the API and MCP give it: null when GA has no matching event
 * (measurement blocked, created outside the site, or before 9.11.2026). No people, only GA's labels.
 */
export function siteSourceJson(s: StoredSource | undefined) {
  if (!s) return null;
  return {
    channel: s.channelGroup,
    source: stripMarks(s.source),
    medium: stripMarks(s.medium),
    campaign: stripMarks(s.campaign),
    device: s.deviceCategory,
    applicant_type: s.applicantType,
    ambiguous: s.ambiguous,
  };
}

/** The by-source funnel for a range of Israel days, in the shape the API and MCP return. */
export async function sourceFunnelJson(fromDay: string, toDay: string, scope: "paid" | "all", by: SourceDimension, facts: ApplicationFacts[]) {
  const from = israelMidnight(fromDay);
  const to = israelMidnight(addDays(toDay, 1));
  const { rows, total, matched } = buildSourceFunnel(facts, await loadApplicationSources(), by, from, to, scope === "paid");
  return {
    range: { from: fromDay, to: toDay, scope, by, measured_since: APPLIED_EVENTS_SINCE },
    total,
    matched,
    rows: rows.map((r) => ({
      group: r.group,
      applications: r.funnel.applications,
      requested_cv: r.funnel.requestedCv,
      cv_received: r.funnel.cvReceived,
      sent_to_employer: r.funnel.sent,
      employer_responded: r.funnel.responded,
      interviews: r.funnel.interview,
      accepted: r.funnel.accepted,
      ambiguous: r.ambiguous,
    })),
  };
}
