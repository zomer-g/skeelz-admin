import Link from "next/link";
import { auditWriteFailures } from "@/lib/audit";
import { fmtRelative } from "@/lib/format";
import { logError } from "@/lib/log";
import { countOpenAlerts } from "@/lib/security/files";
import { countReviews, RENEW_WINDOW_DAYS } from "@/lib/security/reviews";

/**
 * What waits for an admin, on every page: open security alerts (many candidate files or many
 * people's details exported today, or a user waiting for more) and the access review: confirmations
 * that are due, and those in their last days, which can already be renewed; and activity-log
 * entries this server could not write since it started (the log is a legal duty: a gap must be seen).
 * Nothing shows when nothing waits.
 */
export async function AdminAlerts() {
  const failed = auditWriteFailures();
  let alerts = 0;
  let reviews = { due: 0, soon: 0 };
  try {
    [alerts, reviews] = await Promise.all([countOpenAlerts(), countReviews()]);
  } catch (err) {
    // The bar must never break the page it sits on.
    logError("admin alerts", err);
    if (!failed.count) return null;
  }
  if (!alerts && !reviews.due && !reviews.soon && !failed.count) return null;
  return (
    <div role="region" aria-label="משימות אבטחה לאדמין" className="border-b border-hot bg-hot/30">
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm">
        <span className="font-bold">לטיפול האדמין:</span>
        {failed.count ? (
          <span className="font-medium">
            יומן הפעילות: {failed.count === 1 ? "רישום אחד נכשל" : `${failed.count} רישומים נכשלו`} מאז הפעלת השרת
            {failed.last ? ` (האחרון ${fmtRelative(failed.last)})` : ""}. פעולות שמוסרות מידע אישי נחסמו בזמן התקלה; צפיות במסכים לא נרשמו.
          </span>
        ) : null}
        {alerts ? (
          <Link href="/admin/security" className="font-medium underline underline-offset-4">
            {alerts === 1 ? "התראת אבטחה פתוחה" : `${alerts} התראות אבטחה פתוחות`} (קבצי מועמדים וייצוא פרטי קשר)
          </Link>
        ) : null}
        {reviews.due || reviews.soon ? (
          <Link href="/admin/users" className="font-medium underline underline-offset-4">
            אישור ההרשאות:{" "}
            {[
              reviews.due ? (reviews.due === 1 ? "משתמש אחד ממתין לאישור" : `${reviews.due} משתמשים ממתינים לאישור`) : null,
              reviews.soon
                ? `${reviews.soon === 1 ? "אישור אחד פג" : `${reviews.soon} אישורים פגים`} ב-${RENEW_WINDOW_DAYS} הימים הקרובים (אפשר לחדש כבר עכשיו)`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
