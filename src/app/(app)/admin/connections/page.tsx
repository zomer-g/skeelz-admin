import type { Metadata } from "next";
import { Badge, Card, formatDateTime, PageHeader } from "@/components/ui";
import { PEER_LABELS, PEERS } from "@/lib/api/spec";
import { pageAuth } from "@/lib/auth/guard";
import { connectSecretConfigured } from "@/lib/connect/crypto";
import { getDb } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { AdminTabs } from "../AdminTabs";
import { CheckButton, ConnectionForm } from "./ConnectionForms";

export const metadata: Metadata = { title: "חיבורים" };

/** Placeholders for a first setup: the other apps' public addresses. */
const SUGGESTED_URL = { crm: "https://skeelz-crm-zomerg.xhostd.app", site: "https://skeelz-site-zomerg.xhostd.app" } as const;

export default async function ConnectionsPage() {
  const auth = await pageAuth("admin", "/admin/connections");
  if (!auth.ok) return auth.render;

  // Never select the ciphertext: nothing about the key but its last 4 characters reaches the page.
  const rows = await getDb()
    .select({
      peer: connections.peer,
      baseUrl: connections.baseUrl,
      keyLast4: connections.keyLast4,
      enabled: connections.enabled,
      updatedBy: connections.updatedBy,
      updatedAt: connections.updatedAt,
      lastCheckAt: connections.lastCheckAt,
      lastCheckOk: connections.lastCheckOk,
      lastCheckDetail: connections.lastCheckDetail,
    })
    .from(connections);
  const byPeer = new Map(rows.map((r) => [r.peer, r]));
  const secretOk = connectSecretConfigured();

  return (
    <>
      <PageHeader title="ניהול · חיבורים" subtitle="איך המערכת הזו פונה למערכות SKEELZ האחרות" />
      <AdminTabs />

      <p className="mb-6 max-w-3xl text-muted">
        לכל מערכת: הכתובת שלה, והמפתח שהיא הנפיקה לנו במסך &quot;API ומפתחות&quot; שלה. המפתח נשמר מוצפן, ולא מוצג שוב. &quot;בדיקת חיבור&quot; פונה
        ל-<code dir="ltr">/api/v1/ping</code> של המערכת השנייה ומראה את הגרסה שלה ואת ההרשאות שיש למפתח שלנו שם.
      </p>
      {!secretOk ? (
        <p role="note" className="mb-6 rounded-card bg-danger-soft/40 px-4 py-3 text-sm text-danger">
          CONNECT_SECRET_KEY לא מוגדר בשרת (64 תווים הקסדצימליים), ולכן אי אפשר לשמור מפתחות או להשתמש בהם.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {PEERS.map((peer) => {
          const row = byPeer.get(peer);
          const label = PEER_LABELS[peer];
          return (
            <Card key={peer} title={label} tone={row ? "accent" : "accent-light"}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  {row ? row.enabled ? <Badge tone="success">פעיל</Badge> : <Badge>כבוי</Badge> : <Badge>לא הוגדר</Badge>}
                  {row?.lastCheckAt ? (
                    row.lastCheckOk ? (
                      <Badge tone="success">הבדיקה האחרונה הצליחה</Badge>
                    ) : (
                      <Badge tone="warning">הבדיקה האחרונה נכשלה</Badge>
                    )
                  ) : null}
                </div>
                {row ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">עודכן</dt>
                    <dd>
                      {formatDateTime(row.updatedAt)} ·{" "}
                      <span dir="ltr" className="break-all">
                        {row.updatedBy}
                      </span>
                    </dd>
                    <dt className="text-muted">בדיקה אחרונה</dt>
                    <dd>
                      {formatDateTime(row.lastCheckAt)}
                      {row.lastCheckDetail ? (
                        <span dir="ltr" className="block break-all text-xs text-muted">
                          {row.lastCheckDetail}
                        </span>
                      ) : null}
                    </dd>
                  </dl>
                ) : null}
                <ConnectionForm
                  peer={peer}
                  label={label}
                  baseUrl={row?.baseUrl ?? SUGGESTED_URL[peer]}
                  keyLast4={row?.keyLast4 ?? null}
                  enabled={row?.enabled ?? true}
                />
                <CheckButton peer={peer} label={label} disabled={!row || !row.enabled || !secretOk} />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
