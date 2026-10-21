import Link from "next/link";
import { logError } from "@/lib/log";
import { countOpenAlerts } from "@/lib/security/files";
import { countDueReviews } from "@/lib/security/reviews";

/**
 * What waits for an admin, on every page: open file-access alerts (many files today, or a user
 * waiting for more) and this month's access review. Nothing shows when nothing waits.
 */
export async function AdminAlerts() {
  let alerts = 0;
  let reviews = 0;
  try {
    [alerts, reviews] = await Promise.all([countOpenAlerts(), countDueReviews()]);
  } catch (err) {
    // The bar must never break the page it sits on.
    logError("admin alerts", err);
    return null;
  }
  if (!alerts && !reviews) return null;
  return (
    <div role="region" aria-label="משימות אבטחה לאדמין" className="border-b border-hot bg-hot/30">
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm">
        <span className="font-bold">לטיפול האדמין:</span>
        {alerts ? (
          <Link href="/admin/security" className="font-medium underline underline-offset-4">
            {alerts === 1 ? "התראת אבטחה פתוחה" : `${alerts} התראות אבטחה פתוחות`} (פתיחת קבצי מועמדים)
          </Link>
        ) : null}
        {reviews ? (
          <Link href="/admin/users" className="font-medium underline underline-offset-4">
            אישור ההרשאות החודשי: {reviews === 1 ? "משתמש אחד ממתין" : `${reviews} משתמשים ממתינים`}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
