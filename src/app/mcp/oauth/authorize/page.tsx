import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { PublicDocLinks } from "@/components/PublicDoc";
import { pageAuth } from "@/lib/auth/guard";
import { hasRole, ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import type { SearchParams } from "@/lib/entities/search";
import { publicOrigin } from "@/lib/mcp/config";
import { checkAuthorizeRequest } from "@/lib/mcp/oauth";
import { ConsentForm } from "./ConsentForm";

export const metadata: Metadata = { title: "אישור חיבור ל-MCP" };

const PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"] as const;

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.svg" alt="SKEELZ" width={128} height={72} />
      <div className="w-full max-w-lg overflow-hidden rounded-modal border-2 border-line">
        <h1 className="bg-accent px-8 py-6 text-center text-2xl font-medium text-white">{title}</h1>
        <div className="flex flex-col gap-6 bg-surface px-6 py-8 sm:px-8">{children}</div>
      </div>
      <PublicDocLinks className="justify-center" />
    </main>
  );
}

/**
 * The OAuth authorization endpoint of the MCP server. The person signs in with the site's own
 * Google sign-in (an anonymous visitor gets the sign-in screen and comes back here), sees which
 * application asks for access, and approves it with a role no higher than their own.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const params: Record<string, string> = {};
  for (const k of PARAMS) {
    const v = search[k];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) params[k] = value;
  }

  const origin = publicOrigin(await headers());
  const check = await checkAuthorizeRequest(params, origin);
  if (!check.ok) {
    return (
      <Frame title="לא ניתן להשלים את החיבור">
        <p role="alert" className="text-center">
          {check.message}
        </p>
      </Frame>
    );
  }

  const auth = await pageAuth("viewer", `/mcp/oauth/authorize?${new URLSearchParams(params).toString()}`);
  if (!auth.ok) return auth.render;
  const { user } = auth;
  const req = check.request;
  const roles = ROLES.filter((r) => hasRole(user.role, r));

  return (
    <Frame title="אישור חיבור ל-MCP">
      <p>
        האפליקציה <strong dir="auto">{req.clientName}</strong> מבקשת לקרוא נתונים ממערכת הניהול של SKEELZ בשמך, ובהרשאות שלך.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">מחובר/ת בתור</dt>
        <dd dir="ltr" className="text-start font-medium">
          {user.email}
        </dd>
        <dt className="text-muted">ההרשאה שלך במערכת</dt>
        <dd className="font-medium">{ROLE_LABELS[user.role]}</dd>
        <dt className="text-muted">חזרה לכתובת</dt>
        <dd dir="ltr" className="text-start font-medium break-all">
          {new URL(req.redirectUri).host}
        </dd>
      </dl>
      <p className="text-sm text-muted">
        החיבור יפעל לכל היותר בהרשאה שתבחר/י כאן, ותמיד לא מעבר להרשאה שלך במערכת: אם ההרשאה שלך תשתנה או תבוטל, החיבור ישתנה איתה מיד. כל
        פעולה של החיבור נרשמת ביומן הפעילות. אפשר לנתק אותו בכל עת בעמוד &quot;חיבור ל-Claude&quot;.
      </p>
      <ConsentForm params={params} roles={roles} defaultRole={user.role} />
    </Frame>
  );
}
