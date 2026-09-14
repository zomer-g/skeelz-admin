"use client";

import Link from "next/link";
import { useRef } from "react";
import { useActiveInStrip } from "../useActiveInStrip";

const TABS = [
  { key: "candidates", label: "מועמדים", href: "/" },
  { key: "jobs", label: "משרות", href: "/jobs" },
  { key: "employers", label: "מעסיקים", href: "/employers" },
  { key: "marketing", label: "שיווק", href: "/marketing" },
  { key: "campaigns", label: "דיוורים", href: "/campaigns" },
] as const;

export type DashboardTab = (typeof TABS)[number]["key"];

/**
 * `query` carries the date range across tabs so switching keeps the same slice.
 * The tabs stand in for the page title, so they also give the page its h1 —
 * except where the page has its own (a job, a campaign): pass `heading={false}`.
 * On phones the tabs scroll sideways in one row instead of wrapping.
 */
export function DashboardTabs({ active, query = "", heading = true }: { active: DashboardTab; query?: string; heading?: boolean }) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useActiveInStrip(activeRef, active);
  const activeLabel = TABS.find((t) => t.key === active)?.label;

  return (
    <>
      {heading ? <h1 className="sr-only">דשבורד {activeLabel}</h1> : null}
      <nav
        className="mb-6 flex gap-1 overflow-x-auto px-1 pt-1 [scrollbar-width:thin] shadow-[inset_0_-2px_0_0_#000] sm:flex-wrap sm:overflow-visible sm:px-0 sm:pt-0"
        aria-label="לשוניות הדשבורד"
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          const className = `shrink-0 whitespace-nowrap rounded-t-card px-4 py-2.5 text-base font-medium sm:px-6 sm:py-3 sm:text-lg ${isActive ? "bg-accent text-white" : "text-ink hover:bg-accent/10"}`;
          return (
            <Link
              key={t.key}
              ref={isActive ? activeRef : undefined}
              href={query ? `${t.href}?${query}` : t.href}
              aria-current={isActive ? "page" : undefined}
              className={className}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
