"use client";

import { useActionState, useEffect, useState } from "react";
import { RichText } from "@/components/RichText";
import { buttonClass, NewTabNote } from "@/components/ui";
import { saveText, type TextActionState } from "./actions";

/** Edit on one side, the page as it will look on the other (stacked on phones). */
export function TextEditor({ textKey, title, path, savedBody }: { textKey: string; title: string; path: string; savedBody: string }) {
  const [body, setBody] = useState(savedBody);
  // When the saved text changes on the server (a version restored below), show it in the box.
  const [shown, setShown] = useState(savedBody);
  if (savedBody !== shown) {
    setShown(savedBody);
    setBody(savedBody);
  }
  const [state, action, pending] = useActionState<TextActionState, FormData>(saveText, null);
  // `savedBody` is refreshed from the server after a save, so this clears itself.
  const dirty = body.trim() !== savedBody.trim();
  const failed = Boolean(state && !state.ok);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <input type="hidden" name="key" value={textKey} />
      <div className="flex flex-col gap-3">
        <label htmlFor="text-body" className="text-sm font-medium text-muted">
          הנוסח
        </label>
        <textarea
          id="text-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          dir="rtl"
          aria-describedby="text-format text-result"
          aria-invalid={failed || undefined}
          className="min-h-[24rem] w-full rounded-card border border-field bg-white p-4 text-base leading-relaxed text-ink shadow-field focus:outline-hidden focus:ring-2 focus:ring-accent"
        />
        <p id="text-format" className="text-xs leading-relaxed text-muted">
          שורה ריקה מתחילה פסקה חדשה · <span dir="ltr">## </span>בתחילת שורה: כותרת · <span dir="ltr">- </span>בתחילת שורה: פריט ברשימה · <span dir="ltr">**טקסט**</span>
          : הדגשה · <span dir="ltr">[טקסט](https://…)</span> או <span dir="ltr">(mailto:…)</span>: קישור
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "שומר…" : "שמירה ופרסום"}
          </button>
          {dirty ? <span className="text-sm font-medium text-[#93370d]">יש שינויים שלא נשמרו</span> : null}
          <a href={path} target="_blank" rel="noreferrer" className="ms-auto text-sm font-medium text-accent-dark underline underline-offset-4">
            העמוד הציבורי
            <NewTabNote />
          </a>
        </div>
        {/* Always mounted, so the result is announced when it arrives. */}
        <p id="text-result" role="status" className={`text-sm ${failed ? "text-danger" : "text-success"}`}>
          {state?.message ?? ""}
        </p>
      </div>

      <section aria-labelledby="text-preview-title" className="flex flex-col gap-3">
        <h2 id="text-preview-title" className="text-sm font-medium text-muted">
          תצוגה מקדימה · {title}
        </h2>
        <div className="flex flex-col gap-4 rounded-card border-2 border-line bg-white p-6 leading-relaxed">
          {body.trim() ? <RichText body={body} /> : <p className="text-muted">הטקסט ריק</p>}
        </div>
      </section>
    </form>
  );
}
