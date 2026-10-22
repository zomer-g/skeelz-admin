/**
 * Topics for searching inside CVs: professions and broader skills, each backed by a set of phrases
 * that Salesforce's full-text index looks for in the files. A CV belongs to a topic when any of its
 * phrases appears in it; a group holds everything its topics hold, plus its own general phrases.
 *
 * Phrases are Hebrew or English. `*` ends a word with anything (מהנדס* = מהנדס, מהנדסת, מהנדסים).
 * The index does not strip Hebrew prefixes, so every Hebrew phrase is also searched with ו/ה/ב/ל/מ/ש/כ
 * in front (lib/sf/sync-topics.ts). Mind final letters: "עורך" and "עורכ*" are both needed.
 * Prefer phrases that say what the person *is or studied*: a bare "עו״ד" or "רופא" also matches
 * references and recommenders, and plurals ("עובדים סוציאליים", "עורכי דין") mostly mean the people
 * they worked with, so those are left out.
 */

export type TopicKind = "profession" | "skill";

export interface TopicGroup {
  id: string;
  label: string;
  kind: TopicKind;
  /** General phrases of the group itself, beyond its topics'. */
  phrases: string[];
}

export interface Topic {
  id: string;
  group: string;
  label: string;
  phrases: string[];
}

export const TOPIC_GROUPS: TopicGroup[] = [
  {
    id: "social",
    label: "עבודה סוציאלית ורווחה",
    kind: "profession",
    phrases: [],
  },
  { id: "law", label: "משפטים", kind: "profession", phrases: [] },
  { id: "finance", label: "כספים וחשבונאות", kind: "profession", phrases: [] },
  {
    id: "eng",
    label: "הנדסה",
    kind: "profession",
    phrases: ["מהנדס*", "Engineer", "Engineering", "תואר בהנדסה", "B.Sc in Engineering"],
  },
  {
    id: "tech",
    label: "טכנולוגיה ומחשבים",
    kind: "skill",
    phrases: ["הייטק", "Hi-Tech", "High-Tech"],
  },
  { id: "education", label: "חינוך והדרכה", kind: "profession", phrases: [] },
  { id: "health", label: "בריאות וטיפול", kind: "profession", phrases: [] },
  { id: "sales", label: "שיווק ומכירות", kind: "skill", phrases: [] },
  { id: "service", label: "שירות לקוחות", kind: "skill", phrases: [] },
  { id: "admin", label: "אדמיניסטרציה וניהול", kind: "skill", phrases: [] },
  { id: "hr", label: "משאבי אנוש", kind: "profession", phrases: [] },
  { id: "design", label: "עיצוב ומדיה", kind: "profession", phrases: [] },
  { id: "science", label: "מדעים ומחקר", kind: "profession", phrases: [] },
  { id: "languages", label: "שפות", kind: "skill", phrases: [] },
];

