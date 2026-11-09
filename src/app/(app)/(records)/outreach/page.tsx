import type { Metadata } from "next";
import { ClientRedirect } from "@/components/ClientRedirect";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { param, type SearchParams } from "@/lib/entities/search";

export const metadata: Metadata = { title: "משרות" };
export const dynamic = "force-dynamic";

/** The filters the old outreach list took; the jobs list reads them the same way. */
const KEYS = ["q", "status", "paid", "area", "napa", "sort", "dir", "page"];

/**
 * Outreach is part of the jobs list now (/positions: each row leads to /outreach/[id]).
 * Old links land here and go on to it with their filters.
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/outreach", search, KEYS));
  if (!auth.ok) return auth.render;

  const q = new URLSearchParams(KEYS.flatMap((k) => (param(search, k) ? [[k, param(search, k)]] : [])));
  const href = q.size ? `/positions?${q.toString()}` : "/positions";
  return (
    <>
      <h1 className="sr-only">משרות</h1>
      <ClientRedirect href={href} label="לרשימת המשרות, שבה נמצאת עכשיו הפעילות היזומה" />
    </>
  );
}
