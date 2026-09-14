# הקמת חיבור Google Analytics 4 ו-Tag Manager (קריאה בלבד)

הפלטפורמה תקרא נתונים מ-GA4 ומ-GTM דרך **Service Account**, כלומר חשבון שירות של Google Cloud. מוסיפים אותו כמשתמש צופה ב-GA4 וכקורא ב-GTM.

## שלב 1 — פרויקט ב-Google Cloud

1. נכנסים ל-https://console.cloud.google.com, ויוצרים פרויקט חדש (למשל `skeelz-dashboard`) או בוחרים פרויקט קיים.
2. **APIs & Services → Library.** מפעילים (Enable) את שלושת ה-APIs:
   - `Google Analytics Data API`
   - `Google Analytics Admin API` (לבדיקת הגדרות Custom Dimensions)
   - `Tag Manager API`

## שלב 2 — Service Account ומפתח

1. **IAM & Admin → Service Accounts → Create Service Account**.
   - **Name:** `skeelz-dashboard-reader`
   - **Roles** בפרויקט: לא צריך. מדלגים.
2. נכנסים לחשבון שנוצר, **Keys → Add Key → Create new key → JSON**. קובץ JSON יורד למחשב.
3. מעתיקים את כתובת המייל של החשבון, בצורה `skeelz-dashboard-reader@<project>.iam.gserviceaccount.com`.

> קובץ ה-JSON הוא סוד. לא שולחים אותו במייל ולא שומרים אותו בתיקייה משותפת.

## שלב 3 — גישה ל-GA4

1. ב-https://analytics.google.com בוחרים את ה-property של האתר (`G-Q9E4S9RLLC`).
2. **Admin → Property → Property access management → + → Add users**.
3. מדביקים את מייל ה-Service Account, בוחרים תפקיד **Viewer**, ומבטלים את "Notify new users by email".
4. **Admin → Property settings → Property details.** מעתיקים את **Property ID**, מספר של כ-9 ספרות. זה לא ה-`G-...`.

## שלב 4 — גישה ל-GTM

1. ב-https://tagmanager.google.com נכנסים לחשבון שמכיל את `GTM-KJJCSQ44`.
2. **Admin → User Management → + → Add users**.
3. מדביקים את מייל ה-Service Account.
4. **Account permissions:** `User`. **Container permissions** לקונטיינר של האתר: `Read`.
5. מעתיקים את שני המזהים המספריים מכתובת הדפדפן, בצורה `.../accounts/<ACCOUNT_ID>/containers/<CONTAINER_ID>/...`.

## מה להעביר

| משתנה | ערך | רגיש? |
|---|---|---|
| `GA4_PROPERTY_ID` | ה-Property ID המספרי | לא |
| `GTM_ACCOUNT_ID` | מזהה חשבון GTM מספרי | לא |
| `GTM_CONTAINER_ID` | מזהה קונטיינר מספרי | לא |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | תוכן קובץ ה-JSON | **כן** |

מומלץ לוודא שבהגדרות ה-Data Stream ב-GA4, תחת **Enhanced measurement → Page views → Show advanced settings**, מסומן **Page changes based on browser history events**. חלון המשרה באתר משנה את הכתובת ל-`/job/<id>` בלי טעינת דף, וההגדרה הזו היא שגורמת לספור אותו כצפייה בדף המשרה.

ההוראות להוספת מזהה משרה לאירועים נמצאות ב-[gtm-job-id.md](gtm-job-id.md).