export const TOPICS: Topic[] = [
  // עבודה סוציאלית ורווחה
  {
    id: "social.work",
    group: "social",
    label: "עבודה סוציאלית",
    phrases: ["עבודה סוציאלית", "עובד סוציאלי", "עובדת סוציאלית", "עו״ס", "MSW", "BSW", "Social Work", "Social Worker"],
  },
  {
    id: "social.community",
    group: "social",
    label: "עבודה קהילתית",
    phrases: ["עבודה קהילתית", "רכז* קהילה", "פיתוח קהילתי", "Community Work"],
  },
  {
    id: "social.rehab",
    group: "social",
    label: "שיקום",
    phrases: ["רכז* שיקום", "מדריכ* שיקום", "שיקום תעסוקתי", "Rehabilitation"],
  },

  // משפטים
  {
    id: "law.lawyer",
    group: "law",
    label: "עריכת דין",
    // Not "עורכי דין": in CVs it is mostly "worked at a law firm".
    phrases: ["עורך דין", "עורכת דין", "עריכת דין", "לשכת עורכי הדין", "רישיון לעריכת דין", "Attorney", "Lawyer"],
  },
  {
    id: "law.degree",
    group: "law",
    label: "תואר במשפטים",
    phrases: ["תואר במשפטים", "LL.B", "LLB", "LL.M", "משפטן", "משפטנית", "יועץ משפטי", "יועצת משפטית"],
  },
  {
    id: "law.paralegal",
    group: "law",
    label: "מזכירות משפטית",
    phrases: ["מזכיר* משפטי*", "Paralegal", "Legal Secretary"],
  },

  // כספים וחשבונאות
  {
    id: "finance.general",
    group: "finance",
    label: "פיננסים (כללי)",
    phrases: ["פיננס*", "Finance", "Financial"],
  },
  {
    id: "finance.cpa",
    group: "finance",
    label: "ראיית חשבון",
    phrases: ["ראיית חשבון", "רואה חשבון", "רואת חשבון", "רו״ח", "CPA"],
  },
  {
    id: "finance.bookkeeping",
    group: "finance",
    label: "הנהלת חשבונות",
    phrases: ["הנהלת חשבונות", "מנהל חשבונות", "מנהלת חשבונות", "Bookkeep*"],
  },
  {
    id: "finance.payroll",
    group: "finance",
    label: "חשבות שכר",
    phrases: ["חשבות שכר", "חשב שכר", "חשבת שכר", "Payroll"],
  },
  {
    id: "finance.economics",
    group: "finance",
    label: "כלכלה",
    phrases: ["תואר בכלכלה", "כלכלן", "כלכלנית", "Economics", "Economist"],
  },
  {
    id: "finance.control",
    group: "finance",
    label: "כספים ובקרה",
    phrases: ["מנהל* כספים", "סמנכ״ל כספים", "CFO", "קונטרולר", "Controller", "בקרה תקציבית", "ניתוח פיננסי"],
  },
  {
    id: "finance.banking",
    group: "finance",
    label: "בנקאות וביטוח",
    phrases: ["בנקאי*", "בנקאות", "סוכן ביטוח", "סוכנת ביטוח", "חיתום", "Banking", "Underwrit*"],
  },

  // הנדסה
  {
    id: "eng.civil",
    group: "eng",
    label: "הנדסה אזרחית ובניין",
    phrases: ["הנדסה אזרחית", "הנדסת בניין", "מהנדס* בניין", "מהנדס* אזרחי*", "Civil Engineer*", "קונסטרוקצי*"],
  },
  {
    id: "eng.software",
    group: "eng",
    label: "הנדסת תוכנה",
    phrases: ["הנדסת תוכנה", "מהנדס* תוכנה", "Software Engineer*"],
  },
  {
    id: "eng.electrical",
    group: "eng",
    label: "חשמל ואלקטרוניקה",
    phrases: ["הנדסת חשמל", "מהנדס* חשמל", "הנדסת אלקטרוניקה", "Electrical Engineer*", "Electronics"],
  },
  {
    id: "eng.mechanical",
    group: "eng",
    label: "הנדסת מכונות",
    phrases: ["הנדסת מכונות", "מהנדס* מכונות", "Mechanical Engineer*"],
  },
  {
    id: "eng.industrial",
    group: "eng",
    label: "תעשייה וניהול",
    phrases: ["הנדסת תעשייה וניהול", "תעשייה וניהול", "Industrial Engineer*"],
  },
  {
    id: "eng.chemical",
    group: "eng",
    label: "כימיה וחומרים",
    phrases: ["הנדסה כימית", "מהנדס* כימי*", "הנדסת חומרים", "Chemical Engineer*"],
  },
  {
    id: "eng.biomedical",
    group: "eng",
    label: "ביו-רפואית",
    phrases: ["הנדסה ביו-רפואית", "הנדסה ביורפואית", "Biomedical Engineer*"],
  },
  {
    id: "eng.computer",
    group: "eng",
    label: "מחשבים ומערכות מידע",
    phrases: ["הנדסת מחשבים", "תואר במערכות מידע", "הנדסת מערכות מידע", "Information Systems", "Computer Engineer*"],
  },
  {
    id: "eng.practical",
    group: "eng",
    label: "הנדסאים",
    phrases: ["הנדסאי*", "Practical Engineer*"],
  },

  // טכנולוגיה ומחשבים
  {
    id: "tech.dev",
    group: "tech",
    label: "פיתוח תוכנה",
    phrases: ["פיתוח תוכנה", "מפתח תוכנה", "מפתחת תוכנה", "Developer", "Full Stack", "Python", "JavaScript", "React", "Java"],
  },
  {
    id: "tech.qa",
    group: "tech",
    label: "בדיקות תוכנה (QA)",
    phrases: ["בדיקות תוכנה", "בודק* תוכנה", "QA", "Automation"],
  },
  {
    id: "tech.it",
    group: "tech",
    label: "IT ותמיכה",
    phrases: ["תמיכה טכנית", "Help Desk", "מנהל* רשת*", "System Administrator", "IT Support"],
  },
  {
    id: "tech.data",
    group: "tech",
    label: "ניתוח נתונים",
    phrases: ["ניתוח נתונים", "Data Analyst", "אנליסט*", "Power BI", "Tableau", "SQL", "Business Intelligence"],
  },
  {
    id: "tech.office",
    group: "tech",
    label: "Office ואקסל",
    phrases: ["אקסל", "Excel", "MS Office", "Microsoft Office", "אופיס"],
  },

  // חינוך והדרכה
  {
    id: "education.teaching",
    group: "education",
    label: "הוראה",
    phrases: ["תעודת הוראה", "מורה", "Teacher", "Teaching"],
  },
  {
    id: "education.kindergarten",
    group: "education",
    label: "גננות וגיל רך",
    phrases: ["גננת", "גננות", "גיל הרך", "סייעת"],
  },
  {
    id: "education.special",
    group: "education",
    label: "חינוך מיוחד",
    phrases: ["חינוך מיוחד", "Special Education"],
  },
  {
    id: "education.training",
    group: "education",
    label: "הדרכה",
    phrases: ["מדריך", "מדריכה", "Trainer", "Instructor"],
  },

  // בריאות וטיפול
  {
    id: "health.nursing",
    group: "health",
    label: "סיעוד",
    phrases: ["סיעוד", "אח מוסמך", "אחות מוסמכת", "Nurse", "Nursing"],
  },
  {
    id: "health.paramedical",
    group: "health",
    label: "מקצועות הבריאות",
    phrases: ["פיזיותרפ*", "ריפוי בעיסוק", "מרפא* בעיסוק", "קלינאי* תקשורת", "דיאטני*", "תזונאי*", "רוקח*", "Physiotherap*", "Occupational Therap*"],
  },
  {
    id: "health.psychology",
    group: "health",
    label: "פסיכולוגיה וטיפול רגשי",
    phrases: ["פסיכולוג*", "פסיכותרפ*", "טיפול רגשי", "מטפל* באמנות", "Psycholog*"],
  },
  {
    id: "health.medicine",
    group: "health",
    label: "רפואה",
    phrases: ["תואר ברפואה", "Medicine", "Medical Doctor"],
  },

  // שיווק ומכירות
  {
    id: "sales.sales",
    group: "sales",
    label: "מכירות",
    phrases: ["מכירות", "איש מכירות", "אשת מכירות", "נציג* מכירות", "Sales"],
  },
  {
    id: "sales.marketing",
    group: "sales",
    label: "שיווק",
    phrases: ["שיווק", "שיווק דיגיטלי", "Marketing", "Digital Marketing"],
  },
  {
    id: "sales.content",
    group: "sales",
    label: "תוכן וקופירייטינג",
    phrases: ["קופירייט*", "כתיבת תוכן", "Content Writ*", "Copywrit*"],
  },

  // שירות לקוחות
  {
    id: "service.customer",
    group: "service",
    label: "שירות לקוחות",
    phrases: ["שירות לקוחות", "נציג* שירות", "Customer Service", "Customer Success"],
  },
  {
    id: "service.callcenter",
    group: "service",
    label: "מוקד ומרכז שירות",
    phrases: ["מוקד שירות", "מוקד מכירות", "מוקד טלפוני", "מוקדנ*", "Call Center"],
  },
  {
    id: "service.reception",
    group: "service",
    label: "קבלת קהל",
    phrases: ["קבלת קהל", "פקיד* קבלה", "Receptionist", "Front Desk"],
  },

  // אדמיניסטרציה וניהול
  {
    id: "admin.office",
    group: "admin",
    label: "מזכירות ואדמיניסטרציה",
    phrases: ["מזכיר*", "אדמיניסטרצי*", "מנהל* משרד", "Office Manager", "Administrat*"],
  },
  {
    id: "admin.management",
    group: "admin",
    label: "ניהול צוות",
    phrases: ["ניהול צוות", "מנהל* צוות", "Team Lead*", "Team Manager"],
  },
  {
    id: "admin.projects",
    group: "admin",
    label: "ניהול פרויקטים",
    phrases: ["ניהול פרויקט*", "מנהל* פרויקט*", "Project Manag*"],
  },
  {
    id: "admin.logistics",
    group: "admin",
    label: "לוגיסטיקה ורכש",
    phrases: ["לוגיסטיקה", "מנהל* רכש", "קניין", "קניינית", "שרשרת אספקה", "Logistics", "Procurement", "Supply Chain"],
  },

  // משאבי אנוש
  {
    id: "hr.hr",
    group: "hr",
    label: "משאבי אנוש",
    phrases: ["משאבי אנוש", "HR", "Human Resources"],
  },
  {
    id: "hr.recruitment",
    group: "hr",
    label: "גיוס והשמה",
    phrases: ["גיוס עובדים", "רכז* גיוס", "השמה", "Recruit*", "Talent Acquisition"],
  },

  // עיצוב ומדיה
  {
    id: "design.graphic",
    group: "design",
    label: "עיצוב גרפי",
    phrases: ["עיצוב גרפי", "מעצב* גרפי*", "Graphic Design*", "Photoshop", "Illustrator"],
  },
  {
    id: "design.ux",
    group: "design",
    label: "UX/UI",
    phrases: ["UX", "UX/UI", "UI/UX", "Figma", "חוויית משתמש"],
  },
  {
    id: "design.video",
    group: "design",
    label: "וידאו וצילום",
    phrases: ["עריכת וידאו", "עורך וידאו", "עורכת וידאו", "צלם", "צלמת", "Video Edit*", "Premiere"],
  },

  // מדעים ומחקר
  {
    id: "science.life",
    group: "science",
    label: "מדעי החיים",
    phrases: ["ביולוגיה", "ביוטכנולוגיה", "מיקרוביולוגיה", "Biology", "Biotechnology"],
  },
  {
    id: "science.exact",
    group: "science",
    label: "מדעים מדויקים",
    phrases: ["כימיה", "פיזיקה", "מתמטיקה", "Chemistry", "Physics", "Mathematics"],
  },
  {
    id: "science.research",
    group: "science",
    label: "מחקר ומעבדה",
    phrases: ["עוזר* מחקר", "מעבדה", "Research Assistant", "Laboratory"],
  },

  // שפות
  {
    id: "languages.english",
    group: "languages",
    label: "אנגלית",
    phrases: ["אנגלית ברמה גבוהה", "אנגלית שפת אם", "Fluent English", "Native English"],
  },
  {
    id: "languages.arabic",
    group: "languages",
    label: "ערבית",
    phrases: ["ערבית", "Arabic"],
  },
  {
    id: "languages.russian",
    group: "languages",
    label: "רוסית",
    phrases: ["רוסית", "Russian"],
  },
  {
    id: "languages.french",
    group: "languages",
    label: "צרפתית",
    phrases: ["צרפתית", "French"],
  },
  {
    id: "languages.amharic",
    group: "languages",
    label: "אמהרית",
    phrases: ["אמהרית", "Amharic"],
  },
];

