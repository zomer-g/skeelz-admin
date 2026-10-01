import type { Metadata } from "next";
import Link from "next/link";
import { McpGrantsTable } from "@/components/McpGrantsTable";
import { Card, PageHeader } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { listGrants } from "@/lib/mcp/grants";
import { AdminTabs } from "../AdminTabs";

export const metadata: Metadata = { title: "חיבורי MCP" };

export default async function AdminMcpPage() {
  const auth = await pageAuth("admin", "/admin/mcp");
  if (!auth.ok) return auth.render;

  const grants = await listGrants();

  return (
    <>
      <PageHeader title="ניהול · חיבורי MCP" subtitle="אפליקציות AI שמשתמשים חיברו למערכת, ובאיזו הרשאה" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title={`חיבורים (${grants.length})`}>
          <p className="mb-4 text-sm text-muted">
            כל חיבור פועל בהרשאה של המשתמש במערכת, ולכל היותר בתקרה שהמשתמש אישר. שינוי הרשאה או חסימה ב
            <Link href="/admin/users" className="font-medium text-accent-dark underline underline-offset-4">
              משתמשים והרשאות
            </Link>{" "}
            חלים על החיבורים מיד. הקריאות עצמן מופיעות ב
            <Link href="/admin/audit" className="font-medium text-accent-dark underline underline-offset-4">
              יומן הפעילות
            </Link>{" "}
            (פעולות <span dir="ltr">mcp.*</span>).
          </p>
          <McpGrantsTable grants={grants} showUser />
        </Card>
      </div>
    </>
  );
}
