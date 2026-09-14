import { CONTACT_EMAIL } from "@/components/PublicDoc";

/**
 * The texts an admin can edit at /admin/texts. To make another text editable,
 * add an entry here and render it with loadText() + <RichText>. `defaultBody`
 * is what the page shows until someone saves a version.
 *
 * Format (see RichText): a blank line starts a new paragraph, "## " a heading,
 * "- " a list item, **bold**, and [link text](https://… | mailto:… | /path).
 */

export interface EditableText {
  key: string;
  title: string;
  /** The page that shows the text. */
  path: string;
  description: string;
  defaultBody: string;
  /** Shown as the page's "last updated" until the first saved version. */
  defaultUpdated: string;
}

const contact = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

export const TEXTS: EditableText[] = [
  {
    key: "accessibility",
    title: "הצהרת נגישות",
    path: "/accessibility",
    description: "נדרשת לפי תקנות הנגישות. מקושרת מכל עמוד, כולל מסך הכניסה.",
    defaultUpdated: "14.09.2026",
    defaultBody: `מערכת הניהול של SKEELZ הותאמה לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013, ולתקן הישראלי ת״י 5568 ברמה AA (WCAG 2.1): אפשר לנווט בה במקלדת ובקורא מסך, הניגודיות עומדת בתקן, התצוגה מותאמת לטלפונים ולהגדלת טקסט, ולכל גרף יש חלופה בטבלה. תוכן שמגיע ממערכות חיצוניות (כגון Salesforce) וקבצים שהעלו מועמדים מוצגים כפי שהוזנו במקור, ועשויים שלא להיות נגישים במלואם. נתקלתם בקושי? נשמח לשמוע ולטפל: ${contact}.`,
  },
  {
    key: "privacy",
    title: "מדיניות פרטיות",
    path: "/privacy",
    description: "מקושרת ממסך הכניסה ומהפוטר.",
    defaultUpdated: "14.09.2026",
    defaultBody: `מערכת הניהול של SKEELZ היא מערכת פנימית, והגישה אליה מוגבלת לעובדים ולשותפים שהוזמנו. לצורך הכניסה נשמרים שם, כתובת מייל ומזהה חשבון Google, ולצורכי אבטחה נרשם יומן של כניסות, צפיות ופעולות. המערכת מציגה נתוני משרות, מעסיקים ומועמדים (כולל פרטי קשר) שמקורם ב-Salesforce של SKEELZ, ונתוני שימוש מצטברים מ-Google Analytics ומ-SMOOV. המידע משמש לניהול הגיוס ולמדידת פעילות האתר בלבד, נשמר בשרתים מאובטחים, אינו נמכר ואינו מועבר לצד שלישי מלבד ספקי התשתית ומערכות ש-SKEELZ חיברה בממשק מאובטח. קורות חיים וקבצי מועמדים אינם נשמרים במערכת, וכל פתיחה שלהם מתועדת. לעיון, לתיקון או למחיקה של מידע, או לכל שאלה בנושא פרטיות, אפשר לפנות אל ${contact}.`,
  },
];

export type TextKey = (typeof TEXTS)[number]["key"];

export const findText = (key: string): EditableText | undefined => TEXTS.find((t) => t.key === key);

/** The author recorded on the version that preserves the built-in text, before the first edit replaces it. */
export const ORIGINAL_AUTHOR = "הטקסט המקורי";

export const MAX_TEXT_LENGTH = 50_000;
