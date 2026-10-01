"use server";

import { headers } from "next/headers";
import { writeAudit } from "@/lib/audit";
import { hasRole, isRole } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/mcp/config";
import { checkAuthorizeRequest, issueCode, redirectBack } from "@/lib/mcp/oauth";

/** `redirect` is where the browser goes next: back to the client, with a code or with access_denied. */
export type DecisionState = { message: string; redirect?: string } | null;

const PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"] as const;

/**
 * Approve or refuse a connection. A server action is a public endpoint, so the request is
 * checked again from scratch, and the role ceiling may not exceed the person's own role.
 */
export async function decideConnection(_prev: DecisionState, form: FormData): Promise<DecisionState> {
  const user = await requireUser("viewer");
  const origin = publicOrigin(await headers());
  const params = Object.fromEntries(PARAMS.map((k) => [k, form.get(k)?.toString() || undefined]));
  const check = await checkAuthorizeRequest(params, origin);
  if (!check.ok) return { message: check.message };
  const req = check.request;

  if (form.get("decision") !== "approve") {
    await writeAudit(user.email, "mcp.refused", req.clientName, { clientId: req.clientId });
    return { message: "החיבור נדחה. חוזרים לאפליקציה…", redirect: redirectBack(req, origin, { error: "access_denied" }) };
  }

  const role = form.get("role");
  if (!isRole(role) || !hasRole(user.role, role)) return { message: "יש לבחור הרשאה שאינה גבוהה מההרשאה שלך במערכת." };
  const code = await issueCode(req, user.id, role);
  await writeAudit(user.email, "mcp.authorized", req.clientName, {
    clientId: req.clientId,
    maxRole: role,
    redirectHost: new URL(req.redirectUri).host,
  });
  return { message: "החיבור אושר. חוזרים לאפליקציה…", redirect: redirectBack(req, origin, { code }) };
}
