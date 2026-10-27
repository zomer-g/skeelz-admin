import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyExclusions,
  classifyCvArrival,
  countByStatus,
  flagAnomalies,
  isInternal,
  median,
  periodOf,
  periodsBetween,
  periodStartDay,
  timeBucket,
} from "./segments";

const at = (iso: string) => new Date(`${iso}Z`);
const app = (id: string, created: string, contactId: string | null, jobId: string | null, email: string | null = null, name: string | null = null) => ({
  id,
  createdAt: at(created),
  contactId,
  jobId,
  candidateEmail: email,
  candidateName: name,
});

describe("isInternal", () => {
  it("the staff's domain, its + variants and subdomains", () => {
    assert.equal(isInternal({ candidateEmail: "dana@skeelz.co.il", candidateName: "דנה" }), true);
    assert.equal(isInternal({ candidateEmail: "Dana+Test2@SKEELZ.co.il", candidateName: null }), true);
    assert.equal(isInternal({ candidateEmail: "x@jobs.skeelz.co.il", candidateName: null }), true);
    assert.equal(isInternal({ candidateEmail: "dana@skeelz.co.il.example.com", candidateName: null }), false);
  });
  it("test addresses and names, not words that merely contain test", () => {
    assert.equal(isInternal({ candidateEmail: "test1@gmail.com", candidateName: null }), true);
    assert.equal(isInternal({ candidateEmail: "me+test@gmail.com", candidateName: null }), true);
    assert.equal(isInternal({ candidateEmail: "contest@gmail.com", candidateName: null }), false);
    assert.equal(isInternal({ candidateEmail: "a@b.com", candidateName: "Test Test" }), true);
    assert.equal(isInternal({ candidateEmail: "a@b.com", candidateName: "טסט" }), true);
    assert.equal(isInternal({ candidateEmail: "a@b.com", candidateName: "בדיקה שנייה" }), true);
    assert.equal(isInternal({ candidateEmail: "a@b.com", candidateName: "Celeste Testaverde" }), false);
    assert.equal(isInternal({ candidateEmail: null, candidateName: null }), false);
  });
});

describe("applyExclusions", () => {
  it("counts once one person's applications to one job within a minute (00043800 / 00043801)", () => {
    const rows = [
      app("00043800", "2026-10-26T14:11:47", "c1", "j1"),
      app("00043801", "2026-10-26T14:11:47", "c1", "j1"),
      app("later", "2026-10-26T14:13:00", "c1", "j1"), // 73 s after the kept one: a new application
      app("other-job", "2026-10-26T14:11:48", "c1", "j2"),
      app("other-person", "2026-10-26T14:11:48", "c2", "j1"),
    ];
    const r = applyExclusions(rows, { internal: true, dedupe: true }, (x) => x.jobId);
    assert.deepEqual([...r.duplicateIds], ["00043801"]);
    assert.equal(r.kept.length, 4);
    assert.deepEqual(r.excluded, { internal: 0, duplicate: 1 });
  });
  it("a chain is measured from the last kept application, and the earliest is kept", () => {
    const rows = [app("b", "2026-01-01T10:00:50", "c", "j"), app("a", "2026-01-01T10:00:00", "c", "j"), app("c", "2026-01-01T10:01:40", "c", "j")];
    const r = applyExclusions(rows, { internal: false, dedupe: true }, (x) => x.jobId);
    assert.deepEqual(r.kept.map((x) => x.id).sort(), ["a", "c"]);
  });
  it("falls back to the address without a Contact, and merges nothing without a person or a job", () => {
    const rows = [
      app("e1", "2026-01-01T10:00:00", null, "j", "A@x.com"),
      app("e2", "2026-01-01T10:00:10", null, "j", "a@x.com"),
      app("n1", "2026-01-01T10:00:00", null, "j"),
      app("n2", "2026-01-01T10:00:01", null, "j"),
      app("nj1", "2026-01-01T10:00:00", "c", null),
      app("nj2", "2026-01-01T10:00:01", "c", null),
    ];
    const r = applyExclusions(rows, { internal: false, dedupe: true }, (x) => x.jobId);
    assert.deepEqual([...r.duplicateIds], ["e2"]);
  });
  it("internal records go first and are not counted again as duplicates", () => {
    const rows = [app("s1", "2026-01-01T10:00:00", "c", "j", "x@skeelz.co.il"), app("s2", "2026-01-01T10:00:05", "c", "j", "x@skeelz.co.il")];
    const r = applyExclusions(rows, { internal: true, dedupe: true }, (x) => x.jobId);
    assert.deepEqual(r.excluded, { internal: 2, duplicate: 0 });
    assert.equal(applyExclusions(rows, { internal: false, dedupe: false }, (x) => x.jobId).kept.length, 2);
  });
});

