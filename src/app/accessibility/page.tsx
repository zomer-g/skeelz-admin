import type { Metadata } from "next";
import { PublicDoc } from "@/components/PublicDoc";
import { RichText } from "@/components/RichText";
import { fmtDate } from "@/lib/format";
import { findText } from "@/lib/texts/registry";
import { loadText } from "@/lib/texts/store";

export const metadata: Metadata = { title: "הצהרת נגישות" };
// The text is edited at /admin/texts and must show as soon as it is saved.
export const dynamic = "force-dynamic";

/** Public on purpose: the regulations require the statement to be reachable from every page, sign-in included. */
export default async function AccessibilityPage() {
  const def = findText("accessibility")!;
  const text = await loadText(def.key);
  return (
    <PublicDoc title={def.title} updated={text.updatedAt ? fmtDate(text.updatedAt) : def.defaultUpdated}>
      <RichText body={text.body} />
    </PublicDoc>
  );
}
