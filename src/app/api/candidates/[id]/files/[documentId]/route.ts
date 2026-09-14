import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { fileName, loadCandidateFiles } from "@/lib/entities/candidates";
import { isSfId } from "@/lib/entities/search";
import { sf } from "@/lib/sf/client";

export const dynamic = "force-dynamic";

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

/**
 * Opens a candidate's file. Only a file linked to this candidate, or to one of
 * their applications, is served — the document id alone opens nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }

  const { id, documentId } = await params;
  if (!isSfId(id) || !/^069[a-zA-Z0-9]{12,15}$/.test(documentId)) return new Response("Not found", { status: 404 });

  // Counted from the audit log (indexed on actor, at), so the limit holds across restarts.
  const [{ opened, refused }] = (await getDb()
    .select({
      opened: sql<number>`(count(*) filter (where ${auditLog.action} = ${OPENED}))::int`,
      refused: sql<number>`(count(*) filter (where ${auditLog.action} = ${THROTTLED}))::int`,
    })
    .from(auditLog)
    .where(
      and(eq(auditLog.actor, user.email), inArray(auditLog.action, [OPENED, THROTTLED]), gt(auditLog.at, new Date(Date.now() - 3600_000))),
    )) as [{ opened: number; refused: number }];
  if (opened >= FILES_PER_HOUR) {
    // One refusal entry an hour is the signal; a script retrying in a loop must not flood the log.
    if (!refused) await writeAudit(user.email, THROTTLED, id, { documentId, opened });
    return new Response("נפתחו יותר מדי קבצים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.", { status: 429 });
  }

  const { files } = await loadCandidateFiles(id);
  const file = files.find((f) => f.documentId === documentId);
  if (!file) return new Response("Not found", { status: 404 });

  const upstream = await sf.downloadVersion(file.versionId);
  if (!upstream.ok || !upstream.body) return new Response("הקובץ לא זמין כרגע", { status: 502 });

  await writeAudit(user.email, OPENED, id, { documentId });

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