describe("countByStatus", () => {
  const row = (id: string, status: string | null, fast: boolean) => ({ id, status, fast, paid: true, ownerName: null, createdAt: at("2025-05-01T10:00:00") });
  it("adds up to the rows in every group", () => {
    const rows = [row("1", "נדחה על ידנו", false), row("2", "נדחה על ידנו", true), row("3", 'לא שלח קו"ח', true), row("4", null, true)];
    const r = countByStatus(rows, "fast");
    assert.deepEqual(r.totals, { fast: 3, regular: 1 });
    assert.equal(r.rows.filter((x) => x.group === "fast").reduce((s, x) => s + x.count, 0), 3);
    assert.ok(r.rows.some((x) => x.group === "fast" && x.status === "(ללא סטטוס)" && x.count === 1));
    assert.deepEqual(countByStatus(rows, "").totals, { all: 4 });
  });
});

describe("time buckets and the median", () => {
  it("puts each span in its bucket, edges inclusive", () => {
    assert.equal(timeBucket(-3), "up_to_10_min");
    assert.equal(timeBucket(10), "up_to_10_min");
    assert.equal(timeBucket(10.5), "10_to_60_min");
    assert.equal(timeBucket(60), "10_to_60_min");
    assert.equal(timeBucket(61), "1_hour_to_1_day");
    assert.equal(timeBucket(24 * 60), "1_hour_to_1_day");
    assert.equal(timeBucket(3 * 24 * 60), "1_to_7_days");
    assert.equal(timeBucket(20 * 24 * 60), "7_to_30_days");
    assert.equal(timeBucket(31 * 24 * 60), "over_30_days");
  });
  it("median of odd and even counts, none when empty", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});

describe("periods", () => {
  it("by the Israel day: 30.6 at 23:30 UTC is already July", () => {
    assert.equal(periodOf(at("2025-06-30T23:30:00"), "month"), "2025-07");
    assert.equal(periodOf(at("2025-06-30T23:30:00"), "quarter"), "2025-Q3");
    assert.equal(periodStartDay("2025-Q3"), "2025-07-01");
    assert.equal(periodStartDay("2025-11"), "2025-11-01");
    assert.deepEqual(periodsBetween("2024-11-15", "2025-02-01", "month"), ["2024-11", "2024-12", "2025-01", "2025-02"]);
    assert.deepEqual(periodsBetween("2024-12-01", "2025-07-01", "quarter"), ["2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3"]);
  });
});

describe("classifyCvArrival", () => {
  const reg = at("2025-07-01T10:00:00");
  const plus = (min: number) => new Date(reg.getTime() + min * 60_000);
  const e = (site: Date | null, mail: Date | null, cvFlag = false) => classifyCvArrival({ registeredAt: reg, siteFileAt: site, mailFileAt: mail, cvFlag });
  it("a site file within 30 minutes came with the registration, later is later on the site", () => {
    assert.equal(e(plus(2), null), "at_registration");
    assert.equal(e(plus(-1), null), "at_registration");
    assert.equal(e(plus(30), null), "at_registration");
    assert.equal(e(plus(31), null), "later_on_site");
  });
  it("a mailed file after the registration is by email; the earliest file decides", () => {
    assert.equal(e(null, plus(5)), "later_by_email");
    assert.equal(e(plus(600), plus(60)), "later_by_email");
    assert.equal(e(plus(1), plus(60)), "at_registration");
    assert.equal(e(plus(60), plus(60)), "later_on_site");
  });
  it("before the registration, the flag alone, or nothing", () => {
    assert.equal(e(null, plus(-24 * 60)), "before_registration");
    assert.equal(e(plus(-31), null), "before_registration");
    assert.equal(e(null, null, true), "at_registration");
    assert.equal(e(null, null, false), "none");
  });
});

describe("flagAnomalies", () => {
  it("flags a wave three times the neighbours with a low CV share, not a busy month with CVs", () => {
    const normal = { registered: 100, withCv: 60 };
    const periods = [normal, normal, { registered: 400, withCv: 40 }, normal, { registered: 350, withCv: 250 }, normal, normal];
    const flags = flagAnomalies(periods);
    assert.deepEqual(
      flags.map((f) => f.anomaly),
      [false, false, true, false, false, false, false],
    );
    assert.equal(flags[2]!.baseline_registered, 100);
    assert.equal(flags[2]!.baseline_cv_share, 0.6);
  });
  it("a long wave stands out against a wide enough window", () => {
    const before = Array.from({ length: 12 }, () => ({ registered: 50, withCv: 30 }));
    const wave = Array.from({ length: 6 }, () => ({ registered: 600, withCv: 30 }));
    const flags = flagAnomalies([...before, ...wave, ...before]);
    assert.ok(flags.slice(12, 18).every((f) => f.anomaly));
    assert.ok(flags.slice(0, 12).every((f) => !f.anomaly));
  });
});
