import { and, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { applicationCounts, jobJson, metricsSummary } from "@/lib/api/data";
import { API_LIMITS } from "@/lib/api/spec";
import { hasRole, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { envAdmins } from "@/lib/auth/session";
import { linkCampaignJob, MAX_LABEL, saveCampaignSettings, unlinkCampaignJob } from "@/lib/campaigns/edit";
import { addDays, israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { accessRequests, auditLog, invites, syncRuns, syncState, users } from "@/lib/db/schema";
import { loadCaseTimeline } from "@/lib/entities/activity";
import { loadApplication, searchApplications } from "@/lib/entities/applications";
import { loadCandidate, searchCandidates } from "@/lib/entities/candidates";
import { loadCompany, loadJobDetails, searchCompanies } from "@/lib/entities/companies";
import { casePath, loadEmailCases, loadEmailContacts, normEmail } from "@/lib/entities/emails";
import { loadPayments } from "@/lib/entities/payments";
import { loadCampaignSettings, loadCampaignSummaries, loadLinkedJobIds } from "@/lib/metrics/campaigns";
import { filterPositions, loadPosition, loadPositions } from "@/lib/metrics/jobs";
import { ArgError, inputSchema, type ArgValue, type Fields } from "./args";
import type { McpPrincipal } from "./oauth";

/**
 * The MCP tools (docs/mcp.md §3). Each one names the lowest site role that may use it, the
 * same role the matching screen or action asks for: a viewer gets the dashboards and records,
 * an editor also edits campaign settings, an admin also sees users, the activity log and sync.
 * tools/list shows a connection only the tools its role allows, and tools/call checks again.
 */

export interface ToolContext {
  principal: McpPrincipal;
  /** The site's public origin, for links back to the screens. */
  origin: string;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  minRole: Role;
  /** Changes data (editor/admin actions); every other tool only reads. */
  writes?: boolean;
  /** Loads every application or job: counted against a tighter per-person limit. */
  heavy?: boolean;
  fields: Fields;
  required?: readonly string[];
  run: (a: Record<string, ArgValue>, ctx: ToolContext) => Promise<unknown>;
}

/* ---------------------------------------------------------------- helpers */

const s = (v: ArgValue) => (typeof v === "string" ? v : "");
const n = (v: ArgValue, fallback: number) => (typeof v === "number" ? v : fallback);
const link = (ctx: ToolContext, path: string) => `${ctx.origin}${path}`;

class NotFound extends ArgError {}

const sfIdField = (what: string): Fields[string] => ({ type: "string", description: `Salesforce id of the ${what} (15 or 18 characters).`, pattern: /^[a-zA-Z0-9]{15,18}$/ });
const dayField = (what: string): Fields[string] => ({ type: "string", format: "date", description: `${what}, YYYY-MM-DD (Israel time, inclusive).` });
const pageFields: Fields = {
  page: { type: "integer", description: "Page number, from 1.", minimum: 1, maximum: 1000, default: 1 },
  page_size: { type: "integer", description: "Rows per page.", minimum: 1, maximum: 50, default: 20 },
};
const paging = (a: Record<string, ArgValue>) => ({ page: n(a.page, 1), pageSize: n(a.page_size, 20) });

function dayRange(a: Record<string, ArgValue>, defaultDays: number): { fromDay: string; toDay: string } {
  const toDay = s(a.to) || israelDay();
  const fromDay = s(a.from) || addDays(toDay, -(defaultDays - 1));
  if (fromDay > toDay) throw new ArgError("from must not be after to");
  if ((Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000 + 1 > API_LIMITS.maxRangeDays) {
    throw new ArgError(`the range may span at most ${API_LIMITS.maxRangeDays} days`);
  }
  return { fromDay, toDay };
}

const scopeField: Fields[string] = {
  type: "string",
  enum: ["paid", "all"],
  description: "paid (default) = paid jobs and the applications to them only, as the dashboard shows by default; all = every job.",
};

/* ------------------------------------------------------------------ tools */

const TOOLS: Tool[] = [
  {
    name: "whoami",
    title: "Who am I",
    description: "Your account, the role this connection works with, and the tools that role allows. The role follows your role on the site and changes with it.",
    minRole: "viewer",
    fields: {},
    run: async (_a, { principal: p }) => ({
      email: p.person.email,
      name: p.person.name,
      role: p.role,
      role_label: ROLE_LABELS[p.role],
      site_role: p.person.siteRole,
      connection_max_role: p.maxRole,
      client: p.clientName,
      tools: toolsFor(p.role).map((t) => t.name),
    }),
  },

  /* ---------------------------------------------------------- dashboards */
  {
    name: "dashboard_summary",
    title: "Dashboard summary",
    description:
      "The applications funnel and site totals for a date range (default: the last 30 days): new and active jobs, applications by stage (received, CV requested/received, sent to employer, employer responded, interviews, accepted, rejected), median handling times, reject reasons, site sessions and job events. Aggregates only.",
    minRole: "viewer",
    heavy: true,
    fields: {
      from: dayField("First day"),
      to: dayField("Last day (default: today)"),
      scope: scopeField,
      basis: {
        type: "string",
        enum: ["application", "event"],
        description: "application (default) = applications created in the range and how far they got; event = stage events that happened in the range.",
      },
    },
    run: async (a) => {
      const { fromDay, toDay } = dayRange(a, 30);
      return metricsSummary(fromDay, toDay, s(a.scope) === "all" ? "all" : "paid", s(a.basis) === "event" ? "event" : "application");
    },
  },
  {
    name: "list_campaigns",
    title: "Campaigns",
    description: "Marketing campaigns (UTM) with sessions in a date range (default: the last 30 days): sessions, new users, job opens, apply clicks and confirmations, SMOOV id and linked jobs.",
    minRole: "viewer",
    heavy: true,
    fields: { from: dayField("First day"), to: dayField("Last day (default: today)") },
    run: async (a, ctx) => {
      const { fromDay, toDay } = dayRange(a, 30);
      const rows = await loadCampaignSummaries(fromDay, toDay);
      return { range: { from: fromDay, to: toDay }, campaigns: rows.map((c) => ({ ...c, url: link(ctx, `/campaigns/${encodeURIComponent(c.key)}`) })) };
    },
  },

  /* ---------------------------------------------------------------- jobs */
  {
    name: "search_jobs",
    title: "Search jobs",
    description:
      "Jobs (Salesforce Position cases), newest first. Free text matches the title, company, case number or site job id. Each job has paid, active and marked: marked is the site's crown / featured mark (isMarked_cambium in Salesforce). The filters combine (AND), and total counts the jobs that match all of them.",
    minRole: "viewer",
    fields: {
      q: { type: "string", description: "Free text.", maxLength: 100 },
      active_only: { type: "boolean", description: "Only jobs live on the site now, PStatus = Active (default true).", default: true },
      paid_only: { type: "boolean", description: "Only paid jobs (default false).", default: false },
      marked_only: { type: "boolean", description: "Only jobs with the site's crown / featured mark, isMarked_cambium (default false).", default: false },
      ...pageFields,
    },
    run: async (a, ctx) => {
      const all = filterPositions(await loadPositions(), {
        q: s(a.q),
        activeOnly: a.active_only === true,
        paidOnly: a.paid_only === true,
        markedOnly: a.marked_only === true,
      });
      const { page, pageSize } = paging(a);
      return {
        total: all.length,
        page,
        jobs: all.slice((page - 1) * pageSize, page * pageSize).map((p) => ({ ...jobJson(p), admin_url: link(ctx, `/positions/${p.id}`) })),
      };
    },
  },
  {
    name: "get_job",
    title: "Job details",
    description:
      "One job with every field of its Salesforce card: title, site status, paid flags (isSponserd_cambium, משרה בתשלום), marked (the site's crown / featured mark, isMarked_cambium), company and Account, company size, scope, city and district, the site contact and the Case contact, owner, tests (בדיקות), zohar (משרה של זהר), follow-up date, self-apply, site created/updated dates, case age in days, link, description and internal comments — and its applications counted by status.",
    minRole: "viewer",
    fields: { id: sfIdField("job") },
    required: ["id"],
    run: async (a, ctx) => {
      const id = s(a.id);
      const [position, details, applications] = await Promise.all([loadPosition(id), loadJobDetails(id), applicationCounts(id)]);
      if (!position) throw new NotFound("no job with this id");
      return { ...jobJson(position), details, applications, admin_url: link(ctx, `/positions/${id}`), analytics_url: link(ctx, `/jobs/${id}`) };
    },
  },

  /* -------------------------------------------------------- applications */
  {
    name: "search_applications",
    title: "Search applications",
    description: "Applications to jobs, newest first, with the candidate, job, company, status and owner. Free text matches candidate name, email, phone or case number.",
    minRole: "viewer",
    fields: {
      q: { type: "string", description: "Free text.", maxLength: 100 },
      status: { type: "string", description: "Exact current status, in Hebrew as in Salesforce (e.g. התקבל).", maxLength: 100 },
      paid: { type: "string", enum: ["paid", "unpaid"], description: "Paid or unpaid applications only." },
      owner: { type: "string", description: "Owner's full name, as in Salesforce.", maxLength: 100 },
      job_id: sfIdField("job"),
      candidate_id: sfIdField("candidate (Contact)"),
      company_key: { type: "string", description: "A company key from search_companies.", maxLength: 300 },
      from: dayField("Created on or after"),
      to: dayField("Created on or before"),
      ...pageFields,
    },
    run: async (a, ctx) => {
      const { page, pageSize } = paging(a);
      const result = await searchApplications(
        {
          q: s(a.q),
          status: s(a.status),
          paid: (s(a.paid) as "paid" | "unpaid" | "") || "",
          owner: s(a.owner),
          fromDay: s(a.from),
          toDay: s(a.to),
          jobId: s(a.job_id) || undefined,
          contactId: s(a.candidate_id) || undefined,
          companyKey: s(a.company_key) || undefined,
        },
        { page, pageSize },
      );
      return { total: result.total, page, applications: result.rows.map((r) => ({ ...r, admin_url: link(ctx, `/applications/${r.id}`) })) };
    },
  },
  {
    name: "get_application",
    title: "Application details",
    description:
      "One application with every field of its Salesforce card — candidate and contact details, job and parent case, owner, status, placement status (סטטוס השמה), mismatch reasons (חוסר התאמה), fast apply, paid-application flag, zohar (משרה של זהר), follow-up, record type, Account, type/origin/reason/priority, web email, created/modified by, case age in days, and the placement finance fields (start date, placement date, salary %, collection before VAT, commission, invoice and payment dates, project and candidate status) — with its timeline: status and owner changes, emails (metadata only) and logged calls and tasks.",
    minRole: "viewer",
    fields: { id: sfIdField("application") },
    required: ["id"],
    run: async (a, ctx) => {
      const id = s(a.id);
      const application = await loadApplication(id);
      if (!application) throw new NotFound("no application with this id");
      return { ...application, timeline: await loadCaseTimeline(id), admin_url: link(ctx, `/applications/${id}`) };
    },
  },

  /* ---------------------------------------------------------- candidates */
  {
    name: "search_candidates",
    title: "Search candidates",
    description: "Candidates (Salesforce Contacts), most recently active first. Free text matches name, email or phone.",
    minRole: "viewer",
    fields: {
      q: { type: "string", description: "Free text.", maxLength: 100 },
      district: { type: "string", description: "District, exactly as in Salesforce.", maxLength: 100 },
      city: { type: "string", description: "City (contains).", maxLength: 100 },
      cv: { type: "string", enum: ["yes", "no"], description: "Has a CV or not." },
      applied: { type: "string", enum: ["yes", "no"], description: "Has applied to a job or not." },
      from: dayField("Created on or after"),
      to: dayField("Created on or before"),
      ...pageFields,
    },
    run: async (a, ctx) => {
      const { page, pageSize } = paging(a);
      const result = await searchCandidates(
        {
          q: s(a.q),
          district: s(a.district),
          city: s(a.city),
          account: "",
          cv: (s(a.cv) as "yes" | "no" | "") || "",
          applied: (s(a.applied) as "yes" | "no" | "") || "",
          fromDay: s(a.from),
          toDay: s(a.to),
        },
        { page, pageSize },
      );
      return { total: result.total, page, candidates: result.rows.map((r) => ({ ...r, admin_url: link(ctx, `/candidates/${r.id}`) })) };
    },
  },
  {
    name: "get_candidate",
    title: "Candidate details",
    description: "One candidate's profile and skills, and their latest applications. Files (CVs) are not available here; open them on the site.",
    minRole: "viewer",
    fields: { id: sfIdField("candidate (Contact)") },
    required: ["id"],
    run: async (a, ctx) => {
      const id = s(a.id);
      const candidate = await loadCandidate(id);
      if (!candidate) throw new NotFound("no candidate with this id");
      const apps = await searchApplications({ q: "", status: "", paid: "", owner: "", fromDay: "", toDay: "", contactId: id }, { pageSize: 50 });
      return { ...candidate, applications: apps.rows, applications_total: apps.total, admin_url: link(ctx, `/candidates/${id}`) };
    },
  },
  {
    name: "lookup_email",
    title: "Person by email",
    description: "Everything on one email address: every Contact with it and every case on them (applications, leads, jobs…), newest first.",
    minRole: "viewer",
    fields: { email: { type: "string", description: "The email address.", maxLength: 254 } },
    required: ["email"],
    run: async (a, ctx) => {
      const email = normEmail(s(a.email));
      if (!email) throw new ArgError("email is not a valid address");
      const [contacts, { cases, total }] = await Promise.all([loadEmailContacts(email), loadEmailCases(email)]);
      return {
        email,
        contacts,
        cases_total: total,
        cases: cases.slice(0, 100).map((c) => {
          const path = casePath(c);
          return { ...c, admin_url: path ? link(ctx, path) : null };
        }),
        admin_url: link(ctx, `/emails/${encodeURIComponent(email)}`),
      };
    },
  },

  /* ----------------------------------------------------------- companies */
  {
    name: "search_companies",
    title: "Search companies",
    description:
      "Employers: jobs grouped by company name, with job, paid-job and marked-job counts (markedJobs / markedActiveJobs: jobs with the site's crown / featured mark, isMarked_cambium), application counts and the main contact.",
    minRole: "viewer",
    fields: {
      q: { type: "string", description: "Free text: company or contact name, email or phone.", maxLength: 100 },
      include_inactive: { type: "boolean", description: "Include companies with no live job (default false).", default: false },
      paid_only: { type: "boolean", description: "Only companies with paid jobs (default false).", default: false },
      location: { type: "string", description: "Job location (contains).", maxLength: 100 },
      sort: { type: "string", enum: ["active", "recent", "applications", "name"], description: "Order (default active)." },
      ...pageFields,
    },
    run: async (a, ctx) => {
      const { page, pageSize } = paging(a);
      const result = await searchCompanies(
        {
          q: s(a.q),
          all: a.include_inactive === true,
          paid: a.paid_only ? "paid" : "",
          location: s(a.location),
          sort: (s(a.sort) as "active" | "recent" | "applications" | "name" | "") || "",
        },
        { page, pageSize },
      );
      return { total: result.total, page, companies: result.rows.map((c) => ({ ...c, admin_url: link(ctx, `/companies/${encodeURIComponent(c.key)}`) })) };
    },
  },
  {
    name: "get_company",
    title: "Company details",
    description: "One company and all its jobs, live first, with applications per job.",
    minRole: "viewer",
    fields: { key: { type: "string", description: "The company key from search_companies.", maxLength: 300 } },
    required: ["key"],
    run: async (a, ctx) => {
      const company = await loadCompany(s(a.key));
      if (!company) throw new NotFound("no company with this key");
      return { ...company, admin_url: link(ctx, `/companies/${encodeURIComponent(s(a.key))}`) };
    },
  },

  /* ------------------------------------------------------------ payments */
  {
    name: "search_payments",
    title: "Payments",
    description: "The Salesforce payments-tracking list (placements to invoice): candidate, company, start date, invoice and payment dates, collection and commission, paid or not.",
    minRole: "viewer",
    fields: {
      q: { type: "string", description: "Free text: candidate, company or case number.", maxLength: 100 },
      paid: { type: "string", enum: ["yes", "no"], description: "Paid or unpaid only." },
      candidate_status: { type: "string", description: "Candidate status, exactly as in Salesforce.", maxLength: 100 },
      ...pageFields,
    },
    run: async (a) => {
      const rows = await loadPayments({ q: s(a.q), paid: (s(a.paid) as "yes" | "no" | "") || "", candidateStatus: s(a.candidate_status) });
      const { page, pageSize } = paging(a);
      return { total: rows.length, page, payments: rows.slice((page - 1) * pageSize, page * pageSize) };
    },
  },

  /* ------------------------------------------------------ editor: campaigns */
  {
    name: "update_campaign",
    title: "Edit campaign details",
    description: "Set a campaign's display name, SMOOV campaign id and/or send day (dashboard configuration). Fields left out keep their current value.",
    minRole: "editor",
    writes: true,
    fields: {
      key: { type: "string", description: "The UTM campaign name, from list_campaigns.", maxLength: 500 },
      label: { type: "string", description: "Display name.", maxLength: MAX_LABEL },
      smoov_campaign_id: { type: "integer", description: "SMOOV campaign id.", minimum: 1, maximum: 2_147_483_647 },
      send_day: dayField("Send day, overriding the detected one"),
    },
    required: ["key"],
    run: async (a, ctx) => {
      if (a.label === undefined && a.smoov_campaign_id === undefined && a.send_day === undefined) throw new ArgError("nothing to change");
      const current = await loadCampaignSettings(s(a.key));
      const smoov = a.smoov_campaign_id ?? current?.smoovCampaignId;
      const result = await saveCampaignSettings(ctx.principal.person.email, {
        key: s(a.key),
        label: s(a.label) || current?.label || null,
        smoov: smoov == null ? "" : String(smoov),
        sendDay: s(a.send_day) || current?.sendDay || "",
      });
      if (!result.ok) throw new ArgError(result.message);
      return { ok: true, key: s(a.key), url: link(ctx, `/campaigns/${encodeURIComponent(s(a.key))}`) };
    },
  },
  {
    name: "link_campaign_job",
    title: "Link a job to a campaign",
    description: "Record that a campaign promoted a job, so the campaign page measures its impact on that job.",
    minRole: "editor",
    writes: true,
    fields: { key: { type: "string", description: "The UTM campaign name.", maxLength: 500 }, job_id: sfIdField("job") },
    required: ["key", "job_id"],
    run: async (a, ctx) => {
      const result = await linkCampaignJob(ctx.principal.person.email, s(a.key), s(a.job_id));
      if (!result.ok) throw new ArgError(result.message);
      return { ok: true, linked_jobs: await loadLinkedJobIds(s(a.key)) };
    },
  },
  {
    name: "unlink_campaign_job",
    title: "Unlink a job from a campaign",
    description: "Remove a job from a campaign's linked jobs.",
    minRole: "editor",
    writes: true,
    fields: { key: { type: "string", description: "The UTM campaign name.", maxLength: 500 }, job_id: sfIdField("job") },
    required: ["key", "job_id"],
    run: async (a, ctx) => {
      const result = await unlinkCampaignJob(ctx.principal.person.email, s(a.key), s(a.job_id));
      if (!result.ok) throw new ArgError(result.message);
      return { ok: true, linked_jobs: await loadLinkedJobIds(s(a.key)) };
    },
  },

  /* ------------------------------------------------------------- admin */
  {
    name: "list_users",
    title: "Users and access",
    description: "Who may sign in to the platform and with which role, open invitations, and refused sign-ins waiting for approval.",
    minRole: "admin",
    fields: {},
    run: async () => {
      const db = getDb();
      const admins = envAdmins();
      const [userRows, inviteRows, requestRows] = await Promise.all([
        db.select().from(users).orderBy(desc(users.lastLoginAt)),
        db
          .select()
          .from(invites)
          .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
          .orderBy(desc(invites.createdAt)),
        db.select().from(accessRequests).orderBy(desc(accessRequests.lastAt)).limit(100),
      ]);
      return {
        users: userRows.map((u) => ({
          email: u.email,
          name: u.name,
          role: admins.includes(u.email) ? "admin" : u.role,
          active: u.active || admins.includes(u.email),
          admin_by_configuration: admins.includes(u.email),
          last_login_at: u.lastLoginAt,
          created_at: u.createdAt,
        })),
        open_invites: inviteRows.map((i) => ({ email: i.email, role: i.role, invited_by: i.invitedBy, expires_at: i.expiresAt })),
        access_requests: requestRows.map((r) => ({ email: r.email, name: r.name, attempts: r.attempts, last_at: r.lastAt })),
      };
    },
  },
  {
    name: "query_audit_log",
    title: "Activity log",
    description: "The platform's activity log, newest first: sign-ins, screens opened, permission changes, API and MCP use, manual operations.",
    minRole: "admin",
    fields: {
      actor: { type: "string", description: "Who (email, or api:inbound).", maxLength: 254 },
      action: { type: "string", description: "Action prefix, e.g. page.view, user., mcp.", maxLength: 100 },
      since: dayField("From"),
      limit: { type: "integer", description: "Rows (default 50).", minimum: 1, maximum: 200, default: 50 },
    },
    run: async (a) => {
      const parts: SQL[] = [];
      if (s(a.actor)) parts.push(eq(auditLog.actor, s(a.actor).toLowerCase()));
      if (s(a.action)) parts.push(sql`starts_with(${auditLog.action}, ${s(a.action)})`);
      if (s(a.since)) parts.push(gt(auditLog.at, new Date(`${s(a.since)}T00:00:00+03:00`)));
      const rows = await getDb()
        .select()
        .from(auditLog)
        .where(parts.length ? and(...parts) : undefined)
        .orderBy(desc(auditLog.at))
        .limit(n(a.limit, 50));
      return { entries: rows };
    },
  },
  {
    name: "sync_status",
    title: "Sync status",
    description: "When each Salesforce / Google Analytics / SMOOV object last synced, any error, and the latest sync runs.",
    minRole: "admin",
    fields: {},
    run: async () => {
      const db = getDb();
      const [state, runs] = await Promise.all([
        db.select().from(syncState).orderBy(syncState.object),
        db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(20),
      ]);
      return { objects: state, recent_runs: runs };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tools a role may use, in catalogue order. */
export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => hasRole(role, t.minRole));
}

/** Every tool with the role it needs, for the docs and the connect page. */
export const TOOL_CATALOGUE = TOOLS.map((t) => ({ name: t.name, title: t.title, minRole: t.minRole, writes: Boolean(t.writes) }));

/** A tool as tools/list describes it. */
export function describeTool(t: Tool) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t.fields, t.required),
    annotations: { title: t.title, readOnlyHint: !t.writes, destructiveHint: false, idempotentHint: !t.writes, openWorldHint: false },
  };
}

export type ToolLookup = { ok: true; tool: Tool } | { ok: false; reason: "unknown" | "forbidden"; required?: Role };

export function findTool(name: string, role: Role): ToolLookup {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, reason: "unknown" };
  if (!hasRole(role, tool.minRole)) return { ok: false, reason: "forbidden", required: tool.minRole };
  return { ok: true, tool };
}

export { NotFound };
export type { Tool };
