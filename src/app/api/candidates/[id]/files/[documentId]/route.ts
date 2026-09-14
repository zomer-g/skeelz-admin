import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
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

  const { files } = await loadCandidateFiles(id);
  const file = files.find((f) => f.documentId === documentId);
  if (!file) return new Response("Not found", { status: 404 });

  const upstream = await sf.downloadVersion(file.versionId);
  if (!upstream.ok || !upstream.body) return new Response("הקובץ לא זמין כרגע", { status: 502 });

  await writeAudit(user.email, "candidate.file_opened", id, { documentId });

  const ext = file.extension ?? "";
  const name = fileName(file);
  const inline = INLINE[ext];
  return new Response(upstream.body, {
    headers: {
      "Content-Type": inline ?? DOWNLOAD[ext] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
