import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobTopics, phraseRegExp, suggestedTopics, titleKeywords } from "./job-topics";

const ids = (title: string, description = "", skills: string[] = []) => suggestedTopics(jobTopics({ title, description, skills }));

describe("phraseRegExp", () => {
  it("matches Hebrew with a prefix letter, not inside another word", () => {
    assert.ok(phraseRegExp("שירות לקוחות").test("ניסיון בשירות לקוחות"));
    assert.ok(phraseRegExp("מורה").test("דרוש/ה מורה למתמטיקה"));
    assert.ok(!phraseRegExp("מורה").test("תמורה הוגנת"));
  });

  it("ends a word with anything at *", () => {
    assert.ok(phraseRegExp("מהנדס* בניין").test("מהנדסת בניין"));
    assert.ok(phraseRegExp("Bookkeep*").test("bookkeeping"));
  });

  it("reads gershayim either way, and English words whole", () => {
    assert.ok(phraseRegExp("עו״ס").test('דרוש/ה עו"ס לקהילה'));
    assert.ok(phraseRegExp("Java").test("Java developer"));
    assert.ok(!phraseRegExp("Java").test("JavaScript"));
  });
});

describe("job topics", () => {
  it("takes the profession from the title", () => {
    assert.deepEqual(ids("עובד/ת סוציאלי/ת"), ["social.work"]);
    assert.deepEqual(ids("עובדת סוציאלית למחלקת רווחה"), ["social.work"]);
    assert.deepEqual(ids("מנהל(ת) פרויקטים"), ["admin.projects"]);
    assert.deepEqual(ids("מנהל/ת חשבונות", "הנהלת חשבונות סוג 3, אקסל ברמה גבוהה").slice(0, 1), ["finance.bookkeeping"]);
  });

  it("needs two signs outside the title", () => {
    assert.deepEqual(ids("רכז/ת", "עבודה מול לקוחות, שירות לקוחות"), ["service.customer"]);
    assert.deepEqual(ids("רכז/ת", "שירות לקוחות", ["שירותיות"]), ["service.customer"]);
  });

  it("falls back to a skill's group", () => {
    assert.deepEqual(ids("משרה כללית", "", ["ידע פיננסי"]), ["finance"]);
    assert.deepEqual(ids("משרה כללית", "", ["עבודה בצוות"]), []);
  });
});

describe("title keywords", () => {
  it("keeps the words that say what the job is", () => {
    assert.deepEqual(titleKeywords("פקיד/ת גביה"), ["פקיד", "גביה"]);
    assert.deepEqual(titleKeywords("מנהל.ת מחלקת שירות"), ["שירות"]);
    assert.deepEqual(titleKeywords("אחראי.ת חנות: סיפור חוזר 50%"), ["חנות", "סיפור", "חוזר"]);
  });
});
