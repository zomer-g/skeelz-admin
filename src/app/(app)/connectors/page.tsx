import type { Metadata } from "next";
import { McpConnectInfo } from "@/components/McpConnectInfo";
import { McpGrantsTable } from "@/components/McpGrantsTable";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { hasRole, ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { listGrants } from "@/lib/mcp/grants";
import { MCP_ROLE_SCOPE } from "@/lib/mcp/roles";
import { TOOL_CATALOGUE } from "@/lib/mcp/tools";

export const metadata: Metadata = { title: "חיבור ל-Claude" };

export default async function ConnectorsPage() {
  const auth = await pageAuth("viewer", "/connectors");
  if (!auth.ok) return auth.render;
  const { user } = auth;

  const grants = await listGrants(user.id);

  return (
    <>
      <PageHeader title="חיבור ל-Claude (MCP)" subtitle="שאלות על הנתונים של המערכת ישירות מ-Claude, ChatGPT או כל אפליקציה שתומכת ב-MCP" />

      <div className="flex flex-col gap-8">
        <Card title="איך מתחברים">
          <McpConnectInfo />
          <p className="mt-6 text-sm text-muted">
            ההרשאה שלך כרגע: <strong className="text-ink">{ROLE_LABELS[user.role]}</strong>. ההרשאות של החיבור נקבעות לפי ההרשאות שלך במערכת ונבדקות מחדש בכל קריאה: אם אדמין משנה את ההרשאה שלך או חוסם את החשבון, החיבור משתנה או
            נחסם מיד. כל קריאה נרשמת ביומן הפעילות, כמו כניסה למסך. פרטי מועמדים שעוברים ל-Claude כפופים ל
            <a href="/privacy" className="font-medium text-accent-dark underline underline-offset-4">
              מדיניות הפרטיות
            </a>
            : משתמשים בהם רק לצורך העבודה.
          </p>
        </Card>

        <Card title="מה כל הרשאה מאפשרת">
          <Table head={["כלי", "תיאור", "הרשאה נדרשת", "אצלך"]} caption="כלי ה-MCP לפי הרשאה">
            {TOOL_CATALOGUE.map((t) => (
              <tr key={t.name}>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {t.name}
                </td>
                <td className="px-3 py-2 text-sm" dir="auto">
                  {t.title}
                  {t.writes ? <span className="ms-2 text-xs text-muted">(עריכה)</span> : null}
                </td>
                <td className="px-3 py-2 text-sm">{ROLE_LABELS[t.minRole]}</td>
                <td className="px-3 py-2">{hasRole(user.role, t.minRole) ? <Badge tone="success">זמין</Badge> : <Badge>לא זמין</Badge>}</td>
              </tr>
            ))}
          </Table>
          <ul className="mt-4 flex flex-col gap-1 text-sm text-muted">
            {ROLES.map((r) => (
              <li key={r}>
                <span className="font-medium text-ink">{ROLE_LABELS[r]}:</span> {MCP_ROLE_SCOPE[r]}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="החיבורים שלך">
          <McpGrantsTable grants={grants} />
        </Card>
      </div>
    </>
  );
}