const GROUP_IDS = new Set(TOPIC_GROUPS.map((g) => g.id));
const TOPIC_IDS = new Set(TOPICS.map((t) => t.id));

/** A group or a topic id the URL may carry. */
export const isTopicId = (v: string) => GROUP_IDS.has(v) || TOPIC_IDS.has(v);

/** The label to show: "הנדסה" or "הנדסה · הנדסת תוכנה". */
export function topicLabel(id: string): string | null {
  const group = TOPIC_GROUPS.find((g) => g.id === id);
  if (group) return group.label;
  const topic = TOPICS.find((t) => t.id === id);
  if (!topic) return null;
  return `${TOPIC_GROUPS.find((g) => g.id === topic.group)?.label ?? ""} · ${topic.label}`;
}

/** Every id a document is stored under for one matched phrase set: the topic and its group. */
export const ALL_TOPIC_IDS = [...TOPIC_GROUPS.map((g) => g.id), ...TOPICS.map((t) => t.id)];

const HEBREW = /[א-ת]/;
/** Letters that attach to the front of a Hebrew word: and, the, in, to, from, that, as — and their pairs. */
export const HEBREW_PREFIXES = ["", "ו", "ה", "ב", "ל", "מ", "ש", "כ", "וה", "וב", "ול", "ומ", "שה", "שב", "של", "מה"];

