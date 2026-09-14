"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { PRESETS, type PresetKey } from "@/lib/dashboard/params";
import type { Basis } from "@/lib/metrics/candidates";

const BASES: { key: Basis; label: string; hint: string }[] = [
  { key: "application", label: "לפי תאריך הגשה", hint: "ההגשות שנוצרו בטווח, ומה קרה איתן" },
  { key: "event", label: "לפי תאריך אירוע", hint: "כל מה שקרה בטווח, לא משנה מתי הוגשה ההגשה" },
];

const segment = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`;

/**
 * One filter row above everything it scopes. While the next slice loads, the
 * previous render stays in place at reduced opacity — no skeleton, no jump.
 */
export function DashboardShell({
  preset,
  basis,
  fromDay,
  toDay,
  showBasis = true,
  search,
  children,
}: {
  preset: PresetKey;
  basis?: Basis;
  fromDay: string;
  toDay: string;
  showBasis?: boolean;
  search?: { value: string; placeholder: string };
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from: fromDay, to: toDay });
  const [q, setQ] = useState(search?.value ?? "");

  function go(next: { range?: PresetKey; basis?: Basis; q?: string }) {
    const range = next.range ?? preset;
    const params = new URLSearchParams({ range });
    if (showBasis) params.set("basis", next.basis ?? basis ?? "application");
    if (range === "custom") {
      params.set("from", custom.from);
      params.set("to", custom.to);
    }
    const query = (next.q ?? q).trim();
    if (search && query) params.set("q", query);
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-card border-2 border-line bg-surface p-4">
        {search ? (
          <form
            className="flex flex-wrap items-center gap-2"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              go({});
            }}
          >
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="h-10 min-w-[16rem] flex-1 rounded-full border border-field bg-white px-4 text-sm shadow-field focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
              חיפוש
            </button>
            {search.value ? (
              <button
                type="button"
                className="text-sm font-medium text-accent-dark underline underline-offset-4"
                onClick={() => {
                  setQ("");
                  go({ q: "" });
                }}
              >
                ניקוי
              </button>
            ) : null}
          </form>
        ) : null}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="טווח תאריכים">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" aria-pressed={preset === p.key} className={segment(preset === p.key)} onClick={() => go({ range: p.key })}>
              {p.label}
            </button>
          ))}
          {preset === "custom" ? (
            <span className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="מתאריך"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-9 rounded-full border border-field bg-white px-3 text-sm"
              />
              <span className="text-muted">עד</span>
              <input
                type="date"
                aria-label="עד תאריך"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-9 rounded-full border border-field bg-white px-3 text-sm"
              />
              <button type="button" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" onClick={() => go({ range: "custom" })}>
                הצגה
              </button>
            </span>
          ) : null}
        </div>
        {showBasis ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="בסיס התאריך">
            {BASES.map((b) => (
              <button key={b.key} type="button" aria-pressed={basis === b.key} title={b.hint} className={segment(basis === b.key)} onClick={() => go({ basis: b.key })}>
                {b.label}
              </button>
            ))}
            <span className="text-xs text-muted">{BASES.find((b) => b.key === basis)?.hint}</span>
          </div>
        ) : null}
      </div>
      <div aria-busy={pending} className={`transition-opacity ${pending ? "opacity-50" : "opacity-100"}`}>
        {children}
      </div>
    </>
  );
}
