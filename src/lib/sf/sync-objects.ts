import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import {
  sfAccount,
  sfCase,
  sfCaseHistory,
  sfContact,
  sfEmailMessage,
  sfEvent,
  sfRecordType,
  sfTask,
  sfUser,
} from "@/lib/db/schema";

export type SfRecord = Record<string, unknown>;

export interface SyncObjectDef {
  /** Salesforce API name. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTableWithColumns<any>;
  /** Monotonic field the incremental sync resumes from. */
  cursorField: "SystemModstamp" | "CreatedDate";
  /** Extra SOQL filter, applied to every query for this object. */
  where?: string;
  /** Only these fields (intersected with what the org has). Omit for all fields. */
  include?: string[];
  /** Fields never copied — bodies and other bulky free text. */
  exclude?: string[];
  /** Has IsDeleted, so deletions can be picked up from the recycle bin. */
  hasIsDeleted: boolean;
  /** Nightly id comparison to catch records purged from the recycle bin. */
  reconcile: boolean;
  /** Skip quietly when the integration user cannot see the object (e.g. Task before its permission). */
  optional?: boolean;
  toRow(record: SfRecord): Record<string, unknown>;
}

const str = (r: SfRecord, f: string): string | null => {
  const v = r[f];
  return typeof v === "string" && v !== "" ? v : v == null ? null : String(v);
};

const bool = (r: SfRecord, f: string): boolean => r[f] === true;

/** Salesforce datetimes end in "+0000", which not every Date parser accepts. */
export function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const date = (r: SfRecord, f: string) => toDate(r[f]);

const MONGO_ID = /^[0-9a-f]{24}$/i;
const JOB_URL = /\/job\/([0-9a-f]{24})/i;

function siteJobKey(r: SfRecord): string | null {
  for (const f of ["PID_cambium__c", "A_PID_cambium__c"]) {
    const v = str(r, f)?.trim();
    if (v && MONGO_ID.test(v)) return v.toLowerCase();
  }
  const link = str(r, "Field47__c") ?? str(r, "PLink_cambium__c");
  return link?.match(JOB_URL)?.[1]?.toLowerCase() ?? null;
}

