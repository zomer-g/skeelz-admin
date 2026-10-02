/** Hebrew names for the Google Analytics tab: reports, dimensions, metrics and the site's events. */

export const GA_REPORT_LABELS: Record<string, string> = {
  pages: "דפים",
  events: "אירועים",
  channels: "תנועה לפי ערוץ, מקור ומדיום",
  campaigns: "קמפיינים",
  campaign_events: "אירועים לפי קמפיין",
  campaign_landing_pages: "דפי נחיתה של קמפיינים",
};

export const GA_DIM_LABELS: Record<string, string> = {
  date: "יום",
  week: "שבוע",
  month: "חודש",
  page_path: "דף",
  site_job_key: "מזהה משרה",
  event_name: "אירוע",
  channel_group: "ערוץ",
  source: "מקור",
  medium: "מדיום",
  campaign: "קמפיין",
  landing_page: "דף נחיתה",
};

export const GA_METRIC_LABELS: Record<string, string> = {
  views: "צפיות",
  active_users: "משתמשים (סכום יומי)",
  sessions: "כניסות",
  event_count: "אירועים",
  total_users: "משתמשים (סכום יומי)",
  new_users: "משתמשים חדשים",
  engaged_sessions: "כניסות מעורבות",
};

export const GA_EVENT_LABELS: Record<string, string> = {
  open_job_page: "פתיחת דף משרה",
  Job_application_click_1: 'לחיצה על "הגש מועמדות"',
  Job_application_yes: "אישור הגשה",
  sign_up_click1: "לחיצה על הרשמה",
  sign_up_first_phase_complete: "הרשמה: שלב 1 הושלם",
  sign_up_second_phase_complete: "הרשמה: שלב 2 הושלם",
  login_main_page: "כניסה לחשבון",
  "search&filter": "חיפוש וסינון",
  skiils_filter: "סינון לפי כישורים",
  job_type_filter: "סינון לפי סוג משרה",
  page_view: "צפייה בדף",
  session_start: "תחילת כניסה",
  first_visit: "ביקור ראשון",
  user_engagement: "מעורבות",
  scroll: "גלילה לתחתית הדף",
  click: "לחיצה על קישור יוצא",
  form_start: "התחלת מילוי טופס",
  form_submit: "שליחת טופס",
  view_search_results: "צפייה בתוצאות חיפוש",
  file_download: "הורדת קובץ",
};

export const gaEventLabel = (name: string) => GA_EVENT_LABELS[name] ?? name;
