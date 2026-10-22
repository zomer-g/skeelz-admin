import { AuthError, requireUser } from "@/lib/auth/session";
import { loadEmailCvs } from "@/lib/entities/cv";
import { normEmail } from "@/lib/entities/emails";
import { isDocumentId, serveFile } from "@/lib/entities/serve-file";

export const dynamic = "force-dynamic";

/**
 * Opens a file found for an email address: a CV on one of its Contacts, on one
 * of their Cases, or attached to an email of such a Case. The list is gathered
 * live from Salesforce for that address, and only a document in it is served —
 * the document id alone opens nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ email: string; documentId: string }> }) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }

  const { email, documentId } = await params;
  let address: string | null = null;
  try {
    address = normEmail(decodeURIComponent(email));
  } catch {
    // A malformed percent-sequence is no address.
  }
  if (!address || !isDocumentId(documentId)) return new Response("Not found", { status: 404 });

  const { files } = await loadEmailCvs(address);
  const file = files.find((f) => f.documentId === documentId);
  if (!file) return new Response("Not found", { status: 404 });

  return serveFile(user.email, file, address);
}