/** Synced in this order: lookups first, so a Case row's owner and record type already exist. */
export const SYNC_OBJECTS: SyncObjectDef[] = [
  {
    name: "RecordType",
    table: sfRecordType,
    cursorField: "SystemModstamp",
    include: ["Id", "SobjectType", "DeveloperName", "Name", "IsActive", "SystemModstamp"],
    hasIsDeleted: false,
    reconcile: false,
    toRow: (r) => ({
      id: str(r, "Id"),
      sobjectType: str(r, "SobjectType"),
      developerName: str(r, "DeveloperName"),
      name: str(r, "Name"),
      isActive: bool(r, "IsActive"),
      systemModstamp: date(r, "SystemModstamp"),
    }),
  },
  {
    name: "User",
    table: sfUser,
    cursorField: "SystemModstamp",
    include: ["Id", "Name", "Email", "IsActive", "SystemModstamp"],
    hasIsDeleted: false,
    reconcile: false,
    optional: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      name: str(r, "Name"),
      email: str(r, "Email")?.toLowerCase() ?? null,
      isActive: bool(r, "IsActive"),
      systemModstamp: date(r, "SystemModstamp"),
    }),
  },
  {
    name: "Account",
    table: sfAccount,
    cursorField: "SystemModstamp",
    hasIsDeleted: true,
    reconcile: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      name: str(r, "Name"),
      createdDate: date(r, "CreatedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
      data: r,
    }),
  },
  {
    name: "Contact",
    table: sfContact,
    cursorField: "SystemModstamp",
    hasIsDeleted: true,
    reconcile: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      accountId: str(r, "AccountId"),
      name: str(r, "Name"),
      email: str(r, "Email")?.toLowerCase() ?? null,
      createdDate: date(r, "CreatedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
      data: r,
    }),
  },
  {
    name: "Case",
    table: sfCase,
    cursorField: "SystemModstamp",
    hasIsDeleted: true,
    reconcile: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      recordTypeId: str(r, "RecordTypeId"),
      status: str(r, "Status"),
      parentId: str(r, "ParentId"),
      contactId: str(r, "ContactId"),
      accountId: str(r, "AccountId"),
      ownerId: str(r, "OwnerId"),
      siteJobKey: siteJobKey(r),
      createdDate: date(r, "CreatedDate"),
      closedDate: date(r, "ClosedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
      data: r,
    }),
  },
  {
    name: "CaseHistory",
    table: sfCaseHistory,
    cursorField: "CreatedDate",
    include: ["Id", "CaseId", "Field", "OldValue", "NewValue", "DataType", "CreatedDate", "CreatedById"],
    // Pipeline fields only; Subject/Description history would copy free text for no metric.
    where: "Field IN ('Status', 'RecordType', 'Owner', 'created', 'Contact', 'Priority', 'Reason', 'Origin')",
    hasIsDeleted: false,
    reconcile: false,
    toRow: (r) => ({
      id: str(r, "Id"),
      caseId: str(r, "CaseId"),
      field: str(r, "Field"),
      oldValue: str(r, "OldValue"),
      newValue: str(r, "NewValue"),
      dataType: str(r, "DataType"),
      createdDate: date(r, "CreatedDate"),
      createdById: str(r, "CreatedById"),
    }),
  },
  {
    name: "EmailMessage",
    table: sfEmailMessage,
    cursorField: "SystemModstamp",
    include: [
      "Id",
      "ParentId",
      "Incoming",
      "MessageDate",
      "FromAddress",
      "ToAddress",
      "CcAddress",
      "Subject",
      "CreatedDate",
      "SystemModstamp",
      "IsDeleted",
    ],
    where: "ParentId != null",
    hasIsDeleted: true,
    reconcile: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      parentId: str(r, "ParentId"),
      incoming: bool(r, "Incoming"),
      messageDate: date(r, "MessageDate"),
      fromAddress: str(r, "FromAddress")?.toLowerCase() ?? null,
      toAddress: str(r, "ToAddress")?.toLowerCase() ?? null,
      ccAddress: str(r, "CcAddress")?.toLowerCase() ?? null,
      subject: str(r, "Subject"),
      createdDate: date(r, "CreatedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
    }),
  },
  {
    name: "Task",
    table: sfTask,
    cursorField: "SystemModstamp",
    include: [
      "Id",
      "WhatId",
      "WhoId",
      "TaskSubtype",
      "Type",
      "Subject",
      "Status",
      "ActivityDate",
      "CompletedDateTime",
      "CallType",
      "CallDurationInSeconds",
      "CallDisposition",
      "OwnerId",
      "CreatedDate",
      "SystemModstamp",
      "IsDeleted",
    ],
    where: "What.Type = 'Case'",
    hasIsDeleted: true,
    reconcile: true,
    optional: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      whatId: str(r, "WhatId"),
      whoId: str(r, "WhoId"),
      taskSubtype: str(r, "TaskSubtype"),
      type: str(r, "Type"),
      subject: str(r, "Subject"),
      status: str(r, "Status"),
      activityDate: date(r, "ActivityDate"),
      completedAt: date(r, "CompletedDateTime"),
      ownerId: str(r, "OwnerId"),
      createdDate: date(r, "CreatedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
      data: r,
    }),
  },
  {
    name: "Event",
    table: sfEvent,
    cursorField: "SystemModstamp",
    include: [
      "Id",
      "WhatId",
      "WhoId",
      "Subject",
      "Type",
      "EventSubtype",
      "StartDateTime",
      "EndDateTime",
      "OwnerId",
      "CreatedDate",
      "SystemModstamp",
      "IsDeleted",
    ],
    where: "What.Type = 'Case'",
    hasIsDeleted: true,
    reconcile: true,
    optional: true,
    toRow: (r) => ({
      id: str(r, "Id"),
      whatId: str(r, "WhatId"),
      whoId: str(r, "WhoId"),
      subject: str(r, "Subject"),
      type: str(r, "Type"),
      startAt: date(r, "StartDateTime"),
      ownerId: str(r, "OwnerId"),
      createdDate: date(r, "CreatedDate"),
      systemModstamp: date(r, "SystemModstamp"),
      isDeleted: bool(r, "IsDeleted"),
      data: r,
    }),
  },
];
