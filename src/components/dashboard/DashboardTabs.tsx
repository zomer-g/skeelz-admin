"use client";

import { SubNav } from "../SubNav";

const TABS = [
  { key: "summary", label: "תקציר מנהלים", href: "/" },
  { key: "candidates", label: "מועמדים", href: "/talent" },
  { key: "jobs", label: "משרות", href: "/jobs" },
  { key: "pipeline", label: "הגשות", href: "/pipeline" },
  { key: "employers", label: "מעסיקים", href: "/employers" },
  { key: "marketing", label: "שיווק", href: "/marketing" },
  { key: "campaigns", label: "דיוורים", href: "/campaigns" },
] as const;

export type DashboardTab = (typeof TABS)[number]["key"];

/**
 * `query` carries the date range across tabs so switching keeps the same slice.
 * The tabs stand in for the page title, so they also give the page its h1 —
 * except where the page has its own (a job, a campaign): pass `heading={false}`.
 */
export function DashboardTabs({ active, query = "", heading = true }: { active: DashboardTab; query?: string; heading?: boolean }) {
  const activeLabel = TABS.find((t) => t.key === active)?.label;
  return (
    <>
      {heading ? <h1 className="sr-only">דשבורד {activeLabel}</h1> : null}
      <SubNav section="דשבורד" ariaLabel="לשוניות הדשבורד" tabs={TABS} active={active} query={query} />
    </>
  );
}
