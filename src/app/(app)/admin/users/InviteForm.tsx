"use client";

import { useActionState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import { ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { inviteUser, type ActionState } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, null);
  const failed = Boolean(state && !state.ok);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[min(16rem,100%)] flex-1 flex-col gap-2">
          <span className="text-sm font-medium text-muted">אימייל (חשבון Google, חובה)</span>
          <input
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="name@example.com"
            aria-invalid={failed || undefined}
            aria-describedby="invite-result"
            className={`${fieldClass} text-start`}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">תפקיד</span>
          <select name="role" defaultValue="viewer" className={`${fieldClass} min-w-[11rem]`}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "יוצר הזמנה…" : "הזמנה"}
        </button>
      </div>
      {/* Always mounted, so the result is announced when it arrives. */}
      <p id="invite-result" role="status" className={`text-sm ${failed ? "text-danger" : "text-success"}`}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}
