import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { fmtInt } from "@/lib/format";
import { findText, ORIGINAL_AUTHOR } from "@/lib/texts/registry";
import { loadText, loadVersions } from "@/lib/texts/store";
import { AdminTabs } from "../../AdminTabs";
import { restoreVersion } from "../actions";
import { TextEditor } from "../TextEditor";

export const metadata: Metadata = { title: "עריכת טקסט" };
export const dynamic = "force-dynamic";

export default async function EditTextPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const text = findText(key);
  if (!text) notFound();
  const auth = await pageAuth("admin", `/admin/texts/${key}`);
  if (!auth.ok) return auth.render;

  const [current, versions] = await Promise.all([loadText(key), loadVersions(key)]);

  return (
    <>
      <PageHeader title="ניהול" subtitle={`עריכת ${text.title}`} />
      <AdminTabs />
      <p className="mb-4">
        <Link href="/admin/texts" className="text-sm font-medium text-accent-dark underline underline-offset-4">
          <span aria-hidden>→</span> כל הטקסטים
        </Link>
      </p>

      <Card title={text.title}>
        <p className="mb-4 text-sm text-muted">
          {text.description}{" "}
          {current.updatedAt ? `עודכן לאחרונה ${formatDateTime(current.updatedAt)} על ידי ${current.updatedBy}.` : "עדיין מוצג הנוסח המקורי."} השמירה מתפרסמת מיד.
        </p>
        <TextEditor textKey={text.key} title={text.title} path={text.path} savedBody={current.body} />
      </Card>

      <Card title="גרסאות קודמות" tone="accent-light" className="mt-6">
        <Table head={["נשמרה", "על ידי", "אורך", ""]} empty={versions.length === 0 ? "עוד לא נשמרו גרסאות. הגרסה הראשונה תישמר עם העריכה הראשונה." : undefined}>
          {versions.map((v, i) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(v.savedAt)}</td>
              <td className="px-3 py-2" dir={v.savedBy === ORIGINAL_AUTHOR ? undefined : "ltr"}>
                {v.savedBy}
              </td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(v.length)} תווים</td>
              <td className="px-3 py-2 text-end">
                {i === 0 ? (
                  <span className="text-sm text-muted">הנוסח הנוכחי</span>
                ) : (
                  <form action={restoreVersion}>
                    <input type="hidden" name="key" value={text.key} />
                    <input type="hidden" name="versionId" value={v.id} />
                    <button className={buttonClass("secondary", "sm")}>
                      שחזור<span className="sr-only"> · הגרסה מ-{formatDateTime(v.savedAt)}</span>
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">שחזור שומר את הגרסה שנבחרה כנוסח הנוכחי. שום גרסה לא נמחקת, כך שאפשר תמיד לחזור.</p>
      </Card>
    </>
  );
}
