import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Explained } from "./Explained";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "border border-brand bg-white text-brand hover:bg-brand/5",
  quiet: "bg-transparent text-accent-dark hover:bg-accent/10",
  danger: "border border-danger bg-white text-danger hover:bg-danger/5",
};

/** Pill buttons, as on the public site. `size="sm"` for table rows. Heights are minimums, so a wrapped label grows the pill. */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const sizing = size === "md" ? "min-h-12 px-6 py-2 text-base" : "min-h-9 px-4 py-1 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-full text-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON[variant]}`;
}

// `outline-hidden`, not `outline-none`: Windows High Contrast drops the ring but keeps a transparent outline visible.
export const fieldClass =
  "h-12 rounded-full border border-field bg-white px-5 text-base text-ink shadow-field placeholder:text-muted focus:outline-hidden focus:ring-2 focus:ring-accent";

export const smallFieldClass =
  "h-9 rounded-full border border-field bg-white px-3 text-sm text-ink placeholder:text-muted focus:outline-hidden focus:ring-2 focus:ring-accent";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/**
 * A two-tone card: a teal title band over a light grey body. The title is a
 * heading — `level={3}` for cards that sit under a section's h2.
 */
export function Card({
  title,
  tone = "accent",
  level = 2,
  children,
  className = "",
}: {
  title?: ReactNode;
  tone?: "accent" | "accent-light";
  level?: 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`overflow-hidden rounded-card border-2 border-line bg-surface ${className}`}>
      {title ? (
        // White on the light teal is 2:1, so that band takes ink text.
        <header className={`${tone === "accent" ? "bg-accent text-white" : "bg-accent-light text-ink"} px-6 py-3`}>
          <Heading className="text-lg font-medium">{title}</Heading>
        </header>
      ) : null}
      <div className="p-6">{children}</div>
    </section>
  );
}

/** A headline figure. `info` says what it counts — shown on hover, focus or tap (see Explained). */
export function StatCard({ label, value, hint, info }: { label: string; value: ReactNode; hint?: string; info?: string }) {
  const card = (
    <div className="flex h-full overflow-hidden rounded-card border-2 border-line bg-surface">
      <div className="flex w-2 shrink-0 bg-accent" aria-hidden />
      <div className="flex flex-1 flex-col gap-1 px-5 py-4">
        <span className={`text-sm font-medium text-muted ${info ? "pe-8" : ""}`}>{label}</span>
        <span className="text-3xl font-bold text-ink">{value}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </div>
  );
  return info ? (
    <Explained label={label} text={info}>
      {card}
    </Explained>
  ) : (
    card
  );
}

type BadgeTone = "success" | "neutral" | "brand" | "accent" | "warning";

const BADGE: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  neutral: "bg-panel text-muted",
  brand: "bg-brand/10 text-brand-hover",
  accent: "bg-accent/10 text-accent-dark",
  warning: "bg-hot/30 text-[#93370d]",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}

/**
 * Gives every cell its column heading as `data-label`, which the phone layout
 * (`.table-cards` in globals.css) shows beside the value. Rows are the `<tr>`
 * children; conditionally skipped cells (null) don't shift the headings.
 */
function labelCells(children: ReactNode, head: readonly HeadCell[]): ReactNode {
  const labels = head.map(headLabel);
  return Children.map(children, (row) => {
    if (!isValidElement<{ children?: ReactNode }>(row) || row.type !== "tr") return row;
    let column = 0;
    const cells = Children.map(row.props.children, (cell) =>
      isValidElement(cell) ? cloneElement(cell as ReactElement<Record<string, unknown>>, { "data-label": labels[column++] ?? "" }) : cell,
    );
    return cloneElement(row, {}, cells);
  });
}

/**
 * Wide screens: a table that scrolls inside its own box so the page never scrolls
 * sideways (the box takes focus so a keyboard can scroll it too). Phones: each row
 * becomes a card, its first cell as the title and every other value beside its
 * column heading. An empty column head is read as "פעולות".
 */
