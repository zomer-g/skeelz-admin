import type { Metadata } from "next";
import { ContactLink, PublicDoc } from "@/components/PublicDoc";

export const metadata: Metadata = { title: "הצהרת נגישות" };

/** Public on purpose: the regulations require the statement to be reachable from every page, sign-in included. */
export default function AccessibilityPage() {
  return (
    <PublicDoc title="הצהרת נגישות" updated="14.09.2026">
      <p>
        מערכת הניהול של SKEELZ הותאמה לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013, ולתקן הישראלי ת״י 5568 ברמה AA
        (WCAG 2.1): אפשר לנווט בה במקלדת ובקורא מסך, הניגודיות עומדת בתקן, התצוגה מותאמת לטלפונים ולהגדלת טקסט, ולכל גרף יש חלופה בטבלה. תוכן
        שמגיע ממערכות חיצוניות (כגון Salesforce) וקבצים שהעלו מועמדים מוצגים כפי שהוזנו במקור, ועשויים שלא להיות נגישים במלואם. נתקלתם בקושי? נשמח
        לשמוע ולטפל: <ContactLink />.
      </p>
    </PublicDoc>
  );
}
