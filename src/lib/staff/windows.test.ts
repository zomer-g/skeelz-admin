import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionCategory,
  actionKind,
  attribute,
  demoWindows,
  israelInstant,
  mergeWindows,
  parseTimesheet,
  preferReal,
  summarizeWindows,
  type Action,
  type WorkWindow,
} from "./windows";

// Israel wall-clock times on one day; 2026-10-29 is after the clocks went back (UTC+2).
const at = (day: string, hm: string) => israelInstant(day, Number(hm.slice(0, 2)), Number(hm.slice(3, 5)));
const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }).format(d);
const win = (day: string, from: string, to: string, demo = false): WorkWindow => ({ workDate: day, start: at(day, from), end: at(day, to), demo });
const act = (id: string, day: string, time: string, extra: Partial<Action> = {}): Action => ({
  id,
  at: at(day, time),
  kind: "email",
  category: "other",
  caseId: null,
  caseType: null,
  positionId: null,
  ...extra,
});

describe("israelInstant", () => {
  it("reads Israel wall-clock time in summer and in winter", () => {
    assert.equal(israelInstant("2026-10-20", 9, 0).toISOString(), "2026-10-20T06:00:00.000Z");
    assert.equal(israelInstant("2026-10-29", 9, 0).toISOString(), "2026-10-29T07:00:00.000Z");
  });
});

describe("demoWindows", () => {
  it("one window a day: first task − 15 min down to the quarter, last task + 15 min up to the quarter", () => {
    const w = demoWindows([at("2026-10-29", "13:08"), at("2026-10-29", "10:37"), at("2026-10-29", "11:59")]);
    assert.deepEqual(
      w.map((x) => [x.workDate, hm(x.start), hm(x.end)]),
      [["2026-10-29", "10:15", "13:30"]],
    );
  });

  it("an exact quarter stays put, and each Israel day is its own window", () => {
    const w = demoWindows([at("2026-10-28", "13:45"), at("2026-10-28", "14:00"), at("2026-10-29", "09:30")]);
    assert.deepEqual(
      w.map((x) => [x.workDate, hm(x.start), hm(x.end)]),
      [
        ["2026-10-28", "13:30", "14:15"],
        ["2026-10-29", "09:15", "09:45"],
      ],
    );
  });

  it("a gap of more than two hours splits the day; exactly two hours does not", () => {
    const split = demoWindows([at("2026-10-21", "11:35"), at("2026-10-21", "12:10"), at("2026-10-21", "14:11"), at("2026-10-21", "16:34")]);
    assert.deepEqual(
      split.map((x) => [hm(x.start), hm(x.end)]),
      [
        ["11:15", "12:30"],
        ["13:45", "14:30"],
        ["16:15", "17:00"],
      ],
    );
    const kept = demoWindows([at("2026-10-21", "10:00"), at("2026-10-21", "12:00")]);
    assert.equal(kept.length, 1);
  });

  it("no tasks, no windows", () => {
    assert.deepEqual(demoWindows([]), []);
  });
});

describe("preferReal and mergeWindows", () => {
  it("a day with a real timesheet drops that day's demo rows only", () => {
    const rows = [
      { userId: "u1", source: "demo", ...win("2026-10-20", "09:00", "12:00") },
      { userId: "u1", source: "sheet", ...win("2026-10-20", "08:30", "16:00") },
      { userId: "u1", source: "demo", ...win("2026-10-21", "09:00", "12:00") },
      { userId: "u2", source: "demo", ...win("2026-10-20", "09:00", "12:00") },
    ];
    assert.deepEqual(
      preferReal(rows).map((r) => [r.userId, r.source, r.workDate]),
      [
        ["u1", "sheet", "2026-10-20"],
        ["u1", "demo", "2026-10-21"],
        ["u2", "demo", "2026-10-20"],
      ],
    );
  });

  it("overlapping and touching windows become one; empty ones are dropped", () => {
    const merged = mergeWindows([
      { ...win("2026-10-20", "13:00", "15:00"), source: "sheet" },
      { ...win("2026-10-20", "09:00", "11:00"), source: "demo" },
      { ...win("2026-10-20", "10:30", "12:00"), source: "sheet" },
      { ...win("2026-10-20", "12:00", "12:30"), source: "sheet" },
      { ...win("2026-10-20", "17:00", "17:00"), source: "sheet" },
    ]);
    assert.deepEqual(
      merged.map((w) => [hm(w.start), hm(w.end), w.demo]),
      [
        ["09:00", "12:30", true],
        ["13:00", "15:00", false],
      ],
    );
  });
});

