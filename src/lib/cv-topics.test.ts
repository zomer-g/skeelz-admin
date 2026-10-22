import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_TOPIC_IDS, isTopicId, phraseForms, phraseIndex, soslTerm, TOPIC_GROUPS, TOPICS, topicLabel } from "./cv-topics";

describe("cv topics", () => {
  it("has unique ids, and every topic sits in a known group under it", () => {
    assert.equal(new Set(ALL_TOPIC_IDS).size, ALL_TOPIC_IDS.length);
    for (const t of TOPICS) {
      assert.ok(TOPIC_GROUPS.some((g) => g.id === t.group), t.id);
      assert.ok(t.id.startsWith(`${t.group}.`), t.id);
      assert.ok(t.phrases.length, t.id);
    }
  });

  it("accepts only its own ids", () => {
    assert.ok(isTopicId("eng"));
    assert.ok(isTopicId("social.work"));
    assert.ok(!isTopicId("eng.unknown"));
    assert.ok(!isTopicId("' OR 1=1"));
    assert.equal(topicLabel("law.lawyer"), "משפטים · עריכת דין");
  });

  it("searches a Hebrew phrase with its prefixes, and gershayim both ways", () => {
    const forms = phraseForms("עו״ס");
    assert.ok(forms.includes("עו״ס") && forms.includes('עו"ס'));
    assert.ok(forms.includes("והעו״ס") && forms.includes('לעו"ס'));
    assert.deepEqual(phraseForms("Social Worker"), ["Social Worker"]);
  });

  it("escapes SOSL syntax but keeps the wildcard", () => {
    assert.equal(soslTerm(['עו"ס']), '"עו\\"ס"');
    assert.equal(soslTerm(["UX/UI", "Full-Stack", "מהנדס*"]), '"UX/UI" OR "Full\\-Stack" OR "מהנדס*"');
  });

  it("counts a phrase for its topic and the topic's group", () => {
    assert.deepEqual([...phraseIndex().get("עובדת סוציאלית")!].sort(), ["social", "social.work"]);
  });
});
