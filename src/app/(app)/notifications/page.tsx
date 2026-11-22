import type { Metadata } from "next";
import { InstallApp } from "@/components/pwa/InstallApp";
import { PushToggle } from "@/components/pwa/PushToggle";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { hasRole } from "@/lib/auth/roles";
import { PUSH_EVENTS } from "@/lib/push/events";
import { countSubscriptions } from "@/lib/push/subscriptions";
import { vapidKeys } from "@/lib/push/webpush";

export const metadata: Metadata = { title: "התראות ואפליקציה" };

/**
 * The person's own settings for the app on their devices: installing it, and push notices on
 * this device (docs/pwa.md). Push shows only when the VAPID keys are set.
 */
export default async function NotificationsPage() {
  const auth = await pageAuth("viewer", "/notifications");
  if (!auth.ok) return auth.render;
  const { user } = auth;

  const keys = vapidKeys();
  const mine = Object.values(PUSH_EVENTS).filter((e) => hasRole(user.role, e.minRole));
  const devices = keys ? await countSubscriptions(user.id) : 0;

  return (
    <>
      <PageHeader title="התראות ואפליקציה" subtitle="התקנת מערכת הניהול כאפליקציה בטלפון או במחשב, והתראות למכשיר" />

      <div className="flex flex-col gap-8">
        <Card title="התקנת האפליקציה">
          <p className="text-sm">
            אפשר להתקין את מערכת הניהול כאפליקציה: היא נפתחת בחלון משלה, עם סמל במסך הבית או בשולחן העבודה. האפליקציה מציגה את אותם מסכים, תמיד מעודכנים מהשרת, ושום
            מידע לא נשמר במכשיר.
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1 ps-5 text-sm">
            <li>Chrome או Edge במחשב ובאנדרואיד: כפתור ההתקנה למטה, או &quot;התקנה&quot; בתפריט הדפדפן.</li>
            <li>אייפון ואייפד: בספארי, כפתור השיתוף ואז &quot;הוספה למסך הבית&quot;.</li>
          </ul>
          <div className="mt-4">
            <InstallApp className={buttonClass("primary", "sm")} />
          </div>
        </Card>

        {keys ? (
          <Card title="התראות למכשיר">
            <p className="text-sm">
              התראה קצרה למכשיר כשמשהו ממתין לך במערכת. ההתראה כללית בלבד ואין בה פרטים של אף אדם: היא עוברת דרך שירות ההתראות של יצרן הדפדפן (Google, Apple, Mozilla
              או Microsoft). לחיצה עליה פותחת את המסך המתאים, ושם, אחרי כניסה, מופיעים הפרטים.
            </p>
            {mine.length ? (
              <>
                <p className="mt-3 text-sm font-medium">ההתראות שנשלחות בהרשאה שלך:</p>
                <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-sm">
                  {mine.map((e) => (
                    <li key={e.kind}>{e.title}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-sm">כרגע אין התראות שנשלחות בהרשאה שלך; אם יתווספו, הן יגיעו למכשירים שבהם ההתראות פעילות.</p>
            )}
            <p className="mt-3 text-sm">
              באייפון ההתראות פועלות רק מהאפליקציה שנוספה למסך הבית (iOS 16.4 ומעלה). ההפעלה היא לכל מכשיר ודפדפן בנפרד, ואפשר לכבות בכל רגע.
              {devices ? ` כרגע ההתראות פעילות אצלך ב-${devices === 1 ? "מכשיר אחד" : `${devices} מכשירים`}.` : ""}
            </p>
            <div className="mt-4">
              <PushToggle publicKey={keys.publicKey} />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
