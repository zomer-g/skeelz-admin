import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  primaryKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { Role } from "@/lib/auth/roles";
import type { SchemaReport } from "@/lib/sf/schema-report";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ access */

/** People allowed into the platform. Emails are stored lowercased. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // Google subject from the xhostd token; bound on first sign-in.
    sub: text("sub").unique(),
    name: text("name"),
    picture: text("picture"),
    role: text("role").$type<Role>().notNull().default("viewer"),
    /**
     * מנהל עובדים: may see staff data (hours, activity per employee). Separate from the role on
     * purpose: admin does not include it, and only a staff manager can grant it (docs/staff.md).
     */
    staffManager: boolean("staff_manager").notNull().default(false),
    /** The person's Salesforce User, so their logged activity can be told apart. One site user per Salesforce user. */
    sfUserId: text("sf_user_id").unique(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [check("users_role_check", sql`${t.role} in ('viewer', 'editor', 'admin')`)],
);

/** An admin's invitation, redeemed when that email first signs in. */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    check("invites_role_check", sql`${t.role} in ('viewer', 'editor', 'admin')`),
    uniqueIndex("invites_open_email_idx").on(t.email).where(sql`accepted_at is null and revoked_at is null`),
  ],
);

/** Extra candidate files an admin let one user open on one Israel day, on top of the daily limit (lib/security/files.ts). */
export const fileQuotaGrants = pgTable(
  "file_quota_grants",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userEmail: text("user_email").notNull(),
    day: date("day").notNull(),
    extra: integer("extra").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [index("file_quota_grants_user_day_idx").on(t.userEmail, t.day)],
);

/**
 * An admin let a user hand over another batch of people's contact details today (the copy
 * buttons on /candidates and /cvs, and the MCP tools that list people) — lib/security/exports.ts.
 */
export const exportQuotaGrants = pgTable(
  "export_quota_grants",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userEmail: text("user_email").notNull(),
    day: date("day").notNull(),
    extra: integer("extra").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [index("export_quota_grants_user_day_idx").on(t.userEmail, t.day)],
);

/**
 * Alerts for the admins: a user opened many candidate files today, or reached the day's limit and
 * waits for more. One per kind, user, day and threshold; handled when an admin acts on it.
 */
export const securityAlerts = pgTable(
  "security_alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    userEmail: text("user_email").notNull(),
    day: date("day").notNull(),
    threshold: integer("threshold").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    handledAt: ts("handled_at"),
    handledBy: text("handled_by"),
  },
  (t) => [uniqueIndex("security_alerts_once_idx").on(t.kind, t.userEmail, t.day, t.threshold)],
);

/** An admin confirmed a user's access and role, as the monthly review requires (lib/security/reviews.ts). */
export const accessReviews = pgTable(
  "access_reviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    /** The staff-manager flag as it was confirmed; a change since makes the review due again. */
    staffManager: boolean("staff_manager").notNull().default(false),
    reviewedBy: text("reviewed_by").notNull(),
    reviewedAt: ts("reviewed_at").notNull().defaultNow(),
  },
  (t) => [index("access_reviews_user_idx").on(t.userId, t.reviewedAt)],
);

/** Sign-ins that were refused, so an admin can approve them with one click. */
export const accessRequests = pgTable("access_requests", {
  email: text("email").primaryKey(),
  name: text("name"),
  attempts: integer("attempts").notNull().default(1),
  firstAt: ts("first_at").notNull().defaultNow(),
  lastAt: ts("last_at").notNull().defaultNow(),
});

/** Sign-ins, permission changes and manual operations. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    details: jsonb("details"),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_actor_at_idx").on(t.actor, t.at),
    // Who opened each candidate file: read per file on /cvs and /cvs/[documentId].
    index("audit_log_file_idx")
      .on(sql`(${t.details}->>'documentId')`, t.at)
      .where(sql`${t.action} IN ('candidate.file_opened', 'candidate.file_rate_limited')`),
  ],
);

/* -------------------------------------------------------------- salesforce */

/*
 * Mirror tables. Each keeps the columns the dashboard filters and joins on as
 * typed columns, and the full record as `data` so a new metric never needs a
 * schema change first. Ids are Salesforce's 18-character ids.
 */
