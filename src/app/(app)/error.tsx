"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Hebrew error screen for pages and server actions inside the app. The error's
 * own message is not shown (production Next redacts it anyway). Focus moves to
 * the heading so keyboard and screen-reader users land on the explanation.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div role="alert" className="mx-auto max-w-lg rounded-card border-2 border-line bg-surface p-8 text-center">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-hidden">
        הפעולה נכשלה
      </h1>
      <p className="mt-3 text-muted">משהו השתבש בטעינת העמוד או בביצוע הפעולה. אפשר לנסות שוב; אם זה חוזר, כדאי לפנות לאדמין המערכת.</p>
      <button type="button" onClick={reset} className={`${buttonClass("primary")} mt-6`}>
        ניסיון נוסף
      </button>
    </div>
  );
}
