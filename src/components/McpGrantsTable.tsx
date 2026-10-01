import { disconnectGrant } from "@/app/(app)/connectors/actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { GrantRow } from "@/lib/mcp/grants";
import { Badge, buttonClass, formatDateTime, Table } from "./ui";

/** MCP connections, with a disconnect button on the live ones. `showUser` for the admin's list of everyone's. */
export function McpGrantsTable({ grants, showUser = false }: { grants: GrantRow[]; showUser?: boolean }) {
  const now = Date.now();
  return (
    <Table
      head={[...(showUser ? ["משתמש"] : []), "אפליקציה", "הרשאה", "חובר", "שימוש אחרון", "קריאות", "מצב", ""]}
      empty={grants.length === 0 ? "אין חיבורים" : undefined}
      caption="חיבורי MCP"
    >
      {grants.map((g) => {
        const expired = g.expiresAt.getTime() <= now;
        const live = !g.revokedAt && !expired;
        return (
          <tr key={g.id}>
            {showUser ? (
              <td className="px-3 py-2">
                <span className="block font-medium">{g.userName ?? g.userEmail}</span>
                <span className="block text-xs text-muted" dir="ltr">
                  {g.userEmail}
                </span>
              </td>
            ) : null}
            <td className="px-3 py-2 font-medium" dir="auto">
              {g.clientName}
            </td>
            <td className="px-3 py-2 text-sm">
              {g.effectiveRole ? ROLE_LABELS[g.effectiveRole] : "ללא גישה"}
              {g.effectiveRole !== g.maxRole ? <span className="block text-xs text-muted">תקרה שאושרה: {ROLE_LABELS[g.maxRole]}</span> : null}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-sm">{formatDateTime(g.createdAt)}</td>
            <td className="px-3 py-2 text-xs">
              <span className="whitespace-nowrap">{formatDateTime(g.lastUsedAt)}</span>
              {g.lastUsedIp ? (
                <span className="block text-muted" dir="ltr">
                  {g.lastUsedIp}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2">{g.calls.toLocaleString("he-IL")}</td>
            <td className="px-3 py-2">
              {g.revokedAt ? (
                <Badge>נותק</Badge>
              ) : expired ? (
                <Badge tone="warning">פג תוקף</Badge>
              ) : g.effectiveRole ? (
                <Badge tone="success">פעיל</Badge>
              ) : (
                <Badge tone="warning">המשתמש חסום</Badge>
              )}
            </td>
            <td className="px-3 py-2 text-end">
              {live ? (
                <form action={disconnectGrant}>
                  <input type="hidden" name="id" value={g.id} />
                  <button className={buttonClass("danger", "sm")}>
                    ניתוק
                    <span className="sr-only">
                      {" "}
                      {g.clientName}
                      {showUser ? ` של ${g.userEmail}` : ""}
                    </span>
                  </button>
                </form>
              ) : g.revokedAt ? (
                <span className="text-xs text-muted">{formatDateTime(g.revokedAt)}</span>
              ) : null}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
