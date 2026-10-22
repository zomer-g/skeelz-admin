"use client";

import { usePathname } from "next/navigation";
import { SubNav } from "@/components/SubNav";

const TABS = [
  { key: "applications", label: "הגשות", href: "/applications" },
  { key: "companies", label: "מעסיקים", href: "/companies" },
  { key: "positions", label: "משרות", href: "/positions" },
  { key: "candidates", label: "מועמדים", href: "/candidates" },
  { key: "emails", label: "כתובות דוא״ל", href: "/emails" },
  { key: "cvs", label: "קורות חיים", href: "/cvs" },
  { key: "outreach", label: "פעילות יזומה", href: "/outreach" },
  { key: "leads", label: "לידי מעסיקים", href: "/leads" },
  { key: "payments", label: "מעקב תשלומים", href: "/payments" },
] as const;

/** Which tab a path belongs to: the jobs list and every job card (/positions) are under משרות. */
function activeTab(pathname: string): string {
  if (pathname.startsWith("/positions")) return "positions";
  if (pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/candidates")) return "candidates";
  if (pathname.startsWith("/emails")) return "emails";
  if (pathname.startsWith("/payments")) return "payments";
  if (pathname.startsWith("/cvs")) return "cvs";
  if (pathname.startsWith("/outreach")) return "outreach";
  if (pathname.startsWith("/leads")) return "leads";
  return "applications";
}

export function RecordsTabs() {
  return <SubNav section="רשומות" ariaLabel="לשוניות הרשומות" tabs={TABS} active={activeTab(usePathname())} />;
}
