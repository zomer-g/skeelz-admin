import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionCategory,
  actionKind,
  attribute,
  demoWindows,
  fitWindows,
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
  it("each action gets the minutes since the previous one (the first: since the window opened); after a break of more than 45 it gets 15; the rest is unassigned", () => {
    const w = [win("2026-10-29", "10:15", "13:30")];
    const r = attribute(w, [act("c", "2026-10-29", "12:10"), act("a", "2026-10-29", "10:37"), act("b", "2026-10-29", "10:41")]);
    assert.deepEqual(
      r.actions.map((a) => [a.id, a.minutes, a.afterBreak]),
      [
        ["a", 22, false],
        ["b", 4, false],
        ["c", 15, true],
      ],
    );
    assert.deepEqual([r.windows[0]!.minutes, r.windows[0]!.actions, r.windows[0]!.attributed, r.windows[0]!.unassigned], [195, 3, 41, 154]);
  });

  it("exactly 45 minutes is still work on the action; the first action after a long opening is a break too", () => {
    const r = attribute([win("2026-10-29", "09:00", "12:00")], [act("a", "2026-10-29", "10:00"), act("b", "2026-10-29", "10:45")]);
    assert.deepEqual(r.actions.map((a) => [a.id, a.minutes]), [["a", 15], ["b", 45]]);
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

  it("אסתי's templates (October 2026)", () => {
    const sub = "RecordType2";
    // Sending a candidate to the employer, in her wording, and the reminder on the same thread.
    assert.equal(actionCategory(sub, "דואר אלקטרוני: הגשת מועמדות למשרה: מנהל.ת פרויקטים יוזמות עסקיות- פלונית"), "employer");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: RE: הגשת מועמדות למשרה: מודדת סוקרת לצרכי ארנונה- פלונית -תזכורת לעדכון סטטוס"), "employer");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: הגשה למשרות: סגנ.ית שיקום - פלונית"), "employer");
    // A CV sent on to the employer is not a CV request.
    assert.equal(actionCategory(sub, "דואר אלקטרוני: הגשה למשרה: רכז/ת לידים ודאטה- קורות חיים של פלוני"), "employer");
    // Asking the candidate for a CV, even under "הגשה למשרה".
    assert.equal(actionCategory(sub, "דואר אלקטרוני: הגשה למשרה: אחראית חנות: סיפור חוזר 50%- בבקשה שלחי קורות חיים בהקדם"), "cv_request");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: FW: קיבלתי את בקשתך להגיש מועמדות למשרת מנהלת אזור- בבקשה שלחי קורות חיים עדכניים- תזכורת!!!"), "cv_request");
    assert.equal(actionCategory(sub, "דואר אלקטרוני: קורות חיים"), "cv_request");
  });
});