/** SOSL reserves these; `*` is left as the wildcard on purpose. */
const escape = (s: string) => s.replace(/[?&|!{}[\]()^~:\\'+-]/g, (c) => `\\${c}`).replace(/"/g, '\\"');

/** Gershayim are written ״ in the list and searched both as ״ and as ", as people type either. */
const quoteForms = (p: string) => (p.includes("״") ? [p, p.replace(/״/g, '"')] : [p]);

/** Every form one phrase is searched in: each prefix, each quote form. */
export function phraseForms(phrase: string): string[] {
  const forms = quoteForms(phrase).flatMap((p) => (HEBREW.test(p) ? HEBREW_PREFIXES.map((pre) => pre + p) : [p]));
  return [...new Set(forms)];
}

/** A SOSL search term: the forms, each as an exact phrase, OR-ed. */
export const soslTerm = (forms: string[]) => forms.map((f) => `"${escape(f)}"`).join(" OR ");

/** Every phrase with the topic ids it counts for (its topic and the group), deduplicated. */
export function phraseIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const add = (phrase: string, ids: string[]) => {
    const set = index.get(phrase) ?? new Set<string>();
    for (const id of ids) set.add(id);
    index.set(phrase, set);
  };
  for (const g of TOPIC_GROUPS) for (const p of g.phrases) add(p, [g.id]);
  for (const t of TOPICS) for (const p of t.phrases) add(p, [t.id, t.group]);
  return index;
}
