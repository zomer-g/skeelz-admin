import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCandidateMetrics, normStatus, STATUS, type ApplicationFacts } from "./candidates";
import { rejectReasonLabels } from "./reject-reasons";

const at = (day: string) => new Date(`${day}T10:00:00Z`);

function fact(id: string, over: Partial<ApplicationFacts> & { raw?: string }): ApplicationFacts {
  const { raw, ...rest } = over;
  return {
    id, parentId: null, status: null, recordType: "RecordType2", paid: true, fast: false, contactId: null, candidateEmail: null,
    createdAt: at("2026-11-01"), closedAt: null, candidateName: null, jobTitle: null, company: null, ownerName: null,
    rejectReasons: rejectReasonLabels(raw), firstTouchAt: null, requestedCvAt: null, cvReceivedAt: null, sentAt: null, lastSentAt: null,
    employerResponseAt: null, rejectedByUsAt: null, rejectedByCandidateAt: null, interviewAt: null, acceptedAt: null,
    candidateDroppedAt: null, jobClosedAt: null, candidateTouchesBeforeSent: 0, employerTouchesAfterSent: 0,
    candidateEmails: 0, candidateCalls: 0, employerEmails: 0, employerCalls: 0, ...rest,
  };
}

test("the two rejection statuses are told apart, whatever their spacing", () => {
  assert.equal(normStatus("נדחה על  ידנו"), STATUS.rejectedByUs);
  assert.equal(normStatus("נדחה על ידי מועמד"), STATUS.rejectedByCandidate);
  assert.notEqual(STATUS.rejectedByUs, STATUS.rejectedByCandidate);
});

test("rejected by the candidate: counted by reason, several reasons in each, none last, geo merged", () => {
  const facts = [
    fact("a", { status: STATUS.rejectedByCandidate, raw: "שכר;גיאוגרפי 2" }),
    fact("b", { status: STATUS.rejectedByCandidate, raw: "גיאוגרפי" }),
    fact("c", { status: STATUS.rejectedByCandidate, raw: "הבין את המשר וויתר" }),
    fact("d", { status: STATUS.rejectedByCandidate }),
    // Moved into the status and on to another: still counted on the application basis.
    fact("e", { status: "ליד סגור", rejectedByCandidateAt: at("2026-11-03"), raw: "שכר" }),
    fact("f", { status: STATUS.rejectedByUs, rejectedByUsAt: at("2026-11-02"), raw: "תנאי סף ניסיון" }),
    fact("g", { status: STATUS.rejectedByUs, rejectedByUsAt: at("2026-11-02") }),
  ];
  const m = computeCandidateMetrics(facts, 0, { from: at("2026-10-01"), to: at("2026-12-01"), basis: "application" });
  assert.equal(m.rejectedByCandidate, 5);
  assert.deepEqual(m.candidateRejectReasons, [
    { reason: "שכר", count: 2 },
    { reason: "גיאוגרפי", count: 2 },
    { reason: "הסיר/ה מועמדות לאחר שיחה", count: 1 },
    { reason: "לא צוינה סיבה", count: 1 },
  ]);
  assert.equal(m.rejectedByUs, 2);
  assert.deepEqual(m.rejectReasons, [
    { reason: "ניסיון", count: 1 },
    { reason: "לא צוינה סיבה", count: 1 },
  ]);
});

test("event basis: only the moves into the status inside the range", () => {
  const facts = [
    fact("a", { status: STATUS.rejectedByCandidate, rejectedByCandidateAt: at("2026-11-05"), raw: "שכר" }),
    fact("b", { status: STATUS.rejectedByCandidate, rejectedByCandidateAt: at("2026-09-05"), raw: "שכר" }),
    fact("c", { status: STATUS.rejectedByCandidate }),
  ];
  const m = computeCandidateMetrics(facts, 0, { from: at("2026-11-01"), to: at("2026-12-01"), basis: "event" });
  assert.equal(m.rejectedByCandidate, 1);
  assert.deepEqual(m.candidateRejectReasons, [{ reason: "שכר", count: 1 }]);
});
