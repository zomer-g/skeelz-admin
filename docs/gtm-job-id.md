# הוספת `job_id` לאירועי GA4 דרך Tag Manager

## למה

כתובת כל משרה באתר היא `/job/<מזהה>`, למשל `/job/692ff8bd208083706e192134`. הפלטפורמה כבר יודעת לחלץ את המזהה מנתיב הדף (`pagePath`) בנתוני GA הקיימים, כולל נתונים היסטוריים.

פרמטר `job_id` מפורש על כל אירוע מוסיף שלושה דברים:
- הקישור לא נשבר אם מבנה הכתובות ישתנה, או כשמתווספים פרמטרים לכתובת.
- המזהה זמין ב-Explorations של GA4 כמימד נוח לסינון.
- כל אירוע שנורה כשחלון המשרה פתוח משויך ישירות למשרה, למשל `Job_application_click_1`, `Job_application_yes` ו-`Job_application_no`.

**שימו לב:**
- הנתונים ייאספו רק מרגע הפרסום, בלי השלמה לאחור. לכן כדאי לפרסם מוקדם.
- השינוי נעשה כולו בתוך GTM. לא נוגעים בקוד האתר.

## שלב 1 — משתנה שמחלץ את מזהה המשרה

1. ב-GTM, בקונטיינר `GTM-KJJCSQ44`: **Variables → User-Defined Variables → New**.
2. **Name:** `CJS - job_id`
3. **Variable Configuration → Custom JavaScript**, ומדביקים:

```js
function () {
  var match = document.location.pathname.match(/^\/job\/([0-9a-f]{24})/i);
  return match ? match[1].toLowerCase() : undefined;
}
```

4. שומרים.

> המשתנה קורא את הכתובת ברגע שהתג נורה. כך הוא עובד גם כשחלון המשרה משנה את הכתובת בלי טעינת דף.

## שלב 2 — צירוף הפרמטר לכל אירועי GA4

כדי לא לערוך 12 תגים אחד-אחד, מגדירים את הפרמטר פעם אחת:

1. **Variables → New**.
   - **Name:** `GA4 - shared event settings`
   - **Type:** `Google Tag: Event Settings`
   - **Event Parameters → Add parameter:** Name = `job_id`, Value = `{{CJS - job_id}}`
   - שומרים.
2. עוברים על כל תגי **Google Analytics: GA4 Event** בקונטיינר, למשל `open_job_page`, `Job_application_click_1`, `Job_application_yes/no` וכו'. בכל אחד:
   **Event Parameters → Event Settings Variable** בוחרים `{{GA4 - shared event settings}}`, ושומרים.
3. אם יש בקונטיינר **Google Tag** (תג קונפיגורציה) עם `G-Q9E4S9RLLC`, מוסיפים גם לו, תחת **Shared event settings**, את אותו משתנה.

   > ייתכן שאין תג כזה, כי ה-gtag מוטמע באתר ישירות. זה בסדר: צפיות הדפים ימשיכו להיות משויכות למשרה לפי הנתיב.

## שלב 3 — רישום המימד ב-GA4

1. ב-GA4: **Admin → Data display → Custom definitions → Create custom dimension**.
2. ממלאים:
   - **Dimension name:** `Job ID`
   - **Scope:** `Event`
   - **Event parameter:** `job_id`
3. שומרים.

## שלב 4 — בדיקה ופרסום

1. ב-GTM לוחצים **Preview**, ומזינים `https://jobs.skeelz.co.il/`.
2. באתר שנפתח, פותחים משרה ולוחצים "הגש מועמדות", ואז "לא" בחלון האישור אם מופיע. **לא** שולחים הגשה אמיתית.
3. ב-Tag Assistant בוחרים את האירוע `Job_application_click_1`. בתג GA4 שנורה, בודקים שהפרמטר `job_id` מופיע עם מזהה בן 24 תווים.
4. אם הכול תקין: **Submit → Version name:** `job_id parameter` **→ Publish**.

## מגבלה ידועה

קליק על "פרטים והגשת מועמדות" ב**דף הרשימה** נורה כשהכתובת עדיין `/`, ולכן `open_job_page` מדף הרשימה לא יקבל `job_id`. צפיית הדף `/job/<id>` שמגיעה מיד אחריו כן משויכת למשרה.
