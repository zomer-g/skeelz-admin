import { and, eq, gte, sql } from "drizzle-orm";
import { auditUnavailable, AuditWriteError, writeAudit, writeAuditStrict } from "@/lib/audit";
import { firstInWindow } from "@/lib/api/rate-limit";
import { israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { afterOpen, atLimit, dailyQuota, FILE_LIMITS, FILE_OPENED, FILE_REFUSED, type DailyQuota } from "@/lib/security/files";
import { CV_TEXT_EXTENSIONS, CV_TEXT_LIMITS, extractCvText, type CvTextResult } from "./cv-text";
import { lockBusy, LockTimeoutError, withUserLock } from "@/lib/security/lock";
import { sf } from "@/lib/sf/client";

/**
 * Serving one candidate file out of Salesforce. The routes decide *which* files
 * a request may reach (a candidate's own, or those of an email address's
 * person); everything after that decision is here, so both go through the same
 * daily limit (lib/security/files.ts), the same audit entry and the same sandboxing headers.
 */

/** Types a browser may show in a tab; anything else is downloaded, never rendered. */
const INLINE: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const DOWNLOAD: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
};

/*
 * A file is someone else's content served from our origin: no scripts, no subresources, and an
 * opaque origin via sandbox. Chromium's PDF viewer does not load in a sandboxed document, so a PDF
 * keeps its origin and relies on default-src 'none'; object-src 'self' lets the viewer embed it.
 */
const FILE_CSP = "sandbox; default-src 'none'; object-src 'self'";
const PDF_CSP = "default-src 'none'; object-src 'self'";

/** The document id shape; the only one ever put into a Salesforce path. */
export const isDocumentId = (v: string) => /^069[a-zA-Z0-9]{12,15}$/.test(v);

/** A file name for display and download: the title, with the extension added only if the title lacks it. */
export const fileName = (f: { title: string; extension: string | null }) =>
  f.extension && !f.title.toLowerCase().endsWith(`.${f.extension}`) ? `${f.title}.${f.extension}` : f.title;

export interface ServableFile {
  documentId: string;
  versionId: string;
  title: string;
  extension: string | null;
}

/** Who the file belongs to, as the audit entry records it: so "who opened X's files" has an answer by either key. */
export interface FileSubject {
  /** The candidate's id, or the email address the file was found through (the entry's target). */
  subject: string;
  contactId?: string | null;
  email?: string | null;
}

/**
 * Streams the file and writes the audit entry — or refuses once the day's limit is reached and
 * asks the admins for more. The count, the download and the entry happen under the person's lock
 * (lib/security/lock.ts), so parallel requests cannot share one remaining slot; and the entry is
 * written strictly: a file whose opening could not be logged is not served.
 */
export async function serveFile(userEmail: string, file: ServableFile, who: FileSubject | string): Promise<Response> {
  const subjectInfo: FileSubject = typeof who === "string" ? { subject: who } : who;
  try {
    return await withUserLock("files", userEmail, () => serveLocked(userEmail, file, subjectInfo));
  } catch (err) {
    if (err instanceof AuditWriteError) return auditUnavailable();
    if (err instanceof LockTimeoutError) return lockBusy();
    throw err;
  }
}

async function serveLocked(userEmail: string, file: ServableFile, who: FileSubject): Promise<Response> {
  const { subject } = who;
  const quota = await dailyQuota(userEmail);
  if (quota.opened >= quota.allowed) {
    await refuseAtLimit(userEmail, file, subject, quota);
    return new Response(
      `הגעת למגבלה של ${quota.allowed} קבצי מועמדים להיום. מנהל המערכת קיבל הודעה, והוא יכול לאשר לך עוד ${FILE_LIMITS.grant} קבצים להיום.`,
      { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const upstream = await sf.downloadVersion(file.versionId);
  if (!upstream.ok || !upstream.body) {
    await logFileDenied(userEmail, subject, file.documentId, "unavailable");
    return new Response("הקובץ לא זמין כרגע", { status: 502 });
  }

  try {
    await writeAuditStrict(userEmail, FILE_OPENED, subject, {
      documentId: file.documentId,
      title: file.title.slice(0, 200),
      contactId: who.contactId ?? null,
      email: who.email ?? null,
    });
  } catch (err) {
    await upstream.body.cancel().catch(() => {});
    throw err;
  }
  await afterOpen(userEmail, quota);

  const ext = file.extension ?? "";
  const inline = Object.hasOwn(INLINE, ext) ? INLINE[ext] : undefined;
  const download = Object.hasOwn(DOWNLOAD, ext) ? DOWNLOAD[ext] : undefined;
  return new Response(upstream.body, {
    headers: {
      "Content-Type": inline ?? download ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", fileName(file)),
      "Content-Security-Policy": inline === "application/pdf" ? PDF_CSP : FILE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
    },
  });
}

/** A file past the day's limit: one refusal entry per file a day (a script retrying in a loop must not flood the log), and the admins are asked. */
async function refuseAtLimit(userEmail: string, file: { documentId: string }, subject: string, quota: DailyQuota): Promise<void> {
  const [seen] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor, userEmail),
        eq(auditLog.action, FILE_REFUSED),
        gte(auditLog.at, israelMidnight(quota.day)),
        sql`${auditLog.details}->>'documentId' = ${file.documentId}`,
      ),
    );
  if (!seen?.n) await writeAudit(userEmail, FILE_REFUSED, subject, { documentId: file.documentId, opened: quota.opened, allowed: quota.allowed });
  await atLimit(userEmail, quota);
}

