import Link from "next/link";

const TABS = [
  { key: "candidates", label: "מועמדים", href: "/" },
  { key: "jobs", label: "משרות", href: "/jobs" },
  { key: "employers", label: "מעסיקים", href: "/employers" },
  { key: "marketing", label: "שיווק", href: "/marketing" },
  { key: "campaigns", label: "דיוורים", href: "/campaigns" },
] as const;

export type DashboardTab = (typeof TABS)[number]["key"];

/** `query` carries the date range across tabs so switching keeps the same slice. */
export function DashboardTabs({ active, query = "" }: { active: DashboardTab; query?: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b-2 border-black" aria-label="לשוניות הדשבורד">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const className = `-mb-[2px] rounded-t-card px-6 py-3 text-lg font-medium ${isActive ? "bg-accent text-white" : "text-ink hover:bg-accent/10"}`;
        return (
          <Link key={t.key} href={query ? `${t.href}?${query}` : t.href} aria-current={isActive ? "page" : undefined} className={className}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
