"use client";

import { useActionState, useRef, useState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import { API_SCOPES, KEY_EXPIRY_DAYS } from "@/lib/api/spec";
import { createApiKey, type CreateKeyState } from "./actions";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKey, null);
  const [copied, setCopied] = useState<string | null>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const failed = Boolean(state && !state.ok);

  async function copy() {
    if (!state?.key) return;
    try {
      await navigator.clipboard.writeText(state.key);
      setCopied(state.key);
    } catch {
      // No clipboard permission: select the text so Ctrl+C works.
      keyField.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[min(16rem,100%)] flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-muted">שם: למי המפתח (חובה)</span>
            <input
              name="name"
              required
              maxLength={100}
              placeholder="site → admin"
              aria-invalid={failed || undefined}
              aria-describedby="key-result"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">תוקף</span>
            <select name="expires" defaultValue="" className={`${fieldClass} min-w-[11rem]`}>
              <option value="">ללא תפוגה</option>
              {KEY_EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} יום
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">הרשאות (לפחות אחת)</legend>
          {API_SCOPES.map((s) => (
            <label key={s.scope} className="flex items-start gap-3">
              <input type="checkbox" name="scopes" value={s.scope} className="mt-1 size-5 shrink-0 accent-accent" />
              <span>
                <code dir="ltr" className="font-mono text-sm">
                  {s.scope}
                </code>
                <span className="block text-sm text-muted">{s.label}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "יוצר מפתח…" : "יצירת מפתח"}
          </button>
        </div>
      </form>

      {/* Always mounted, so the result is announced when it arrives. */}
      <div id="key-result" role="status" className="flex flex-col gap-3">
        {state ? <p className={`text-sm ${failed ? "text-danger" : "text-success"}`}>{state.message}</p> : null}
        {state?.key ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-white p-4 ring-1 ring-line">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-muted">המפתח החדש</span>
              <input
                ref={keyField}
                readOnly
                value={state.key}
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-full min-w-0 rounded-full border border-field bg-surface px-3 font-mono text-xs text-ink"
              />
            </label>
            <button type="button" onClick={copy} className={buttonClass("secondary", "sm")}>
              {copied === state.key ? "הועתק" : "העתקה"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
