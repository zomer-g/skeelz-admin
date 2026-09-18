"use client";

import { usePathname } from "next/navigation";
import { SubNav } from "@/components/SubNav";

const TABS = [
  { key: "applications", label: "הגשות", href: "/applications" },
  { key: "companies", label: "מעסיקים", href: "/companies" },
  { key: "candidates", label: "מועמדים", href: "/candidates" },
] as const;

/** Which tab a path belongs to: a job card (/positions) lives under its employer. */
function activeTab(pathname: string): string {
  if (pathname.startsWith("/positions") || pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/candidates")) return "candidates";
  return "applications";
}

export function RecordsTabs() {
  return <SubNav section="רשומות" ariaLabel="לשוניות הרשומות" tabs={TABS} active={activeTab(usePathname())} />;
}