export type FileTextResult =
  | { ok: true; text: string; truncated: boolean; pages?: number }
  | { ok: false; message: string };

const TEXT_FAILURES: Record<Exclude<CvTextResult, { ok: true }>["reason"], string> = {
  unsupported: `Only ${CV_TEXT_EXTENSIONS.join(", ")} files can be read as text; open this one on the site.`,
  too_large: "The file is too large to read as text; open it on the site.",
  unreadable: "The file could not be read (damaged or protected); open it on the site.",
  no_text: "The file has no text layer (a scanned image, most likely); open it on the site.",
};

/**
 * The text of one candidate file, for the MCP tool cv_text: the same daily file limit, lock and
 * strict audit entry as opening it on the site (`candidate.file_opened`, with `via` and `text`), so
 * it counts as one opened file. A file that yields no text is not counted: nothing was handed over.
 * The caller has already checked that the file is this person's.
 */
export async function readFileText(userEmail: string, file: ServableFile, who: FileSubject, via: string): Promise<FileTextResult> {
  if (!(CV_TEXT_EXTENSIONS as readonly string[]).includes((file.extension ?? "").toLowerCase())) return { ok: false, message: TEXT_FAILURES.unsupported };
  return withUserLock("files", userEmail, async () => {
    const quota = await dailyQuota(userEmail);
    if (quota.opened >= quota.allowed) {
      await refuseAtLimit(userEmail, file, who.subject, quota);
      return {
        ok: false,
        message: `Daily file limit reached: ${quota.allowed} candidate files a day per person, on the site and here together. The admins were notified and can allow another ${FILE_LIMITS.grant} today at /admin/security.`,
      };
    }
    const upstream = await sf.downloadVersion(file.versionId);
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      await logFileDenied(userEmail, who.subject, file.documentId, "unavailable");
      return { ok: false, message: "Salesforce did not hand over the file right now; try again later." };
    }
    const size = Number(upstream.headers.get("content-length") ?? 0);
    if (size > CV_TEXT_LIMITS.maxBytes) {
      await upstream.body.cancel().catch(() => {});
      return { ok: false, message: TEXT_FAILURES.too_large };
    }
    const result = await extractCvText(new Uint8Array(await upstream.arrayBuffer()), file.extension);
    if (!result.ok) return { ok: false, message: TEXT_FAILURES[result.reason] };
    await writeAuditStrict(userEmail, FILE_OPENED, who.subject, {
      documentId: file.documentId,
      title: file.title.slice(0, 200),
      contactId: who.contactId ?? null,
      email: who.email ?? null,
      via,
      text: true,
      chars: result.text.length,
    });
    await afterOpen(userEmail, quota);
    return result;
  });
}

export const FILE_DENIED = "candidate.file_denied";

/**
 * A file request that served nothing: not this person's file, a malformed id, or Salesforce did not
 * hand it over. Probing for document ids leaves a trace, at most one entry per person, subject and
 * reason in ten minutes, so a script in a loop cannot flood the log.
 */
export async function logFileDenied(userEmail: string, subject: string, documentId: string, reason: "not_theirs" | "invalid" | "unavailable"): Promise<void> {
  if (!firstInWindow(`file-denied:${userEmail}:${subject}:${reason}`, 10 * 60_000)) return;
  await writeAudit(userEmail, FILE_DENIED, subject.slice(0, 254), { documentId: documentId.slice(0, 40), reason });
}

/** RFC 6266: a plain-ASCII fallback name for old clients, then the real name encoded per RFC 5987. */
function contentDisposition(type: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
