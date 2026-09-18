import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, formatDateTime, NewTabNote, Table } from "@/components/ui";
import type { ActivityItem, ActivityKind } from "@/lib/entities/activity";
import type { ApplicationRow } from "@/lib/entities/applications";
import { fmtDate } from "@/lib/format";

/** The coloured header of an entity page, with its direct links. */
export function EntityHeader({
  back,
  title,
  subtitle,
  badges,
  links,
}: {
  back: { href: string; label: string };
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  links: { href: string | null; label: string; external?: boolean }[];
}) {
  return (
    <>
      <p className="mb-4">
        <Link href={back.href} className="text-sm font-medium text-accent-dark underline underline-offset-4">
          <span aria-hidden>→</span> {back.label}
        </Link>
      </p>
      <section className="mb-6 overflow-hidden rounded-card border-2 border-line">
        <header className="bg-accent px-6 py-4 text-white">
          <h1 className="text-2xl font-bold" dir="auto">
            {title}
          </h1>
          {subtitle ? <div className="text-white">{subtitle}</div> : null}
        </header>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-6 py-3 text-sm">
          {badges}
          <span className="ms-auto flex flex-wrap gap-4">
            {links
              .filter((l): l is { href: string; label: string; external?: boolean } => Boolean(l.href))
              .map((l) =>
                l.external ? (
                  <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                    {l.label}
                    <NewTabNote />
                  </a>
                ) : (
                  <Link key={l.label} href={l.href} className="font-medium text-accent-dark underline underline-offset-4">
                    {l.label}
                  </Link>
                ),
              )}
          </span>
        </div>
      </section>
    </>
  );
}

/** Label/value pairs; empty values are left out. */
export function FieldList({ items }: { items: [label: string, value: ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!shown.length) return <p className="text-muted">אין פרטים</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const KIND_LABEL: Record<ActivityKind, string> = {
  created: "נוצר",
  status: "סטטוס",
  owner: "מטפל",
  email: "מייל",
  call: "שיחה",
  task: "משימה",
};

export function Timeline({ items, empty = "לא נרשמה פעילות" }: { items: ActivityItem[]; empty?: string }) {
  if (!items.length) return <p className="text-muted">{empty}</p>;
  return (
    <ol className="flex flex-col divide-y divide-line">
      {items.map((item, i) => (
        <li key={`${item.at.getTime()}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
          <span className="w-36 shrink-0 text-xs tabular-nums text-muted">{formatDateTime(item.at)}</span>
          <Badge tone={item.kind === "call" || item.kind === "email" ? "accent" : item.kind === "status" ? "brand" : "neutral"}>
            {item.kind === "email" ? (item.incoming ? "מייל נכנס" : "מייל יוצא") : KIND_LABEL[item.kind]}
          </Badge>
          <span className="min-w-0 flex-1">
            <span className="font-medium" dir="auto">
              {item.title}
            </span>
            {item.detail ? (
              <span className="ms-2 text-xs text-muted" dir="auto">
                {item.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Applications, each linked to itself, its candidate and its job. */
export function ApplicationsTable({ rows, hide = [], empty = "אין הגשות" }: { rows: ApplicationRow[]; hide?: ("candidate" | "job")[]; empty?: string }) {
  const showCandidate = !hide.includes("candidate");
  const showJob = !hide.includes("job");
  return (
    <Table
      head={["הוגשה", ...(showCandidate ? ["מועמד"] : []), ...(showJob ? ["משרה"] : []), "סטטוס", "מטפל"]}
      empty={rows.length === 0 ? empty : undefined}
    >
      {rows.map((a) => (
        <tr key={a.id}>
          <td className="whitespace-nowrap px-3 py-2">
            <Link href={`/applications/${a.id}`} className="font-medium tabular-nums underline-offset-4 hover:underline">
              {fmtDate(a.createdAt)}
            </Link>
            <p className="text-xs tabular-nums text-muted">{a.caseNumber}</p>
          </td>
          {showCandidate ? (
            <td className="px-3 py-2">
              {a.candidateId ? (
                <Link href={`/candidates/${a.candidateId}`} className="font-medium underline-offset-4 hover:underline">
                  {a.candidateName ?? "(ללא שם)"}
                </Link>
              ) : (
                <span className="font-medium">{a.candidateName ?? "—"}</span>
              )}
              <p className="text-xs text-muted" dir="ltr">
                {a.candidateEmail ?? ""}
              </p>
            </td>
          ) : null}
          {showJob ? (
            <td className="px-3 py-2">
              {a.jobId ? (
                <Link href={`/positions/${a.jobId}`} className="underline-offset-4 hover:underline">
                  {a.jobTitle ?? "(ללא שם)"}
                </Link>
              ) : (
                <span>{a.jobTitle ?? "—"}</span>
              )}{" "}
              {a.paid ? <Badge tone="brand">בתשלום</Badge> : null}
              <p className="text-xs text-muted">{a.company ?? "—"}</p>
            </td>
          ) : null}
          <td className="px-3 py-2">
            {a.status ?? "—"}
          </td>
          <td className="px-3 py-2">{a.ownerName ?? "—"}</td>
        </tr>
      ))}
    </Table>
  );
}
