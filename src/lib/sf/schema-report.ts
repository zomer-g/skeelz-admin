import { sf, SalesforceError } from "./client";
import type { SfChildRelationship, SfDescribe, SfField, SfRecordTypeInfo } from "./types";

/**
 * Discovers how SKEELZ's org is shaped before any dashboard is built on it:
 * which Case record types are jobs / applications / leads, how an application
 * points at its job, which Case field carries the public job link
 * (jobs.skeelz.co.il/job/<24-hex id>), and which fields CaseHistory tracks.
 *
 * Reads metadata, counts and a small sample of recent Cases; it writes nothing.
 */

export const DEFAULT_OBJECTS = ["Case", "Contact", "Account"];

const JOB_URL_RE = /\/job\/([0-9a-f]{24})\b/i;
const MONGO_ID_RE = /^[0-9a-f]{24}$/i;
const TEXT_TYPES = new Set(["string", "url", "textarea", "encryptedstring", "combobox"]);
const SAMPLE_SIZE = 200;
const FIELDS_PER_QUERY = 40;

export interface FieldSummary {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  referenceTo: string[];
  picklist: string[];
  formula: boolean;
}

export interface ObjectReport {
  name: string;
  label: string;
  recordCount: number | null;
  recordTypes: SfRecordTypeInfo[];
  fields: FieldSummary[];
  childRelationships: SfChildRelationship[];
}

export interface RecordTypeCount {
  developerName: string | null;
  name: string | null;
  count: number;
}

export interface JobLinkCandidate {
  field: string;
  label: string;
  urlMatches: number;
  idOnlyMatches: number;
  recordTypes: string[];
  example: string;
}

export interface SchemaReport {
  generatedAt: string;
  apiVersion: string;
  instanceUrl: string;
  apiUsage: { max: number; remaining: number } | null;
  customObjects: { name: string; label: string }[];
  objects: ObjectReport[];
  caseRecordTypeCounts: RecordTypeCount[] | { error: string };
  caseHistoryFields: { field: string; count: number }[] | { error: string };
  jobLinkCandidates: JobLinkCandidate[] | { error: string };
  sampledCases: number;
}

function summarize(field: SfField): FieldSummary {
  return {
    name: field.name,
    label: field.label,
    type: field.type,
    custom: field.custom,
    referenceTo: field.referenceTo,
    picklist: field.picklistValues.filter((p) => p.active).map((p) => p.value),
    formula: field.calculated,
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof SalesforceError ? err.message : String(err) };
  }
}

export async function buildSchemaReport(objectNames: string[] = DEFAULT_OBJECTS): Promise<SchemaReport> {
  const [global, limits, instanceUrl] = await Promise.all([sf.describeGlobal(), sf.limits().catch(() => null), sf.instanceUrl()]);

  const describes: SfDescribe[] = [];
  for (const name of objectNames) describes.push(await sf.describe(name));

  const objects: ObjectReport[] = [];
  for (const d of describes) {
    const recordCount = d.queryable ? await sf.count(`SELECT COUNT() FROM ${d.name}`).catch(() => null) : null;
    objects.push({
      name: d.name,
      label: d.label,
      recordCount,
      recordTypes: d.recordTypeInfos.filter((rt) => !rt.master),
      fields: d.fields.map(summarize),
      childRelationships: d.childRelationships.filter((c) => c.relationshipName),
    });
  }

  const caseDescribe = describes.find((d) => d.name === "Case") ?? (await sf.describe("Case"));
  const hasRecordTypes = caseDescribe.fields.some((f) => f.name === "RecordTypeId");

  const caseRecordTypeCounts = await safe(async () => {
    if (!hasRecordTypes) {
      return [{ developerName: null, name: null, count: await sf.count("SELECT COUNT() FROM Case") }];
    }
    const rows = await sf.query<{ dn: string | null; n: string | null; c: number }>(
      "SELECT RecordType.DeveloperName dn, RecordType.Name n, COUNT(Id) c FROM Case GROUP BY RecordType.DeveloperName, RecordType.Name",
    );
    return rows.map((r) => ({ developerName: r.dn, name: r.n, count: r.c })).sort((a, b) => b.count - a.count);
  });

  const caseHistoryFields = await safe(async () => {
    const rows = await sf.query<{ Field: string; c: number }>("SELECT Field, COUNT(Id) c FROM CaseHistory GROUP BY Field");
    return rows.map((r) => ({ field: r.Field, count: r.c })).sort((a, b) => b.count - a.count);
  });

  let sampledCases = 0;
  const jobLinkCandidates = await safe(async () => {
    const textFields = caseDescribe.fields.filter((f) => TEXT_TYPES.has(f.type));
    const found = new Map<string, JobLinkCandidate>();

    for (let i = 0; i < textFields.length; i += FIELDS_PER_QUERY) {
      const batch = textFields.slice(i, i + FIELDS_PER_QUERY);
      const select = ["Id", ...(hasRecordTypes ? ["RecordType.DeveloperName"] : []), ...batch.map((f) => f.name)];
      const rows = await sf.query<Record<string, unknown> & { RecordType?: { DeveloperName?: string } | null }>(
        `SELECT ${select.join(", ")} FROM Case ORDER BY CreatedDate DESC LIMIT ${SAMPLE_SIZE}`,
      );
      sampledCases = Math.max(sampledCases, rows.length);

      for (const row of rows) {
        for (const field of batch) {
          const value = row[field.name];
          if (typeof value !== "string" || !value) continue;
          const isUrl = JOB_URL_RE.test(value);
          const isId = MONGO_ID_RE.test(value.trim());
          if (!isUrl && !isId) continue;

          const entry =
            found.get(field.name) ??
            ({ field: field.name, label: field.label, urlMatches: 0, idOnlyMatches: 0, recordTypes: [], example: "" } satisfies JobLinkCandidate);
          if (isUrl) entry.urlMatches++;
          else entry.idOnlyMatches++;
          const rt = row.RecordType?.DeveloperName;
          if (rt && !entry.recordTypes.includes(rt)) entry.recordTypes.push(rt);
          // Job links are public URLs; an id-only value is just the id.
          entry.example ||= isUrl ? (value.match(/https?:\/\/\S+/)?.[0] ?? value).slice(0, 120) : value.trim();
          found.set(field.name, entry);
        }
      }
    }
    return [...found.values()].sort((a, b) => b.urlMatches + b.idOnlyMatches - (a.urlMatches + a.idOnlyMatches));
  });

  const usage = limits?.DailyApiRequests;

  return {
    generatedAt: new Date().toISOString(),
    apiVersion: sf.apiVersion(),
    instanceUrl,
    apiUsage: usage ? { max: usage.Max, remaining: usage.Remaining } : null,
    customObjects: global.sobjects
      .filter((o) => o.custom && o.queryable && o.name.endsWith("__c"))
      .map((o) => ({ name: o.name, label: o.label })),
    objects,
    caseRecordTypeCounts,
    caseHistoryFields,
    jobLinkCandidates,
    sampledCases,
  };
}

