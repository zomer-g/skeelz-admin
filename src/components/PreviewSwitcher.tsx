import { setPreviewRole } from "@/app/(app)/preview-actions";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/roles";
import { buttonClass, smallFieldClass } from "./ui";

/**
 * Shown to real admins only: switch the whole platform to a lower role's view.
 * Applied with a button, not on change: arrowing through a closed select fires
 * `change` on every key, which would switch roles mid-choice (WCAG 3.2.2).
 */
export function PreviewSwitcher({ current }: { current: Role }) {
  return (
    <form action={setPreviewRole} className="flex items-center gap-2">
      <label htmlFor="view-as" className="text-xs text-muted">
        צפייה כ
      </label>
      <select key={current} id="view-as" name="role" defaultValue={current} className={smallFieldClass}>
        {[...ROLES].reverse().map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass("quiet", "sm")}>
        החלה
      </button>
    </form>
  );
}
