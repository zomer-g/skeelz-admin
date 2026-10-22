import { loadCandidateFiles } from "@/lib/entities/candidates";
import { isSfId } from "@/lib/entities/search";
import { isDocumentId, serveFile } from "@/lib/entities/serve-file";
import { AuthError, requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Opens a candidate's file. Only a file linked to this candidate, or to one of
 * their applications, is served — the document id alone opens nothing. The
 * streaming, the daily limit and the audit entry live in `serve-file.ts`.
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
  if (!isSfId(id) || !isDocumentId(documentId)) return new Response("Not found", { status: 404 });

  const { files } = await loadCandidateFiles(id);
  const file = files.find((f) => f.documentId === documentId);
  if (!file) return new Response("Not found", { status: 404 });

  return serveFile(user.email, file, id);
}
