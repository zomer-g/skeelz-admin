"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/users", label: "משתמשים והרשאות" },
  { href: "/admin/integrations", label: "חיבורים" },
  { href: "/admin/salesforce", label: "Salesforce" },
  { href: "/admin/sync", label: "סנכרון" },
  { href: "/admin/audit", label: "יומן פעילות" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-8 flex flex-wrap gap-2 border-b-2 border-line pb-3">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-5 py-2 text-sm font-medium ${
              active ? "bg-ink text-white" : "bg-surface text-ink hover:bg-panel"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
