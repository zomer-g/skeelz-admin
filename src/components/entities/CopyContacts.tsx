"use client";

import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Hands over the contact details behind the current search — every match, not
 * the page on screen. Emails come back comma-separated (what a mail client's
 * "To" field wants) and phones one per line (what a spreadsheet or a calling
 * round wants). When the browser refuses the clipboard, the list is shown in a
 * box to copy by hand instead of failing silently.
 */
export function CopyContacts({
  query,
  total,
  endpoint = "/api/candidates/contacts",
  subject,
}: {
  query: string;
  total: number;
  /** The route that answers with the values; it takes the list's own query parameters. */
  endpoint?: string;
  /** What the buttons hand over, e.g. "האנשים של כל 120 הקבצים בחיפוש". */
  subject?: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"email" | "phone" | null>(null);
  const [fallback, setFallback] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  async function copy(field: "email" | "phone") {
    setBusy(field);
    setMessage("");
    setFallback("");
    try {
      const res = await fetch(`${endpoint}?${query}${query ? "&" : ""}field=${field}`, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        // The day's export budget is gone; the server says so in words, and the admins were told.
        setMessage(await res.text());
        return;
      }
      if (!res.ok) throw new Error(res.status === 401 ? "signed out" : `status ${res.status}`);
      const data: { values: string[]; label: string; count: number; truncated: boolean; limit: number; limited?: boolean; left_out?: number } =
        await res.json();
      if (!data.count) {
        setMessage(data.limited ? "הגעת למגבלת הייצוא היומית; מנהל המערכת קיבל הודעה." : `אין ${data.label} ברשימה הזו.`);
        return;
      }

      const text = field === "email" ? data.values.join(", ") : data.values.join("\n");
      const note = data.limited
        ? ` (${(data.left_out ?? 0).toLocaleString("he-IL")} נוספים לא הועתקו — זו המגבלה היומית; מנהל המערכת קיבל הודעה)`
        : data.truncated
          ? ` (המקסימום, מתוך יותר)`
          : "";
      try {
        await navigator.clipboard.writeText(text);
        setMessage(`הועתקו ${data.count} ${data.label}${note}.`);
      } catch {
        // No clipboard permission (or an insecure origin): give the text to copy by hand.
        setFallback(text);
        setMessage(`${data.count} ${data.label}${note}. הדפדפן חסם העתקה אוטומטית — הטקסט מסומן למטה, אפשר להעתיק משם.`);
        requestAnimationFrame(() => {
          box.current?.focus();
          box.current?.select();
        });
      }
    } catch (err) {
      setMessage(err instanceof Error && err.message === "signed out" ? "נדרשת התחברות מחדש." : "ההעתקה נכשלה. אפשר לנסות שוב.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">העתקת פרטי הקשר של {subject ?? `כל ${total.toLocaleString("he-IL")} המועמדים בחיפוש`}:</span>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => copy("email")} disabled={busy !== null}>
          {busy === "email" ? "מעתיק…" : "מיילים"}
        </button>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => copy("phone")} disabled={busy !== null}>
          {busy === "phone" ? "מעתיק…" : "טלפונים"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">מיילים מופרדים בפסיק, טלפונים שורה לכל אחד. כל העתקה נרשמת ביומן הפעילות ונספרת במגבלת הייצוא היומית.</p>
      <p role="status" className="mt-2 min-h-[1.25rem] text-sm font-medium text-accent-dark">
        {message}
      </p>
      {fallback ? (
        <textarea
          ref={box}
          readOnly
          value={fallback}
          aria-label="הרשימה להעתקה"
          className="mt-2 h-28 w-full rounded-[12px] border border-field bg-white p-3 text-sm"
          dir="ltr"
        />
      ) : null}
    </div>
  );
}