const sfId = (name: string) => varchar(name, { length: 18 });
const syncedAt = () => ts("synced_at").notNull().defaultNow();

export const sfRecordType = pgTable("sf_record_type", {
  id: sfId("id").primaryKey(),
  sobjectType: text("sobject_type").notNull(),
  developerName: text("developer_name").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull(),
  systemModstamp: ts("system_modstamp").notNull(),
  syncedAt: syncedAt(),
});

export const sfUser = pgTable("sf_user", {
  id: sfId("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  isActive: boolean("is_active").notNull(),
  systemModstamp: ts("system_modstamp").notNull(),
  syncedAt: syncedAt(),
});

export const sfAccount = pgTable("sf_account", {
  id: sfId("id").primaryKey(),
  name: text("name"),
  createdDate: ts("created_date"),
  systemModstamp: ts("system_modstamp").notNull(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  data: jsonb("data").notNull(),
  syncedAt: syncedAt(),
});

export const sfContact = pgTable(
  "sf_contact",
  {
    id: sfId("id").primaryKey(),
    accountId: sfId("account_id"),
    name: text("name"),
    email: text("email"),
    createdDate: ts("created_date"),
    systemModstamp: ts("system_modstamp").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    data: jsonb("data").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_contact_email_idx").on(t.email)],
);

export const sfCase = pgTable(
  "sf_case",
  {
    id: sfId("id").primaryKey(),
    recordTypeId: sfId("record_type_id"),
    status: text("status"),
    parentId: sfId("parent_id"),
    contactId: sfId("contact_id"),
    accountId: sfId("account_id"),
    ownerId: sfId("owner_id"),
    // The public site's job id: a Position's own, or for an application the job it applied to.
    siteJobKey: varchar("site_job_key", { length: 24 }),
    createdDate: ts("created_date"),
    closedDate: ts("closed_date"),
    systemModstamp: ts("system_modstamp").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    data: jsonb("data").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [
    index("sf_case_record_type_created_idx").on(t.recordTypeId, t.createdDate),
    index("sf_case_parent_idx").on(t.parentId),
    index("sf_case_contact_idx").on(t.contactId),
    index("sf_case_status_idx").on(t.status),
    index("sf_case_site_job_key_idx").on(t.siteJobKey),
  ],
);

export const sfCaseHistory = pgTable(
  "sf_case_history",
  {
    id: sfId("id").primaryKey(),
    caseId: sfId("case_id").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    dataType: text("data_type"),
    createdDate: ts("created_date").notNull(),
    createdById: sfId("created_by_id"),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_case_history_case_field_idx").on(t.caseId, t.field, t.createdDate)],
);

/** History of the employer pipeline field on Accounts (`acount_status__c`, "סטטוס מעסיק"). */
export const sfAccountHistory = pgTable(
  "sf_account_history",
  {
    id: sfId("id").primaryKey(),
    accountId: sfId("account_id").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    dataType: text("data_type"),
    createdDate: ts("created_date").notNull(),
    createdById: sfId("created_by_id"),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_account_history_account_field_idx").on(t.accountId, t.field, t.createdDate)],
);

/**
 * Where candidate files hang in Salesforce (ContentDocumentLink): one row per file per record it is
 * linked to — a Contact, a CV or application Case, or an email of one. Metadata only: the files
 * themselves are never copied, and open only through the file routes (lib/entities/serve-file.ts).
 */
export const sfFileLink = pgTable(
  "sf_file_link",
  {
    id: sfId("id").primaryKey(),
    documentId: sfId("document_id").notNull(),
    linkedEntityId: sfId("linked_entity_id").notNull(),
    /** "contact" | "case" | "email" */
    entityType: text("entity_type").notNull(),
    title: text("title"),
    extension: text("extension"),
    size: integer("size"),
    versionId: sfId("version_id"),
    documentCreatedAt: ts("document_created_at"),
    systemModstamp: ts("system_modstamp"),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_file_link_document_idx").on(t.documentId), index("sf_file_link_entity_idx").on(t.linkedEntityId)],
);

/**
 * Which topics (lib/cv-topics.ts) each file matches, by Salesforce's full-text index: the topic or
 * group, and the phrases found. Replaced whole on every refresh (lib/sf/sync-topics.ts). Holds ids
 * and phrases only — never text from the files.
 */
export const cvTopics = pgTable(
  "cv_topics",
  {
    documentId: sfId("document_id").notNull(),
    topicId: text("topic_id").notNull(),
    phrases: text("phrases").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.topicId] }), index("cv_topics_topic_idx").on(t.topicId)],
);

/** Which files the topics were searched in, and under which version of the topic list — so each file is searched once. */
export const cvTopicScans = pgTable("cv_topic_scans", {
  documentId: sfId("document_id").primaryKey(),
  version: text("version").notNull(),
  scannedAt: ts("scanned_at").notNull().defaultNow(),
});

/** Email metadata only — bodies are never copied. */
export const sfEmailMessage = pgTable(
  "sf_email_message",
  {
    id: sfId("id").primaryKey(),
    parentId: sfId("parent_id"),
    incoming: boolean("incoming").notNull(),
    messageDate: ts("message_date"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    ccAddress: text("cc_address"),
    subject: text("subject"),
    createdDate: ts("created_date"),
    systemModstamp: ts("system_modstamp").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_email_message_parent_idx").on(t.parentId, t.messageDate)],
);

export const sfTask = pgTable(
  "sf_task",
  {
    id: sfId("id").primaryKey(),
    whatId: sfId("what_id"),
    whoId: sfId("who_id"),
    taskSubtype: text("task_subtype"),
    type: text("type"),
    subject: text("subject"),
    status: text("status"),
    activityDate: ts("activity_date"),
    completedAt: ts("completed_at"),
    callParty: text("call_party"),
    callAnswered: boolean("call_answered"),
    ownerId: sfId("owner_id"),
    createdDate: ts("created_date"),
    systemModstamp: ts("system_modstamp").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    data: jsonb("data").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_task_what_idx").on(t.whatId, t.createdDate)],
);

export const sfEvent = pgTable(
  "sf_event",
  {
    id: sfId("id").primaryKey(),
    whatId: sfId("what_id"),
    whoId: sfId("who_id"),
    subject: text("subject"),
    type: text("type"),
    startAt: ts("start_at"),
    ownerId: sfId("owner_id"),
    createdDate: ts("created_date"),
    systemModstamp: ts("system_modstamp").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    data: jsonb("data").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [index("sf_event_what_idx").on(t.whatId, t.startAt)],
);

/* ------------------------------------------------------------------- sync */

/** Where each object's incremental sync resumes. */
export const syncState = pgTable("sync_state", {
  object: text("object").primaryKey(),
  cursor: ts("cursor"),
  lastStartedAt: ts("last_started_at"),
  lastSuccessAt: ts("last_success_at"),
  lastError: text("last_error"),
  rowCount: integer("row_count"),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    object: text("object").notNull(),
    mode: text("mode").notNull(),
    trigger: text("trigger").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    upserted: integer("upserted"),
    deleted: integer("deleted"),
    apiUsage: text("api_usage"),
    error: text("error"),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

/** Manual "sync now" requests from the admin screen, picked up by the worker. */
export const syncRequests = pgTable("sync_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  mode: text("mode").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  pickedAt: ts("picked_at"),
  doneAt: ts("done_at"),
});

/* -------------------------------------------------------- google analytics */

const day = (name: string) => date(name, { mode: "string" });

/** GA4 page views per day and path; site_job_key set for /job/<id> pages. */
export const gaPageDaily = pgTable(
  "ga_page_daily",
  {
    date: day("date").notNull(),
    pagePath: text("page_path").notNull(),
    siteJobKey: varchar("site_job_key", { length: 24 }),
    views: integer("views").notNull(),
    activeUsers: integer("active_users").notNull(),
    sessions: integer("sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.pagePath] }), index("ga_page_daily_job_idx").on(t.siteJobKey, t.date)],
);

/** GA4 events per day, name and path (apply clicks, sign-ups, filters…). */
export const gaEventDaily = pgTable(
  "ga_event_daily",
  {
    date: day("date").notNull(),
    eventName: text("event_name").notNull(),
    pagePath: text("page_path").notNull(),
    siteJobKey: varchar("site_job_key", { length: 24 }),
    eventCount: integer("event_count").notNull(),
    totalUsers: integer("total_users").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.eventName, t.pagePath] }),
    index("ga_event_daily_event_idx").on(t.eventName, t.date),
    index("ga_event_daily_job_idx").on(t.siteJobKey, t.date),
  ],
);

/** GA4 traffic per day by channel group, source and medium. */
export const gaChannelDaily = pgTable(
  "ga_channel_daily",
  {
    date: day("date").notNull(),
    channelGroup: text("channel_group").notNull(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    sessions: integer("sessions").notNull(),
    activeUsers: integer("active_users").notNull(),
    newUsers: integer("new_users").notNull(),
    engagedSessions: integer("engaged_sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.channelGroup, t.source, t.medium] })],
);

/** GA4 sessions per day by UTM campaign, source and medium. */
export const gaCampaignDaily = pgTable(
  "ga_campaign_daily",
  {
    date: day("date").notNull(),
    campaign: text("campaign").notNull(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    sessions: integer("sessions").notNull(),
    newUsers: integer("new_users").notNull(),
    engagedSessions: integer("engaged_sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.campaign, t.source, t.medium] }), index("ga_campaign_daily_campaign_idx").on(t.campaign, t.date)],
);

/** Key site events per day by the session's UTM campaign. */
export const gaCampaignEventDaily = pgTable(
  "ga_campaign_event_daily",
  {
    date: day("date").notNull(),
    campaign: text("campaign").notNull(),
    eventName: text("event_name").notNull(),
    eventCount: integer("event_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.campaign, t.eventName] })],
);

/** Where each campaign's sessions landed; job landing pages carry the job key. */
export const gaCampaignLandingDaily = pgTable(
  "ga_campaign_landing_daily",
  {
    date: day("date").notNull(),
    campaign: text("campaign").notNull(),
    landingPage: text("landing_page").notNull(),
    siteJobKey: varchar("site_job_key", { length: 24 }),
    sessions: integer("sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.campaign, t.landingPage] }), index("ga_campaign_landing_campaign_idx").on(t.campaign)],
);

/* -------------------------------------------------------------- campaigns */

/** Editor-maintained details of a campaign, keyed by its UTM campaign name. */
export const campaignSettings = pgTable("campaign_settings", {
  campaignKey: text("campaign_key").primaryKey(),
  label: text("label"),
  smoovCampaignId: integer("smoov_campaign_id"),
  /** Overrides the detected send day (the campaign's busiest day). */
  sendDay: day("send_day"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Jobs a campaign promoted, linked by an editor. */
export const campaignJobs = pgTable(
  "campaign_jobs",
  {
    campaignKey: text("campaign_key").notNull(),
    jobCaseId: sfId("job_case_id").notNull(),
    linkedBy: text("linked_by").notNull(),
    linkedAt: ts("linked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignKey, t.jobCaseId] }), index("campaign_jobs_job_idx").on(t.jobCaseId)],
);

/** Published GTM container versions, one row per version seen. */
export const gtmVersions = pgTable("gtm_versions", {
  versionId: text("version_id").primaryKey(),
  name: text("name"),
  fingerprint: text("fingerprint"),
  tagCount: integer("tag_count").notNull(),
  triggerCount: integer("trigger_count").notNull(),
  variableCount: integer("variable_count").notNull(),
  sendsJobId: boolean("sends_job_id").notNull(),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  data: jsonb("data").notNull(),
});

/* ------------------------------------------------------------------ smoov */

export const smoovLists = pgTable("smoov_lists", {
  id: integer("id").primaryKey(),
  name: text("name"),
  contactsCount: integer("contacts_count"),
  data: jsonb("data").notNull(),
  syncedAt: syncedAt(),
});

/** Campaigns to track — SMOOV's API cannot list them, so admins register ids. */
export const smoovCampaigns = pgTable("smoov_campaigns", {
  id: integer("id").primaryKey(),
  label: text("label").notNull(),
  addedBy: text("added_by").notNull(),
  addedAt: ts("added_at").notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
});

/** Latest aggregated statistics per tracked campaign. */
export const smoovCampaignStats = pgTable("smoov_campaign_stats", {
  campaignId: integer("campaign_id").primaryKey(),
  sentAt: ts("sent_at"),
  sent: integer("sent"),
  opens: integer("opens"),
  clicks: integer("clicks"),
  bounces: integer("bounces"),
  unsubscribes: integer("unsubscribes"),
  data: jsonb("data").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
});

/* --------------------------------------------------------------- webhooks */

/** The status each job/application Case had when the webhook last looked, to tell what changed since. */
export const webhookCaseState = pgTable("webhook_case_state", {
  caseId: sfId("case_id").primaryKey(),
  status: text("status"),
  siteStatus: text("site_status"),
  seenAt: ts("seen_at").notNull().defaultNow(),
});

/** Outgoing events, posted by the sync worker with retries (src/lib/api/outbound.ts). */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    failedAt: ts("failed_at"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.nextAttemptAt).where(sql`delivered_at is null and failed_at is null`),
    index("webhook_deliveries_type_created_idx").on(t.type, t.createdAt),
  ],
);

/* --------------------------------------------------------- SKEELZ Connect */

/**
 * Keys other systems use to call /api/v1 (docs/connect-api.md), issued at /admin/api.
 * Only the sha256 of a key is stored; `prefix` is the first characters after `sk_admin_`, for lists.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes").array().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    lastUsedAt: ts("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.hash)],
);

/** How this app calls the other SKEELZ apps: one row per peer, its key encrypted (src/lib/connect/crypto.ts). */
export const connections = pgTable(
  "connections",
  {
    peer: text("peer").primaryKey(),
    baseUrl: text("base_url").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyLast4: text("key_last4").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    lastCheckAt: ts("last_check_at"),
    lastCheckOk: boolean("last_check_ok"),
    lastCheckDetail: text("last_check_detail"),
  },
  (t) => [check("connections_peer_check", sql`${t.peer} in ('admin', 'crm', 'site')`)],
);

/* ------------------------------------------------------------------ texts */

/** Admin-edited copy for pages such as the accessibility statement; src/lib/texts/registry.ts lists the texts. */
export const siteTexts = pgTable("site_texts", {
  key: text("key").primaryKey(),
  body: text("body").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Every saved version of a text, so any edit can be undone. The newest version is the current text. */
export const siteTextVersions = pgTable(
  "site_text_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    body: text("body").notNull(),
    savedBy: text("saved_by").notNull(),
    savedAt: ts("saved_at").notNull().defaultNow(),
  },
  (t) => [index("site_text_versions_key_idx").on(t.key, t.id)],
);

/** Schema discovery runs, generated on the server so credentials never leave it. */
export const sfSchemaReports = pgTable("sf_schema_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  report: jsonb("report").$type<SchemaReport>().notNull(),
  markdown: text("markdown").notNull(),
});

/* -------------------------------------------------------------------- MCP */

/*
 * The MCP server (docs/mcp.md): AI clients such as Claude connect at /mcp with OAuth 2.1 + PKCE.
 * The person signs in with the site's own Google sign-in (xhostd) and approves the connection;
 * what the connection may do is their site role, read again on every call, and at most the
 * ceiling (`max_role`) they chose when approving. Only sha256 hashes of codes and tokens are kept.
 */

/** Clients that registered themselves (RFC 7591). Public clients: PKCE, no secret. */
export const mcpClients = pgTable("mcp_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdIp: text("created_ip"),
});

/** Authorization codes, single use, ten minutes. */
export const mcpCodes = pgTable(
  "mcp_codes",
  {
    hash: text("hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    maxRole: text("max_role").$type<Role>().notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [check("mcp_codes_role_check", sql`${t.maxRole} in ('viewer', 'editor', 'admin')`)],
);

/** One approved connection: a person, a client, a role ceiling, and its current token pair. */
export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    maxRole: text("max_role").$type<Role>().notNull(),
    accessHash: text("access_hash").notNull(),
    accessExpiresAt: ts("access_expires_at").notNull(),
    refreshHash: text("refresh_hash").notNull(),
    refreshExpiresAt: ts("refresh_expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    calls: integer("calls").notNull().default(0),
    revokedAt: ts("revoked_at"),
    revokedBy: text("revoked_by"),
  },
  (t) => [
    check("mcp_grants_role_check", sql`${t.maxRole} in ('viewer', 'editor', 'admin')`),
    uniqueIndex("mcp_grants_access_idx").on(t.accessHash),
    uniqueIndex("mcp_grants_refresh_idx").on(t.refreshHash),
    index("mcp_grants_user_idx").on(t.userId),
  ],
);
