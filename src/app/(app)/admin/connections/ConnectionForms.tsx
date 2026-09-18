"use client";

import { useActionState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import type { Peer } from "@/lib/api/spec";
import { checkConnection, saveConnection, type ConnectionState } from "./actions";

/** The live region stays mounted, so the result is announced when it arrives. */
function Result({ id, state }: { id: string; state: ConnectionState }) {
  return (
    <div id={id} role="status">
      {state ? (
        <ul className={`mt-3 flex flex-col gap-1 rounded-card px-4 py-3 text-sm ${state.ok ? "bg-success-soft text-success" : "bg-danger-soft/40 text-danger"}`}>
          {state.lines.map((line) => (
            <li key={line} dir="auto">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ConnectionForm({
  peer,
  label,
  baseUrl,
  keyLast4,
  enabled,
}: {
  peer: Peer;
  label: string;
  baseUrl: string;
  keyLast4: string | null;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState<ConnectionState, FormData>(saveConnection, null);
  const failed = Boolean(state && !state.ok);
  const resultId = `save-${peer}`;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="peer" value={peer} />
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">כתובת בסיס (https, בלי נתיב)</span>
        <input
          name="base_url"
          type="url"
          required
          dir="ltr"
          defaultValue={baseUrl}
          placeholder="https://…xhostd.app"
          aria-invalid={failed || undefined}
          aria-describedby={resultId}
          className={`${fieldClass} w-full text-start`}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">המפתח שהמערכת הזו הנפיקה לנו</span>
        <input
          name="key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          placeholder={keyLast4 ? `••••${keyLast4}` : "sk_…"}
          aria-describedby={`${peer}-key-hint ${resultId}`}
          className={`${fieldClass} w-full text-start`}
        />
        <span id={`${peer}-key-hint`} className="text-xs text-muted">
          {keyLast4 ? "שדה ריק שומר את המפתח הנוכחי. המפתח לא מוצג שוב אחרי השמירה." : "המפתח נשמר מוצפן ולא מוצג שוב אחרי השמירה."}
        </span>
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-5 accent-accent" />
        <span>החיבור פעיל</span>
      </label>
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "שומר…" : "שמירה"}
          <span className="sr-only"> · {label}</span>
        </button>
      </div>
      <Result id={resultId} state={state} />
    </form>
  );
}

export function CheckButton({ peer, label, disabled }: { peer: Peer; label: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<ConnectionState, FormData>(checkConnection, null);
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="peer" value={peer} />
        <button type="submit" disabled={disabled || pending} className={buttonClass("secondary", "sm")}>
          {pending ? "בודק…" : "בדיקת חיבור"}
          <span className="sr-only"> · {label}</span>
        </button>
      </form>
      <Result id={`check-${peer}`} state={state} />
    </div>
  );
}
