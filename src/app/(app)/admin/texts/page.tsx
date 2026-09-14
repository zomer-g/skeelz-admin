import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { TEXTS } from "@/lib/texts/registry";
import { loadSavedTexts } from "@/lib/texts/store";
import { AdminTabs } from "../AdminTabs";

export const metadata: Metadata = { title: "טקסטים" };
export const dynamic = "force-dynamic";

export default async function TextsPage() {
  const auth = await pageAuth("admin", "/admin/texts");
  if (!auth.ok) return auth.render;

  const saved = new Map((await loadSavedTexts()).map((t) => [t.key, t]));

  return (
    <>
      <PageHeader title="ניהול" subtitle="נוסחים שמוצגים בעמודי המערכת, ואפשר לערוך בלי שינוי בקוד" />
      <AdminTabs />
      <Card title="טקסטים">
        <Table head={["טקסט", "עמוד", "עודכן", ""]}>
          {TEXTS.map((t) => {
            const row = saved.get(t.key);
            return (
              <tr key={t.key}>
                <td className="px-3 py-2">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted">{t.description}</p>
                </td>
                <td className="px-3 py-2" dir="ltr">
                  <a href={t.path} className="text-accent-dark underline underline-offset-4">
                    {t.path}
                  </a>
                </td>
                <td className="px-3 py-2 text-sm">
                  {row ? (
                    <>
                      {formatDateTime(row.updatedAt)}
                      <p className="text-xs text-muted" dir="ltr">
                        {row.updatedBy}
                      </p>
                    </>
                  ) : (
                    <Badge>הנוסח המקורי</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-end">
                  <Link href={`/admin/texts/${t.key}`} className="font-medium text-accent-dark underline underline-offset-4">
                    עריכה<span className="sr-only"> · {t.title}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
