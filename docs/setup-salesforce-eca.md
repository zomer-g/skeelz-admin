# הקמת חיבור Salesforce (קריאה בלבד)

החיבור בנוי משלושה חלקים:
1. **משתמש אינטגרציה:** משתמש ייעודי שהפלטפורמה פועלת בשמו, עם הרשאות קריאה בלבד.
2. **Permission Set:** קובע מה המשתמש הזה רשאי לקרוא.
3. **External Client App (ECA):** "האפליקציה" שדרכה השרת מקבל אסימון גישה בשיטת Client Credentials, בלי סיסמה של אדם.

> מאז Spring '26 אי אפשר ליצור Connected App חדש, ולכן משתמשים ב-External Client App. אם תפריט כלשהו נראה אחרת אצלך, חפש את שם ההגדרה בתיבת Quick Find ב-Setup.

---

## שלב 1 — משתמש אינטגרציה

1. **Setup → Users → Users → New User**.
2. ממלאים את הפרטים:
   - **Last Name:** `Skeelz Dashboard Integration`
   - **Email:** כתובת שלך. אליה יגיע מייל האימות.
   - **Username:** ייחודי בכל Salesforce, למשל `skeelz-dashboard@skeelz.integration`
   - **User License:** `Salesforce Integration`. במהדורות Enterprise ומעלה יש 5 רישיונות כאלה בחינם.
   - **Profile:** `Minimum Access - API Only Integrations`
3. שומרים.
4. בדף המשתמש: **Permission Set License Assignments → Edit Assignments → `Salesforce API Integration`** ושומרים. **חובה:** בלי השיוך הזה, הוספת ה-Permission Set בשלב 2 נכשלת עם השגיאה `The user license doesn't allow the permission: Read Account`.
   - בכל מקרה לא נוגעים במשתמשי אינטגרציה קיימים. ייתכן שהאתר הנוכחי מתחבר דרכם.

## שלב 2 — Permission Set לקריאה בלבד

1. **Setup → Permission Sets → New**.
   - **Label:** `Skeelz Dashboard Read Only`
   - **License:** `--None--`. אם בוחרים רישיון, Object Settings מציג רק את האובייקטים שהרישיון מתיר, ו-Accounts ו-Contacts עלולים לא להופיע.
2. **Object Settings.** בכל אחד מהאובייקטים הבאים לוחצים Edit ומסמנים **Read** ו-**View All Records**:
   - `Accounts`
   - `Contacts`
   - `Cases`
   - `Users` (אם מופיע)
   - וגם כל אובייקט מותאם שבו רשומים נתוני משרה או הגשה, אם יש כזה

   באותו מסך מסמנים **Read Access** לכל השדות (Field Permissions). ה-View All Records נדרש כדי שהסנכרון יראה את כל הרשומות, גם כאלה שמשתמש האינטגרציה אינו הבעלים שלהן.
3. **לא** מסמנים Create, Edit או Delete.
4. **משימות ופגישות (שיחות מ-Log a Call):** ל-Tasks ול-Events אין הרשאות ב-Object Settings, שם תמיד יופיע `--`. מגדירים אותן כך:
   - **System Permissions → Edit**, ומסמנים את **Access Activities**, **Edit Tasks** ו-**Edit Events**. בסיילספורס אין לפעילויות הרשאת קריאה בלבד, אבל הלקוח שלנו אינו מסוגל לכתוב.
   - ב-Object Settings, ב-**Tasks** וב-**Events**, מסמנים **Read Access** לשדות.
   - ⚠️ **Activity History** (`DevopsActivityLog`) הוא יומן של DevOps Center, **לא** שיחות. אין צורך לתת עליו הרשאה.
   - **השינוי לא מיידי:** סיילספורס מחיל הרשאות חדשות רק על סשן חדש. הפלטפורמה מחליפה סשן פעם בשעה, ולכן שינוי הרשאות נכנס לתוקף תוך שעה לכל היותר.
5. **Manage Assignments → Add Assignment** ובוחרים את משתמש האינטגרציה.

> היסטוריית Case (CaseHistory) ו-RecordTypes נקראות אוטומטית כשיש הרשאת קריאה ל-Case.

## שלב 3 — External Client App

1. **Setup → External Client App Manager → New External Client App**.
2. **Basic Information:**
   - **Name:** `Skeelz Dashboard`
   - **Contact Email:** הכתובת שלך
   - **Distribution State:** `Local`
3. **API (Enable OAuth Settings)** מסמנים **Enable OAuth**:
   - **Callback URL:** `https://login.salesforce.com/services/oauth2/success`. השדה חובה, אבל ב-Client Credentials לא משתמשים בו.
   - **OAuth Scopes:** `Manage user data via APIs (api)`
   - **Flow Enablement:** מסמנים **Enable Client Credentials Flow**
   - **Security:** משאירים את ברירות המחדל. PKCE לא רלוונטי לזרימה הזו.
4. **Create**.
   > לא רואים את **Flow Enablement**? הוא מופיע רק אחרי שמסמנים **Enable OAuth**. אם האפליקציה כבר נוצרה בלי OAuth, נכנסים ללשונית **Settings → OAuth Settings → Edit** ומסמנים שם.
5. בלשונית **Policies → Edit → OAuth Policies**:
   - **OAuth Flows and External Client App Enhancements:** מסמנים **Enable Client Credentials Flow**. זו התיבה השנייה, נפרדת מזו שב-Settings, ושתיהן חייבות להיות מסומנות.
   - **Run As (Username):** שם המשתמש (Username) של משתמש האינטגרציה משלב 1
   - **Plugin Policies → Permitted Users:** `All users may self-authorize`
   - **IP Relaxation:** `Relax IP restrictions`
   - שומרים.
6. בלשונית **Settings → OAuth Settings → Consumer Key and Secret**. Salesforce ישלח קוד אימות למייל. מעתיקים את:
   - **Consumer Key**
   - **Consumer Secret**

## שלב 4 — כתובת ה-My Domain

**Setup → My Domain.** מעתיקים את **Current My Domain URL**, למשל `https://skeelz.my.salesforce.com`.

> Client Credentials עובד **רק** מול כתובת My Domain, ולא מול `login.salesforce.com`.

---

## מה להעביר

| משתנה | ערך | רגיש? |
|---|---|---|
| `SF_LOGIN_URL` | כתובת ה-My Domain, עם `https://` | לא |
| `SF_CLIENT_ID` | Consumer Key | בינוני |
| `SF_CLIENT_SECRET` | Consumer Secret | **כן** |

הערכים יוגדרו ב-xhostd כמשתני סביבה, וה-Secret יישמר כ-secret שאי אפשר לקרוא בחזרה. נתאם את דרך ההעברה כשנגיע לשלב החיבור. עדיף לא להדביק את ה-Secret במקום שנשמר, כמו מייל או מסמך משותף.

## בדיקה עצמית (לא חובה)

אם יש לך טרמינל עם `curl`, בקשה מוצלחת מחזירה `access_token` ו-`instance_url`:

```bash
curl -s -X POST "$SF_LOGIN_URL/services/oauth2/token" -d grant_type=client_credentials -d client_id="$SF_CLIENT_ID" -d client_secret="$SF_CLIENT_SECRET"
```

## ביטול החיבור

בכל רגע אפשר להשבית את משתמש האינטגרציה, או לבטל את ה-ECA, והגישה תיחסם מיד.