describe("attribute", () => {
  it("each action gets the minutes since the previous one (the first: since the window opened), at most 45; the rest is unassigned", () => {
    const w = [win("2026-10-29", "10:15", "13:30")];
    const r = attribute(w, [act("c", "2026-10-29", "12:10"), act("a", "2026-10-29", "10:37"), act("b", "2026-10-29", "10:41")]);
    assert.deepEqual(
      r.actions.map((a) => [a.id, a.minutes]),
      [
        ["a", 22],
        ["b", 4],
        ["c", 45],
      ],
    );
    assert.deepEqual([r.windows[0]!.minutes, r.windows[0]!.actions, r.windows[0]!.attributed, r.windows[0]!.unassigned], [195, 3, 71, 124]);
  });

  it("an action outside every window gets no time; each window counts from its own start", () => {
    const w = [win("2026-10-21", "11:15", "12:30"), win("2026-10-21", "16:15", "17:00")];
    const r = attribute(w, [act("in1", "2026-10-21", "11:35"), act("out", "2026-10-21", "14:00"), act("in2", "2026-10-21", "16:34")]);
    assert.deepEqual(
      r.actions.map((a) => [a.id, a.window, a.minutes]),
      [
        ["in1", 0, 20],
        ["out", null, 0],
        ["in2", 1, 19],
      ],
    );
  });

  it("two actions at the same minute: the second gets nothing", () => {
    const r = attribute([win("2026-10-21", "16:00", "17:00")], [act("a", "2026-10-21", "16:39"), act("b", "2026-10-21", "16:39")]);
    assert.deepEqual(r.actions.map((a) => a.minutes), [39, 0]);
  });
});

describe("actionKind and actionCategory", () => {
  it("kinds as the monthly counts have them", () => {
    assert.equal(actionKind("Email", "Call"), "email");
    assert.equal(actionKind("Call", null), "call");
    assert.equal(actionKind(null, "Call - outbound"), "call");
    assert.equal(actionKind("Task", "Other"), "task");
    assert.equal(actionKind(null, null), "task");
  });

  it("subjects from real tasks", () => {
    const sub = "RecordType2";
    assert.equal(actionCategory(sub, "דואר אלקטרוני: קיבלנו את מועמדותך למשרת בנקאי.ת כל | סקילז"), "cv_request");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: RE: קיבלנו את מועמדותך למשרת מנהל/ת מרפאת רמת השרון | ס"), "cv_request");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: Re: הגשה למשרה: מנהל.ת חשבונות- שלחי בבקשה קורות חיים בהקדם"), "cv_request");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: SKEELZ | מועמד/ת למשרת בנקאי.ת כל – פלונית"), "employer");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: RE:  SKEELZ | מועמדת למשרת פקידת גביה  – פלונית"), "employer");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: RE: הגשה למשרה: רכז.ת אדמיניסטרטיבי.ת-ישותנו , פלונית"), "employer");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: עדכון סטטוס: מועמדים למשרת בנקאי.ת כל | סקילז"), "employer");
    assert.equal(actionCategory(sub, "שיחה"), "candidate");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: עידכון מסקילז"), "candidate");
    assert.equal(actionCategory(sub, null), "candidate");
    assert.equal(actionCategory("cv_message", "שיחה"), "cv_request");
    assert.equal(actionCategory("WEHAVE", "דואר אלקטרוני: קיבלנו את מועמדותך למשרת x"), "other");
    assert.equal(actionCategory(null, "קורות חיים"), "other");
  });
});