export function reportToMarkdown(report: SchemaReport): string {
  const out: string[] = [];
  const isError = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;
  const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");

  out.push("# Salesforce schema report", "");
  out.push(`- Generated: ${report.generatedAt}`);
  out.push(`- Instance: ${report.instanceUrl} (API v${report.apiVersion})`);
  if (report.apiUsage) {
    out.push(`- Daily API requests: ${report.apiUsage.max - report.apiUsage.remaining} used of ${report.apiUsage.max}`);
  }
  out.push("");

  out.push("## Case record types", "");
  if (isError(report.caseRecordTypeCounts)) out.push(`> ${report.caseRecordTypeCounts.error}`);
  else {
    out.push("| DeveloperName | Name | Cases |", "|---|---|---|");
    for (const r of report.caseRecordTypeCounts) out.push(`| ${r.developerName ?? "(none)"} | ${cell(r.name ?? "")} | ${r.count} |`);
  }
  out.push("");

  out.push(`## Job link candidates on Case (sample of ${report.sampledCases} recent Cases)`, "");
  if (isError(report.jobLinkCandidates)) out.push(`> ${report.jobLinkCandidates.error}`);
  else if (report.jobLinkCandidates.length === 0) out.push("No text field in the sample holds a `/job/<id>` link or a bare 24-hex id.");
  else {
    out.push("| Field | Label | URL matches | Bare-id matches | Record types | Example |", "|---|---|---|---|---|---|");
    for (const c of report.jobLinkCandidates) {
      out.push(`| ${c.field} | ${cell(c.label)} | ${c.urlMatches} | ${c.idOnlyMatches} | ${c.recordTypes.join(", ")} | ${cell(c.example)} |`);
    }
  }
  out.push("");

  out.push("## Fields tracked in CaseHistory", "");
  if (isError(report.caseHistoryFields)) out.push(`> ${report.caseHistoryFields.error}`);
  else {
    out.push("| Field | History rows |", "|---|---|");
    for (const h of report.caseHistoryFields) out.push(`| ${h.field} | ${h.count} |`);
  }
  out.push("");

  out.push("## Custom objects", "");
  out.push(report.customObjects.length ? report.customObjects.map((o) => `- \`${o.name}\` — ${o.label}`).join("\n") : "None.");
  out.push("");

  for (const o of report.objects) {
    out.push(`## ${o.name} (${o.label}) — ${o.recordCount ?? "?"} records`, "");
    if (o.recordTypes.length) {
      out.push("**Record types:** " + o.recordTypes.map((rt) => `\`${rt.developerName}\` (${rt.name}${rt.active ? "" : ", inactive"})`).join(", "), "");
    }
    const lookups = o.fields.filter((f) => f.referenceTo.length);
    if (lookups.length) {
      out.push("**Lookups:** " + lookups.map((f) => `\`${f.name}\` → ${f.referenceTo.join("/")}`).join(", "), "");
    }
    out.push("| Field | Label | Type | Custom | Picklist values |", "|---|---|---|---|---|");
    for (const f of o.fields) {
      const type = f.formula ? `${f.type} (formula)` : f.type;
      const picklist = f.picklist.length > 12 ? `${f.picklist.slice(0, 12).join(", ")} … (+${f.picklist.length - 12})` : f.picklist.join(", ");
      out.push(`| ${f.name} | ${cell(f.label)} | ${type} | ${f.custom ? "✓" : ""} | ${cell(picklist)} |`);
    }
    out.push("");
    if (o.childRelationships.length) {
      out.push(
        "**Child relationships:** " + o.childRelationships.map((c) => `${c.relationshipName} (${c.childSObject}.${c.field})`).join(", "),
        "",
      );
    }
  }

  return out.join("\n");
}
