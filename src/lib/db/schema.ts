import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
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
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_actor_at_idx").on(t.actor, t.at)],
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

/** Schema discovery runs, generated on the server so credentials never leave it. */
export const sfSchemaReports = pgTable("sf_schema_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  report: jsonb("report").$type<SchemaReport>().notNull(),
  markdown: text("markdown").notNull(),
});
