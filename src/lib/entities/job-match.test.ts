import assert from "node:assert/strict";
import { test } from "node:test";
import { rankJobs } from "./job-match";
import type { OutreachJob } from "./outreach";

const NOW = new Date("2026-11-24T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function job(id: string, suggested: string[], napa: number | null, kind: OutreachJob["place"]["kind"] = "locality", age = 200): OutreachJob {
  return {
    id, caseNumber: null, title: id, company: null, companyKey: null, status: "Active", paid: false,
    place: { kind, locality: null, subdistrict: null, district: null }, napa, skills: [], createdAt: daysAgo(age),
    topics: [], suggested, keywords: [],
  };
}

const base = { napa: 51, reach: "all" as const, withApplied: false, applied: new Set<string>(), now: NOW };

test("scores a job the same way outreach scores the person: topic, its field, place, freshness", () => {
  const [row] = rankJobs([job("a", ["social.work"], 51, "locality", 10)], { ...base, topics: ["social.work"] });
  // topic 3 + its broad field 1 + same sub-district 3 + opened in the last 30 days 1
  assert.equal(row!.score, 8);
  assert.deepEqual(row!.matched, ["social.work", "social"]);
  assert.equal(row!.near, "napa");
});

test("a topic of the same field matches through the group only", () => {
  const [row] = rankJobs([job("a", ["social.community"], null)], { ...base, topics: ["social.work"] });
  assert.equal(row!.score, 1);
  assert.deepEqual(row!.matched, ["social"]);
});

test("jobs with no field match are not listed; better matches first", () => {
  const rows = rankJobs([job("law", ["law.lawyer"], 51), job("far", ["social.work"], 11), job("near", ["social.work"], 52)], {
    ...base,
    topics: ["social.work"],
  });
  assert.deepEqual(rows.map((r) => r.job.id), ["near", "far"]);
  assert.equal(rows[0]!.near, "district");
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
});

test("reach narrows by place, but nationwide and from-home jobs stay", () => {
  const jobs = [job("same", ["social.work"], 51), job("district", ["social.work"], 52), job("other", ["social.work"], 11), job("remote", ["social.work"], null, "remote"), job("unknown", ["social.work"], null)];
  const ids = (reach: "napa" | "district" | "all") => rankJobs(jobs, { ...base, topics: ["social.work"], reach }).map((r) => r.job.id).sort();
  assert.deepEqual(ids("napa"), ["remote", "same"]);
  assert.deepEqual(ids("district"), ["district", "remote", "same"]);
  assert.deepEqual(ids("all"), ["district", "other", "remote", "same", "unknown"]);
});

test("jobs already applied to are hidden unless asked for", () => {
  const jobs = [job("a", ["social.work"], 51)];
  const applied = new Set(["a"]);
  assert.equal(rankJobs(jobs, { ...base, topics: ["social.work"], applied }).length, 0);
  const [row] = rankJobs(jobs, { ...base, topics: ["social.work"], applied, withApplied: true });
  assert.equal(row!.applied, true);
});
