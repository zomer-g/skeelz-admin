import Link from "next/link";
import { buttonClass, smallFieldClass } from "@/components/ui";
import { fmtInt } from "@/lib/format";

/**
 * Advanced search for an entity list: a plain GET form, so every search is a
 * URL that can be shared, bookmarked and walked back with the browser.
 * Submitting drops the page number, so a new search starts at page one.
 */

export type FilterField =
  | { kind: "text"; name: string; label: string; placeholder?: string; wide?: boolean }
  | { kind: "select"; name: string; label: string; options: (string | { value: string; label: string })[]; any?: string }
  | { kind: "date"; name: string; label: string }
  | { kind: "check"; name: string; label: string };

export function SearchForm({
  action,
  fields,
  values,
  hidden = {},
}: {
  action: string;
  fields: FilterField[];
  values: Record<string, string>;
  /** Parameters kept across searches without being form fields (a job, a candidate …). */
  hidden?: Record<string, string>;
}) {
  const active = fields.some((f) => values[f.name]);
  const clearQuery = new URLSearchParams(Object.entries(hidden).filter(([, v]) => v)).toString();
  return (
    <form method="get" action={action} role="search" className="mb-6 rounded-card border-2 border-line bg-surface p-4">
      {Object.entries(hidden)
        .filter(([, v]) => v)
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((f) => {
          const id = `f-${f.name}`;
          if (f.kind === "check") {
            return (
              <label key={f.name} htmlFor={id} className="flex items-center gap-2 self-end pb-2 text-sm">
                <input id={id} type="checkbox" name={f.name} value="1" defaultChecked={values[f.name] === "1"} className="size-4 accent-[var(--color-accent)]" />
                {f.label}
              </label>
            );
          }
          return (
            <div key={f.name} className={`flex flex-col gap-1 ${f.kind === "text" && f.wide ? "sm:col-span-2" : ""}`}>
              <label htmlFor={id} className="text-xs font-medium text-muted">
                {f.label}
              </label>
              {f.kind === "text" ? (
                <input id={id} type="search" name={f.name} defaultValue={values[f.name] ?? ""} placeholder={f.placeholder} className={smallFieldClass} />
              ) : f.kind === "date" ? (
                <input id={id} type="date" name={f.name} defaultValue={values[f.name] ?? ""} className={smallFieldClass} />
              ) : (
                <select id={id} name={f.name} defaultValue={values[f.name] ?? ""} className={smallFieldClass}>
                  <option value="">{f.any ?? "הכל"}</option>
                  {f.options.map((o) => {
                    const opt = typeof o === "string" ? { value: o, label: o } : o;
                    return (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass("primary", "sm")}>
          חיפוש
        </button>
        {active ? (
          <Link href={clearQuery ? `${action}?${clearQuery}` : action} className="text-sm font-medium text-accent-dark underline underline-offset-4">
            ניקוי הסינון
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** Previous / next links that keep every filter. */
export function Pager({ action, values, page, pageSize, total }: { action: string; values: Record<string, string>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(values).filter(([, v]) => v));
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${action}?${s}` : action;
  };
  return (
    <nav aria-label="דפים" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">
        עמוד {fmtInt(page)} מתוך {fmtInt(pages)} · {fmtInt(total)} תוצאות
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>
            → הקודם
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>
            הבא ←
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
