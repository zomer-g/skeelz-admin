"use client";

import { useActionState, useEffect } from "react";
import { buttonClass } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { MCP_ROLE_SCOPE } from "@/lib/mcp/roles";
import { decideConnection, type DecisionState } from "./actions";

/**
 * The approve / refuse form. The server action answers with where to go next, and the
 * browser goes there itself: a redirect straight out of a form post to the client's
 * address would be blocked by this site's `form-action 'self'` policy.
 */
export function ConsentForm({
  params,
  roles,
  defaultRole,
  staffOffer,
}: {
  params: Record<string, string>;
  roles: Role[];
  defaultRole: Role;
  /** Offer the staff tools (docs/staff.md): only for a staff manager. Ticked, since that is why they connect. */
  staffOffer: boolean;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideConnection, null);

  useEffect(() => {
    if (state?.redirect) window.location.assign(state.redirect);
  }, [state]);

  const done = Boolean(state?.redirect);

  return (
    <form action={action} className="flex flex-col gap-6">
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <fieldset className="flex flex-col gap-3" disabled={pending || done}>
        <legend className="mb-2 font-medium">ההרשאה שתינתן לחיבור</legend>
        {roles.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-start gap-3 rounded-card border border-field bg-white p-4 has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent"
          >
            <input type="radio" name="role" value={r} defaultChecked={r === defaultRole} className="mt-1 size-4" />
            <span>
              <span className="block font-medium">{ROLE_LABELS[r]}</span>
              <span className="block text-sm text-muted">{MCP_ROLE_SCOPE[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {staffOffer ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-field bg-white p-4">
          <input type="checkbox" name="staff_data" defaultChecked disabled={pending || done} className="mt-1 size-4" />
          <span>
            <span className="block font-medium">גם נתוני עובדים</span>
            <span className="block text-sm text-muted">
              שעות ומשימות לפי עובד ממאנדיי, מדוחות השעות ומ-Salesforce (<span dir="ltr">staff_monthly</span>, <span dir="ltr">staff_employee</span>). פועל רק כל עוד
              ההרשאה שלך כמנהל/ת עובדים בתוקף, ואפשר לכבות בכל עת בעמוד &quot;חיבור ל-Claude&quot;.
            </span>
          </span>
        </label>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-card border border-field bg-white p-4">
        <input type="checkbox" name="cv_text" disabled={pending || done} className="mt-1 size-4" />
        <span>
          <span className="block font-medium">גם קריאת קורות חיים</span>
          <span className="block text-sm text-muted">
            הטקסט המלא של קובץ מועמד (<span dir="ltr">cv_text</span>), קובץ אחד בכל פעם. כל קריאה נרשמת ביומן כפתיחת קובץ ונספרת במגבלת הקבצים
            היומית שלך, והטקסט עובר לאפליקציה שמתחברת. אפשר לכבות בכל עת בעמוד &quot;חיבור ל-Claude&quot;.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-3">
        <button name="decision" value="approve" className={buttonClass("primary")} disabled={pending || done}>
          אישור החיבור
        </button>
        <button name="decision" value="deny" className={buttonClass("secondary")} disabled={pending || done}>
          דחייה
        </button>
      </div>

      <p role="status" className="min-h-6 text-sm font-medium">
        {pending ? "שומר…" : (state?.message ?? "")}
      </p>
    </form>
  );
}
