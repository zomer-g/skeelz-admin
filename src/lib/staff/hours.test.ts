import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMondayItem, rowsForLinked, summarize, weekOf, type MondayItem } from "./hours";
import { parseMonth, recentMonths } from "./data";

// Shaped like the board's real answer (28.10.2026).
const item = (id: string, cols: Record<string, { text: string | null; value?: string | null }>, name = `task ${id}`): MondayItem => ({
  id,
  name,
  url: `https://skeelz-unit.monday.com/boards/5106546225/pulses/${id}`,
  column_values: Object.entries(cols).map(([cid, c]) => ({ id: cid, text: c.text, value: c.value ?? null })),
});
const GUY = "120173361";
const HAGAI = "555";
const people = (...ids: string[]) => JSON.stringify({ personsAndTeams: ids.map((id) => ({ id: Number(id), kind: "person" })) });

describe("parseMondayItem", () => {
  it("reads the date, the hours label, the people and the notes", () => {
    const w = parseMondayItem(
      item("3302132921", {
        date_mm8j7f52: { text: "2026-10-22" },
        color_mm8jcnc: { text: "1.5", value: '{"index":9}' },
        multiple_person_mm8cmxq0: { text: "Guy Zomer", value: people(GUY) },
        text_mm8cqt5: { text: "  " },
      }),
    );
    assert.deepEqual(
      { doneOn: w.doneOn, hours: w.hours, assigneeIds: w.assigneeIds, notes: w.notes },
      { doneOn: "2026-10-22", hours: 1.5, assigneeIds: [GUY], notes: null },
    );
  });

  it("keeps the board and when the task entered Done (the status value's changed_at)", () => {
    const w = parseMondayItem(
      item("3302132921", { color_mm8cnb8e: { text: "Done", value: '{"index":1,"post_id":null,"changed_at":"2026-10-22T19:25:15.348Z"}' } }),
      { id: "5106546225", name: "משימות סיילספורס" },
    );
    assert.equal(w.doneAt?.toISOString(), "2026-10-22T19:25:15.348Z");
    assert.deepEqual([w.boardId, w.boardName], ["5106546225", "משימות סיילספורס"]);
    assert.equal(parseMondayItem(item("4", { color_mm8cnb8e: { text: "Done", value: '{"index":1}' } })).doneAt, null);
    assert.equal(parseMondayItem(item("5", { color_mm8cnb8e: { text: "Done", value: "{oops" } })).doneAt, null);
  });

  it("no hours and no date stay null, teams are not people, bad JSON is nobody", () => {
    const w = parseMondayItem(
      item("1", {
        date_mm8j7f52: { text: "" },
        color_mm8jcnc: { text: "" },
        multiple_person_mm8cmxq0: { text: "x", value: JSON.stringify({ personsAndTeams: [{ id: 9, kind: "team" }, { id: 7, kind: "person" }] }) },
      }),
    );
    assert.equal(w.doneOn, null);
    assert.equal(w.hours, null);
    assert.deepEqual(w.assigneeIds, ["7"]);
    assert.deepEqual(parseMondayItem(item("2", { multiple_person_mm8cmxq0: { text: "", value: "{oops" } })).assigneeIds, []);
    assert.equal(parseMondayItem(item("3", { color_mm8jcnc: { text: "0" } })).hours, null);
  });
});

describe("rowsForLinked", () => {
  const items = [
    parseMondayItem(item("a", { multiple_person_mm8cmxq0: { text: "", value: people(GUY) }, color_mm8jcnc: { text: "2" } })),
    parseMondayItem(item("b", { multiple_person_mm8cmxq0: { text: "", value: people(HAGAI) }, color_mm8jcnc: { text: "3" } })),
    parseMondayItem(item("c", { multiple_person_mm8cmxq0: { text: "", value: people(GUY, HAGAI) }, color_mm8jcnc: { text: "1" } })),
  ];

  it("keeps only the tasks of linked people; someone not linked is never stored", () => {
    const rows = rowsForLinked(items, new Map([[GUY, "user-guy"]]));
    assert.deepEqual(
      rows.map((r) => [r.externalId, r.userId, r.shared]),
      [
        ["a", "user-guy", false],
        ["c", "user-guy", true],
      ],
    );
    assert.equal(rowsForLinked(items, new Map()).length, 0);
  });

  it("a task of two linked people is a row each, with distinct ids", () => {
    const rows = rowsForLinked(items, new Map([[GUY, "u1"], [HAGAI, "u2"]]));
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((r) => r.id)).size, 4);
  });
});

describe("summarize", () => {
  it("totals by month and by week (from Sunday); tasks without hours or date are counted apart", () => {
    const s = summarize([
      { doneOn: "2026-10-22", hours: 1.5 }, // Thursday → week of 18.10
      { doneOn: "2026-10-25", hours: 0.25 }, // Sunday → week of 25.10
      { doneOn: "2026-10-26", hours: null },
      { doneOn: "2026-09-30", hours: 4 },
      { doneOn: null, hours: 2 },
    ]);
    assert.equal(s.hours, 7.75);
    assert.equal(s.tasks, 5);
    assert.equal(s.withoutHours, 1);
    assert.equal(s.withoutDate, 1);
    assert.deepEqual(s.byMonth, [
      { month: "2026-10", hours: 1.75, tasks: 3 },
      { month: "2026-09", hours: 4, tasks: 1 },
    ]);
    assert.deepEqual(
      s.byWeek.map((w) => [w.week, w.hours]),
      [
        ["2026-10-25", 0.25],
        ["2026-10-18", 1.5],
        ["2026-09-27", 4],
      ],
    );
  });

  it("weeks start on Sunday", () => {
    assert.equal(weekOf("2026-10-25"), "2026-10-25");
    assert.equal(weekOf("2026-10-31"), "2026-10-25");
    assert.equal(weekOf("2026-11-01"), "2026-11-01");
  });
});

describe("staff months", () => {
  it("lists the last months newest first, across the year", () => {
    assert.deepEqual(recentMonths(4, "2026-02-14"), ["2026-02", "2026-01", "2025-12", "2025-11"]);
    assert.equal(recentMonths(12, "2026-10-28").at(-1), "2025-11");
  });

  it("accepts only a real YYYY-MM", () => {
    assert.equal(parseMonth("2026-10"), "2026-10");
    assert.equal(parseMonth("2026-13"), null);
    assert.equal(parseMonth("2026-10' OR 1=1"), null);
  });
});
