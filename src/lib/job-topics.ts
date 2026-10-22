import { TOPIC_GROUPS, TOPICS, type Topic } from "@/lib/cv-topics";

/**
 * The field of a job, in the terms CVs are tagged with (lib/cv-topics.ts), so the two can be matched
 * for outreach (/outreach). The same phrases that find a profession inside a CV are looked for in
 * the job's title and description, here in code (the job text is in the mirror); the title counts
 * most. The site's skills (lib/skills.ts) only hint at a field: they are broad, and a job lists many.
 */

/** Skills of the site that point at a topic or group. Skills that say nothing of a field are left out. */
const SKILL_TOPICS: Record<string, string> = {
  "ידע פיננסי": "finance",
  "שיווק ומכירות": "sales",
  "ידע טכנולוגי": "tech",
  "הדרכה והוראה": "education",
  "ניתוח והצגת נתונים": "tech.data",
  "אדמיניסטרציה": "admin.office",
  "ניהול אנשים": "admin.management",
  "שירותיות": "service",
  "מיומנויות דיגיטליות": "tech.office",
};

const TITLE_WEIGHT = 3;
const TEXT_WEIGHT = 1;
const SKILL_WEIGHT = 1;
/** A topic is suggested from this score: a title phrase alone, or two signs elsewhere. */
const SUGGEST_FROM = 2;
const MAX_SUGGESTED = 3;

const LETTER = "[\\p{L}\\p{N}]";
const HEBREW = /[א-ת]/;
/** One or two of ו/ה/ב/ל/מ/ש/כ in front of a Hebrew word, as lib/cv-topics.ts searches them. */
const HEBREW_PREFIX = "[ובהלמשכ]{0,2}";

/** A phrase of the topic list as a regular expression over plain text: `*` ends a word with anything. */
export function phraseRegExp(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((word) =>
      [...word]
        .map((c) => (c === "*" ? `${LETTER}*` : c === "״" || c === '"' ? `["״]` : c.replace(/[.?+^$|()[\]{}\\/]/g, "\\$&")))
        .join(""),
    )
    .join("[\\s\\-]+");
  const prefix = HEBREW.test(phrase) ? HEBREW_PREFIX : "";
  return new RegExp(`(?<!${LETTER})${prefix}${body}(?!${LETTER})`, "iu");
}

const MATCHERS: { topic: Topic; phrases: { phrase: string; re: RegExp }[] }[] = TOPICS.map((topic) => ({
  topic,
  phrases: topic.phrases.map((phrase) => ({ phrase, re: phraseRegExp(phrase) })),
}));

export interface JobTopic {
  /** A topic id (`social.work`) or, from a skill alone, a group id (`finance`). */
  id: string;
  score: number;
  /** What pointed at it: phrases found in the title or the description, or the site's skill. */
  inTitle: string[];
  inText: string[];
  skills: string[];
}

export interface JobText {
  title: string | null;
  description: string | null;
  /** Skill names (lib/skills.ts). */
  skills: string[];
}

const FINAL: Record<string, string> = { כ: "ך", מ: "ם", נ: "ן", פ: "ף", צ: "ץ" };

/**
 * Job titles address both genders ("עובד/ת סוציאלי/ת", "מנהל.ת", "מנהל(ת)", "סוכנ/ת"); the phrases are
 * written in one, so the second form is dropped and a letter left at the word's end takes its final form.
 */
export const dropGenderForms = (s: string) =>
  s.replace(/([א-ת])\s*(?:[/\\.]\s*|\()(?:ת|ה|ית|יה|ים|ות|יות|י)\)?(?![א-ת])/gu, (_, last: string) => FINAL[last] ?? last);

/** Every topic the job's text points at, strongest first. */
export function jobTopics(job: JobText): JobTopic[] {
  const found = new Map<string, JobTopic>();
  const entry = (id: string) => {
    let t = found.get(id);
    if (!t) found.set(id, (t = { id, score: 0, inTitle: [], inText: [], skills: [] }));
    return t;
  };
  const title = dropGenderForms(job.title ?? "");
  const text = dropGenderForms(job.description ?? "");
  for (const { topic, phrases } of MATCHERS) {
    for (const { phrase, re } of phrases) {
      if (title && re.test(title)) {
        const t = entry(topic.id);
        t.inTitle.push(phrase);
        t.score += TITLE_WEIGHT;
      } else if (text && re.test(text)) {
        const t = entry(topic.id);
        t.inText.push(phrase);
        t.score += TEXT_WEIGHT;
      }
    }
  }
  for (const skill of job.skills) {
    const id = SKILL_TOPICS[skill];
    if (!id) continue;
    // A skill backs up a topic of its group the text already found; otherwise it stands for the group.
    const backed = [...found.values()].filter((t) => t.id === id || t.id.startsWith(`${id}.`) || id.startsWith(`${t.id}.`));
    for (const t of backed.length ? backed : [entry(id)]) {
      t.skills.push(skill);
      t.score += SKILL_WEIGHT;
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || b.inTitle.length - a.inTitle.length || a.id.localeCompare(b.id));
}

/**
 * The topics to search CVs by: the strong ones, at most three. With none strong, the best one alone,
 * so a job with any sign still gets a search; with no sign at all, none (the person picks).
 */
export function suggestedTopics(topics: JobTopic[]): string[] {
  const strong = topics.filter((t) => t.score >= SUGGEST_FROM).slice(0, MAX_SUGGESTED);
  return (strong.length ? strong : topics.slice(0, 1)).map((t) => t.id);
}

/** Words of a title that say nothing of the field: roles, ranks and filler. */
const TITLE_STOPWORDS = new Set([
  "מנהל", "מנהלת", "רכז", "רכזת", "עובד", "עובדת", "אחראי", "אחראית", "סגן", "סגנית", "ראשי", "ראשית", "בכיר", "בכירה", "זוטר",
  "משרה", "משרת", "חלקית", "מלאה", "דרוש", "דרושה", "דרושים", "לחברת", "בחברת", "חברת", "למחלקת", "מחלקת", "תחום", "איזור", "אזור",
  "מרכז", "פרויקט", "בפריסה", "ארצית", "מהבית", "עם", "של", "או", "לא", "כל", "את",
]);
const MAX_KEYWORDS = 4;

/**
 * The words of a title worth looking for inside CVs, for a job no topic fits ("פקיד/ת גביה" → גביה,
 * פקיד): the gender forms dropped, without role words, numbers or short words.
 */
export function titleKeywords(title: string | null): string[] {
  const words = dropGenderForms(title ?? "")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !TITLE_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

/** The group a topic id belongs to (a group id is its own). */
export const groupOf = (id: string) => id.split(".")[0]!;

/** Known topic and group ids, in the order of the list. */
export const isKnownTopic = (id: string) => TOPIC_GROUPS.some((g) => g.id === id) || TOPICS.some((t) => t.id === id);
