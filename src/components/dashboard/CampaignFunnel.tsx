import Link from "next/link";
import { BarList, type BarItem } from "@/components/dashboard/BarList";
import { Badge, Card, Table } from "@/components/ui";
import { formatDay } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent } from "@/lib/format";
import { CAMPAIGN_STAGES, campaignStageValues, type CampaignFunnelRow } from "@/lib/metrics/campaign-funnel";
import { campaignLabel } from "@/lib/metrics/campaigns";

const MAX_ROWS = 25;
const cell = (v: number | null) => (v == null ? <span className="text-muted">—</span> : fmtInt(v));

/**
 * The applications tab's campaign section: how many a message reached, opened and clicked
 * (SMOOV), and what those visits did on the site (GA4) — per campaign, and as a funnel for
 * the one picked (or all of them).
 */
export function CampaignFunnel({
  rows,
  selected,
  hrefFor,
  fromDay,
  toDay,
}: {
  rows: CampaignFunnelRow[];
  /** A campaign key, or "" for every campaign in the range. */
  selected: string;
  hrefFor: (key: string | null) => string;
  fromDay: string;
  toDay: string;
}) {
  const picked = selected ? rows.filter((r) => r.key === selected) : rows;
  const title = selected ? (picked[0] ? campaignLabel(picked[0]) : selected) : `כל הקמפיינים (${fmtInt(rows.length)})`;
  const values = campaignStageValues(picked);
  const stages = CAMPAIGN_STAGES.filter((s) => values[s.key] != null);
  const items: BarItem[] = stages.map((s, i) => {
    const v = values[s.key] ?? 0;
    const prev = i ? values[stages[i - 1]!.key] : null;
    return {
      label: s.label,
      value: v,
      color: s.source === "smoov" ? "var(--color-funnel-2)" : "var(--color-funnel-4)",
      note: prev ? `${fmtPercent(v, prev)} מהשלב הקודם` : undefined,
    };
  });
  const totals = campaignStageValues(rows);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card level={3} title={`המשפך: ${title}`}>
        {rows.length ? (
          <>
            <BarList items={items} caption={`המשפך של ${title}`} />
            {selected ? (
              <p className="mt-3 text-sm">
                <Link href={hrefFor(null)} scroll={false} className="font-medium text-accent-dark underline underline-offset-4">
                  חזרה לכל הקמפיינים
                </Link>
                {" · "}
                <Link href={`/campaigns/${encodeURIComponent(selected)}`} className="font-medium text-accent-dark underline underline-offset-4">
                  דף הקמפיין
                </Link>
              </p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
              <li>שלושת השלבים הראשונים מ-SMOOV, לכל שליחה (גם פתיחות שקרו אחרי הטווח). השאר מ-Google Analytics, רק בטווח.</li>
              <li>שלבי SMOOV מופיעים רק לדיוורים שמקושרים לקמפיין ב-SMOOV.</li>
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">אין קמפיינים עם כניסות לאתר בטווח הזה.</p>
        )}
      </Card>

      <Card level={3} title={`קמפיינים בטווח · ${fmtInt(rows.length)}`} className="xl:col-span-2" tone="accent-light">
        <Table
          caption={`קמפיינים ${formatDay(fromDay)} – ${formatDay(toDay)}`}
          head={["קמפיין", "יום שליחה", "נשלחו", "נפתחו", "הקליקו", "כניסות", "פתיחות משרות", "לחיצות הגשה", "אישורי הגשה", ""]}
          empty={rows.length === 0 ? "אין קמפיינים בטווח" : undefined}
        >
          {rows.slice(0, MAX_ROWS).map((r) => (
            <tr key={r.key} className={r.key === selected ? "bg-accent/10" : "hover:bg-white"}>
              <td className="px-3 py-2">
                <Link href={`/campaigns/${encodeURIComponent(r.key)}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {campaignLabel(r)}
                </Link>
                <span className="ms-2">{r.mailing ? <Badge tone="brand">דיוור · {r.medium}</Badge> : <Badge>{r.medium || "—"}</Badge>}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDay(r.sendDay)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(r.sent)}</td>
              <td className="px-3 py-2 tabular-nums">
                {cell(r.mailOpens)}
                {r.sent && r.mailOpens != null ? <span className="block text-xs text-muted">{fmtPercent(r.mailOpens, r.sent)}</span> : null}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {cell(r.mailClicks)}
                {r.sent && r.mailClicks != null ? <span className="block text-xs text-muted">{fmtPercent(r.mailClicks, r.sent)}</span> : null}
              </td>
              <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(r.sessions)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(r.opens)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(r.applyClicks)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(r.applyYes)}</td>
              <td className="px-3 py-2 text-end">
                {r.key === selected ? (
                  <span className="text-xs text-muted">מוצג</span>
                ) : (
                  <Link href={hrefFor(r.key)} scroll={false} className="whitespace-nowrap text-sm font-medium text-accent-dark underline underline-offset-4">
                    משפך<span className="sr-only"> של {campaignLabel(r)}</span>
                  </Link>
                )}
              </td>
            </tr>
          ))}
          {rows.length > 1 ? (
            <tr className="border-t-2 border-line font-bold">
              <td className="px-3 py-2">סה״כ</td>
              <td />
              <td className="px-3 py-2 tabular-nums">{cell(totals.sent)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.mailOpens)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.mailClicks)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.sessions)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.opens)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.applyClicks)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(totals.applyYes)}</td>
              <td />
            </tr>
          ) : null}
        </Table>
        {rows.length > MAX_ROWS ? <p className="mt-3 text-xs text-muted">מוצגים {MAX_ROWS} הקמפיינים עם הכי הרבה כניסות; הסה״כ כולל את כולם.</p> : null}
      </Card>
    </div>
  );
}
