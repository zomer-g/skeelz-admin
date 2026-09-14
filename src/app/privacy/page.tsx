import type { Metadata } from "next";
import { ContactLink, PublicDoc } from "@/components/PublicDoc";

export const metadata: Metadata = { title: "מדיניות פרטיות" };

/** Public on purpose, like the accessibility statement: it is linked from the sign-in screen. */
export default function PrivacyPage() {
  return (
    <PublicDoc title="מדיניות פרטיות" updated="14.09.2026">
      <p>
        מערכת הניהול של SKEELZ היא מערכת פנימית, והגישה אליה מוגבלת לעובדים ולשותפים שהוזמנו. לצורך הכניסה נשמרים שם, כתובת מייל ומזהה חשבון Google,
        ולצורכי אבטחה נרשם יומן של כניסות, צפיות ופעולות. המערכת מציגה נתוני משרות, מעסיקים ומועמדים (כולל פרטי קשר) שמקורם ב-Salesforce של SKEELZ,
        ונתוני שימוש מצטברים מ-Google Analytics ומ-SMOOV. המידע משמש לניהול הגיוס ולמדידת פעילות האתר בלבד, נשמר בשרתים מאובטחים, אינו נמכר ואינו
        מועבר לצד שלישי מלבד ספקי התשתית ומערכות ש-SKEELZ חיברה בממשק מאובטח. קורות חיים וקבצי מועמדים אינם נשמרים במערכת, וכל פתיחה שלהם מתועדת.
        לעיון, לתיקון או למחיקה של מידע, או לכל שאלה בנושא פרטיות, אפשר לפנות אל <ContactLink />.
      </p>
    </PublicDoc>
  );
}