describe("fitWindows", () => {
  it("covers every action and pays for it from the day's breaks, splitting windows (שרית, 29.10.2026)", () => {
    // The reconstruction cut each hour to :15–:45 and left 09:59 and 11:11 outside.
    const w = [win("2026-10-29", "09:15", "09:45"), win("2026-10-29", "11:15", "13:45")];
    const times = ["09:20", "09:30", "09:44", "09:59", "11:11", "12:08", "12:12", "12:14", "12:20", "13:32", "13:39"].map((t) => at("2026-10-29", t));
    const r = fitWindows(w, times);
    const span = r.windows.map((x) => `${hm(x.start)}-${hm(x.end)}`);
    for (const t of times) assert.ok(r.windows.some((x) => x.start <= t && t <= x.end), `${hm(t)} is inside`);
    const minutes = r.windows.reduce((s, x) => s + (x.end.getTime() - x.start.getTime()) / 60_000, 0);
    // 09:59 and 11:11 add half an hour each; the breaks 11:26–11:53 and 12:35–13:17 give back 15 and 30.
    assert.deepEqual(span, ["09:15-10:15", "10:45-11:30", "11:45-12:45", "13:15-13:45"]);
    assert.equal(minutes, 195);
    assert.deepEqual([r.covered, r.addedMinutes, r.freedMinutes, r.splits], [2, 60, 45, 2]);
  });

  it("the time can come from another day's break, so the month's total stays", () => {
    const w = [win("2026-10-29", "09:15", "09:45"), win("2026-10-28", "09:00", "13:00")];
    const times = [at("2026-10-29", "09:30"), at("2026-10-29", "09:59"), at("2026-10-28", "09:10"), at("2026-10-28", "12:50")];
    const r = fitWindows(w, times);
    const minutes = r.windows.reduce((s, x) => s + (x.end.getTime() - x.start.getTime()) / 60_000, 0);
    assert.equal(minutes, 30 + 240);
    for (const t of times) assert.ok(r.windows.some((x) => x.start <= t && t <= x.end));
    assert.equal(r.splits, 1);
  });

  it("never invents a timesheet for a day that has none (a range reaching into a month with no report)", () => {
    const w = [win("2026-10-29", "09:00", "10:00")];
    const r = fitWindows(w, [at("2026-10-29", "09:30"), at("2026-11-02", "10:00"), at("2026-11-03", "12:00")]);
    assert.deepEqual(r.windows.map((x) => [x.workDate, hm(x.start), hm(x.end)]), [["2026-10-29", "09:00", "10:00"]]);
    assert.deepEqual([r.covered, r.addedMinutes], [0, 0]);
  });

  it("an action far from every window gets a window of its own; nothing to free leaves the total larger, never an action outside", () => {
    const w = [win("2026-10-20", "09:00", "09:30")];
    const times = [at("2026-10-20", "09:10"), at("2026-10-20", "16:40")];
    const r = fitWindows(w, times);
    assert.deepEqual(r.windows.map((x) => `${hm(x.start)}-${hm(x.end)}`), ["09:00-09:30", "16:15-17:00"]);
    assert.equal(r.addedMinutes, 45);
    assert.equal(r.freedMinutes, 0);
  });

  it("counts every action that was outside, also one an earlier extension took in", () => {
    const r = fitWindows([win("2026-10-07", "16:15", "16:45")], ["16:30", "16:48", "16:52", "16:55"].map((t) => at("2026-10-07", t)));
    assert.equal(r.covered, 3);
    assert.deepEqual(r.windows.map((x) => `${hm(x.start)}-${hm(x.end)}`), ["16:15-17:15"]);
  });

  it("windows with no action are left alone, and nothing changes when every action is inside", () => {
    const w = [win("2026-10-18", "09:00", "11:45"), win("2026-10-18", "20:00", "21:45")];
    const r = fitWindows(w, [at("2026-10-18", "20:03"), at("2026-10-18", "21:03")]);
    assert.deepEqual(r.windows.map((x) => `${hm(x.start)}-${hm(x.end)}`), ["09:00-11:45", "20:00-21:45"]);
    assert.deepEqual([r.covered, r.addedMinutes, r.freedMinutes, r.splits], [0, 0, 0, 0]);
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
    // 10 + 20 + 10 + 15 (after an hour's break) = 55 minutes credited, 65 unassigned.
    assert.equal(s.attributedHours * 60, 55);
    assert.equal(s.unassignedHours * 60, 65);
    assert.equal(s.afterBreak, 1);
    // Every action in the range counts, the one at 15:00 outside the window too: 5 actions in 2 hours.
    assert.deepEqual(s.perHour, { total: 2.5, email: 1.5, call: 0.5, task: 0.5 });
    assert.equal(s.minutesPerAction, 24);
    assert.equal(s.minutesPerAction! * s.perHour!.total, 60);
    // The attribution model stays for the per-kind figures: credited minutes per action in a window.
    assert.equal(s.avgMinutes.total, 55 / 4);
    assert.equal(s.avgMinutes.email, 10);
    assert.equal(s.avgMinutes.call, 20);
    assert.equal(s.submissions, 2);
    assert.equal(s.submissionMinutes, 40);
    assert.equal(s.avgPerSubmission, 20);
    assert.deepEqual(s.categories.cv_request, { actions: 1, minutes: 10 });
    assert.deepEqual(s.categories.candidate, { actions: 1, minutes: 20 });
    assert.deepEqual(s.categories.employer, { actions: 1, minutes: 10 });
    assert.deepEqual(s.categories.other, { actions: 1, minutes: 15 });
    assert.deepEqual(s.positions, [
      { positionId: "P1", minutes: 30, actions: 2, submissions: 1 },
      { positionId: "P2", minutes: 10, actions: 1, submissions: 1 },
    ]);
  });

  it("time per record type: every Case type, Accounts and nothing, minutes per distinct record", () => {
    const day = "2026-10-29";
    const s = summarizeWindows(
      [win(day, "10:00", "12:00")],
      [
        act("1", day, "10:10", { caseId: "S1", caseType: "RecordType2" }),
        act("2", day, "10:30", { caseId: "C1", caseType: "call" }),
        act("3", day, "10:40", { caseId: "C1", caseType: "call" }),
        act("4", day, "11:00", { caseId: "C2", caseType: "call" }),
        act("5", day, "11:05", { caseId: "W1", caseType: "WEHAVE" }),
        act("6", day, "11:15", { accountId: "001A" }),
        act("7", day, "11:20", {}),
        act("8", day, "11:30", { caseId: "N1", caseType: null }),
        act("9", day, "15:00", { caseId: "W2", caseType: "WEHAVE" }),
      ],
    );
    assert.deepEqual(s.targets, [
      { key: "call", minutes: 50, actions: 3, records: 2, avgPerRecord: 25 },
      { key: "@none", minutes: 15, actions: 2, records: 0, avgPerRecord: null },
      { key: "RecordType2", minutes: 10, actions: 1, records: 1, avgPerRecord: 10 },
      { key: "@account", minutes: 10, actions: 1, records: 1, avgPerRecord: 10 },
      { key: "WEHAVE", minutes: 5, actions: 1, records: 1, avgPerRecord: 5 },
    ]);
    assert.equal(s.submissions, 1);
  });

  it("minutes per action = hours / every action, the reciprocal of actions per hour", () => {
    const day = "2026-10-01";
    // October-like: 64 hours, 163 actions, one of them outside the windows.
    const windows = Array.from({ length: 8 }, (_, i) => win(`2026-10-${String(i + 1).padStart(2, "0")}`, "09:00", "17:00"));
    const actions = Array.from({ length: 162 }, (_, i) => act(String(i), `2026-10-${String((i % 8) + 1).padStart(2, "0")}`, `${String(9 + Math.floor(i / 8) % 8).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`));
    actions.push(act("out", day, "20:00"));
    const s = summarizeWindows(windows, actions);
    assert.equal(s.hours, 64);
    assert.equal(s.outside.total, 1);
    assert.equal(s.minutesPerAction, (64 * 60) / 163);
    assert.ok(Math.abs(s.minutesPerAction! * s.perHour!.total - 60) < 1e-9);
    assert.equal(Math.round(s.minutesPerAction! * 10) / 10, 23.6);
    assert.equal(Math.round(s.perHour!.total * 10) / 10, 2.5);
  });

  it("no windows: every action is outside and there are no rates", () => {
    const s = summarizeWindows([], [act("1", "2026-10-29", "10:10")]);
    assert.equal(s.hours, 0);
    assert.equal(s.perHour, null);
    assert.equal(s.minutesPerAction, null);
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
