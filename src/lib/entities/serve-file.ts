import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { sf } from "@/lib/sf/client";

/**
 * Serving one candidate file out of Salesforce. The routes decide *which* files
 * a request may reach (a candidate's own, or those of an email address's
 * person); everything after that decision is here, so both go through the same
 * rate limit, the same audit entry and the same sandboxing headers.
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

const OPENED = "candidate.file_opened";
const THROTTLED = "candidate.file_rate_limited";
// Plenty for screening by hand; a script pulling every CV hits it within minutes.
const FILES_PER_HOUR = 60;

/** The document id shape; the only one ever put into a Salesforce path. */
export const isDocumentId = (v: string) => /^069[a-zA-Z0-9]{12,15}$/.test(v);

/** A file name for display and download: the title, with the extension added only if the title lacks it. */
export const fileName = (f: { title: string; extension: string | null }) =>
  f.extension && !f.title.toLowerCase().endsWith(`.${f.extension}`) ? `${f.title}.${f.extension}` : f.title;

/**
 * How many files this user opened in the last hour, counted from the audit log
 * (indexed on actor, at), so the limit holds across restarts.
 */
export async function fileQuota(email: string): Promise<{ ok: boolean; opened: number; refused: number }> {
  const [row] = (await getDb()
    .select({
      opened: sql<number>`(count(*) filter (where ${auditLog.action} = ${OPENED}))::int`,
      refused: sql<number>`(count(*) filter (where ${auditLog.action} = ${THROTTLED}))::int`,
    })
    .from(auditLog)
    .where(
      and(eq(auditLog.actor, email), inArray(auditLog.action, [OPENED, THROTTLED]), gt(auditLog.at, new Date(Date.now() - 3600_000))),
    )) as [{ opened: number; refused: number }];
  return { ok: row.opened < FILES_PER_HOUR, opened: row.opened, refused: row.refused };
}

export interface ServableFile {
  documentId: string;
  versionId: string;
  title: string;
  extension: string | null;
}

/**
 * Streams the file, writes the audit entry and refuses once the hourly limit is
 * reached. `subject` is what the audit entry records it under — the candidate's
 * id, or the email address the file was found through.
 */
export async function serveFile(userEmail: string, file: ServableFile, subject: string): Promise<Response> {
  const quota = await fileQuota(userEmail);
  if (!quota.ok) {
    // One refusal entry an hour is the signal; a script retrying in a loop must not flood the log.
    if (!quota.refused) await writeAudit(userEmail, THROTTLED, subject, { documentId: file.documentId, opened: quota.opened });
    return new Response("נפתחו יותר מדי קבצים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.", { status: 429 });
  }

  const upstream = await sf.downloadVersion(file.versionId);
  if (!upstream.ok || !upstream.body) return new Response("הקובץ לא זמין כרגע", { status: 502 });

  await writeAudit(userEmail, OPENED, subject, { documentId: file.documentId });

  const ext = file.extension ?? "";
  const inline = INLINE[ext];
  return new Response(upstream.body, {
    headers: {
      "Content-Type": inline ?? DOWNLOAD[ext] ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", fileName(file)),
      "Content-Security-Policy": inline === "application/pdf" ? PDF_CSP : FILE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
    },
  });
}

/** RFC 6266: a plain-ASCII fallback name for old clients, then the real name encoded per RFC 5987. */
function contentDisposition(type: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
