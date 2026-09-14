import type { Metadata } from "next";
import { PublicDoc } from "@/components/PublicDoc";
import { RichText } from "@/components/RichText";
import { fmtDate } from "@/lib/format";
import { findText } from "@/lib/texts/registry";
import { loadText } from "@/lib/texts/store";

export const metadata: Metadata = { title: "מדיניות פרטיות" };
// The text is edited at /admin/texts and must show as soon as it is saved.
export const dynamic = "force-dynamic";

/** Public on purpose, like the accessibility statement: it is linked from the sign-in screen. */
export default async function PrivacyPage() {
  const def = findText("privacy")!;
  const text = await loadText(def.key);
  return (
    <PublicDoc title={def.title} updated={text.updatedAt ? fmtDate(text.updatedAt) : def.defaultUpdated}>
      <RichText body={text.body} />
    </PublicDoc>
  );
}