describe("summarizeWindows", () => {
  it("hours, rates, averages, submissions, categories and jobs", () => {
    const day = "2026-10-29";
    const s = summarizeWindows(
      [win(day, "10:00", "12:00")],
      [
        act("1", day, "10:10", { kind: "email", category: "cv_request", caseId: "S1", caseType: "RecordType2", positionId: "P1" }),
        act("2", day, "10:30", { kind: "call", category: "candidate", caseId: "S1", caseType: "RecordType2", positionId: "P1" }),
        act("3", day, "10:40", { kind: "email", category: "employer", caseId: "S2", caseType: "RecordType2", positionId: "P2" }),
        act("4", day, "11:40", { kind: "task", category: "other", caseId: "X", caseType: "Position" }),
        act("5", day, "15:00", { kind: "email", category: "cv_request", caseId: "S3", caseType: "RecordType2", positionId: "P1" }),
      ],
    );
    assert.equal(s.hours, 2);
    assert.deepEqual(s.inWindow, { total: 4, email: 2, call: 1, task: 1 });
    assert.deepEqual(s.outside, { total: 1, email: 1, call: 0, task: 0 });
    // 10 + 20 + 10 + 45 = 85 minutes credited, 35 unassigned.
    assert.equal(s.attributedHours * 60, 85);
    assert.equal(s.unassignedHours * 60, 35);
    assert.deepEqual(s.perHour, { total: 2, email: 1, call: 0.5, task: 0.5 });
    assert.equal(s.avgMinutes.total, 85 / 4);
    assert.equal(s.avgMinutes.email, 10);
    assert.equal(s.avgMinutes.call, 20);
    assert.equal(s.submissions, 2);
    assert.equal(s.submissionMinutes, 40);
    assert.equal(s.avgPerSubmission, 20);
    assert.deepEqual(s.categories.cv_request, { actions: 1, minutes: 10 });
    assert.deepEqual(s.categories.candidate, { actions: 1, minutes: 20 });
    assert.deepEqual(s.categories.employer, { actions: 1, minutes: 10 });
    assert.deepEqual(s.categories.other, { actions: 1, minutes: 45 });
    assert.deepEqual(s.positions, [
      { positionId: "P1", minutes: 30, actions: 2, submissions: 1 },
      { positionId: "P2", minutes: 10, actions: 1, submissions: 1 },
    ]);
  });

  it("no windows: every action is outside and there are no rates", () => {
    const s = summarizeWindows([], [act("1", "2026-10-29", "10:10")]);
    assert.equal(s.hours, 0);
    assert.equal(s.perHour, null);
    assert.equal(s.avgMinutes.total, null);
    assert.equal(s.outside.total, 1);
  });
});

describe("parseTimesheet", () => {
  it("reads email or id, ISO or Israeli dates, Israel times; skips a header; lowercases who", () => {
    const { rows, errors } = parseTimesheet(
      "﻿email,date,from,to\nSarit@Example.com,2026-10-20,09:00,13:30\n\n0b0c1d2e-0000-4000-8000-000000000001\t29.10.2026\t8:15\t12:00\n",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      rows.map((r) => [r.line, r.who, r.workDate, r.start.toISOString(), r.end.toISOString()]),
      [
        [2, "sarit@example.com", "2026-10-20", "2026-10-20T06:00:00.000Z", "2026-10-20T10:30:00.000Z"],
        [4, "0b0c1d2e-0000-4000-8000-000000000001", "2026-10-29", "2026-10-29T06:15:00.000Z", "2026-10-29T10:00:00.000Z"],
      ],
    );
  });

  it("bad lines are errors with their line number, nothing is guessed", () => {
    const { rows, errors } = parseTimesheet("a@b.c;2026-10-20;09:00;17:00\na@b.c;31.02.2026;09:00;10:00\na@b.c;2026-10-21;9am;10:00\na@b.c;2026-10-21;12:00;11:00\n;2026-10-21;09:00;10:00");
    assert.equal(rows.length, 1);
    assert.deepEqual(
      errors.map((e) => e.line),
      [2, 3, 4, 5],
    );
  });
});