export function Table({
  head,
  children,
  empty,
  caption,
  sort,
}: {
  head: readonly HeadCell[];
  children: ReactNode;
  empty?: string;
  caption?: string;
  /** Makes the columns that carry a `sort` key into sorting links. */
  sort?: TableSort;
}) {
  return (
    // `relative` keeps visually-hidden text (absolutely positioned) inside the scroll box instead of widening the page.
    <div className="table-cards relative overflow-x-auto" tabIndex={0} role={caption ? "region" : undefined} aria-label={caption}>
      {sort ? <SortBar head={head} sort={sort} /> : null}
      <table className="w-full min-w-[40rem] border-collapse text-start text-sm max-sm:min-w-0">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b-2 border-line text-muted">
            {head.map((cell, i) => {
              const label = headLabel(cell);
              const key = typeof cell === "string" ? undefined : cell.sort;
              const active = sort && key === sort.key;
              return (
                <th
                  key={label || `col-${i}`}
                  scope="col"
                  className="px-3 py-2 text-start font-medium"
                  aria-sort={!sort || !key ? undefined : active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {sort && key ? <SortLink label={label} column={key} sort={sort} active={!!active} /> : label || <span className="sr-only">פעולות</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{labelCells(children, head)}</tbody>
      </table>
      {empty ? <p className="px-3 py-6 text-center text-muted">{empty}</p> : null}
    </div>
  );
}

/** One column heading: a plain label, or a label that sorts the list by `sort`. */
export type HeadCell = string | { label: string; sort?: string };

export interface TableSort {
  /** The column the list is sorted by now. */
  key: string;
  dir: "asc" | "desc";
  /** Where a click on `column` goes: the same search, sorted by it. */
  href: (column: string) => string;
  /** What each direction is called for this column, e.g. "מהחדש לישן" — read by screen readers. */
  dirLabel: (column: string, dir: "asc" | "desc") => string;
}

const headLabel = (cell: HeadCell) => (typeof cell === "string" ? cell : cell.label);

/**
 * Phones hide the column headings (each row is a card), so the same sorting
 * lives here as a row of pills above the cards.
 */
function SortBar({ head, sort }: { head: readonly HeadCell[]; sort: TableSort }) {
  const columns = head.filter((c): c is { label: string; sort: string } => typeof c !== "string" && !!c.sort);
  if (!columns.length) return null;
  return (
    <nav aria-label="מיון הרשימה" className="mb-3 flex flex-wrap items-center gap-2 text-xs sm:hidden">
      <span className="text-muted">מיון:</span>
      {columns.map((c) => {
        const active = c.sort === sort.key;
        return (
          <Link
            key={c.sort}
            href={sort.href(c.sort)}
            className={`rounded-full px-3 py-1 ${active ? "bg-accent/10 font-medium text-accent-dark" : "bg-panel text-muted"}`}
          >
            {c.label}
            {active ? <span aria-hidden="true"> {sort.dir === "asc" ? "▲" : "▼"}</span> : null}
            <span className="sr-only">
              {active ? ` · ממוין ${sort.dirLabel(c.sort, sort.dir)} · מיון ${sort.dirLabel(c.sort, sort.dir === "asc" ? "desc" : "asc")}` : ""}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SortLink({ label, column, sort, active }: { label: string; column: string; sort: TableSort; active: boolean }) {
  // The arrow is decorative: the direction is also said in words for screen readers.
  const arrow = !active ? "" : sort.dir === "asc" ? "▲" : "▼";
  const next = active ? (sort.dir === "asc" ? "desc" : "asc") : null;
  return (
    <Link href={sort.href(column)} className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:underline">
      <span className={active ? "text-ink" : undefined}>{label}</span>
      {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      <span className="sr-only">
        {active ? `ממוין ${sort.dirLabel(column, sort.dir)} · מיון ${sort.dirLabel(column, next!)}` : `מיון לפי ${label}`}
      </span>
    </Link>
  );
}

/** Screen-reader-only text for links that open a new tab. */
export function NewTabNote() {
  return <span className="sr-only"> (נפתח בלשונית חדשה)</span>;
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(value);
}
