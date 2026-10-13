import test from "node:test";
import assert from "node:assert/strict";
import { compareWorkDeadlines, formatWorkDeadline, getWorkTiming, parseWorkDate, workDurationMinutes } from "../../lib/workDates";
import { workItemResponse } from "../../lib/api/work";

const now = new Date("2026-10-11T06:30:00Z"); // noon in India

test("real earning records without due_at remain visible without fabricated deadlines", () => {
  const row = workItemResponse({ id: "GIGCRED-QA", status: "Approved", reward_inr: 64.09, sla_minutes: 0 });
  assert.equal(row.dueAt, undefined);
  assert.equal(row.rewardINR, 64.09);
  assert.deepEqual(getWorkTiming({ dueAt: row.dueAt, status: String(row.status), slaMinutes: Number(row.slaMinutes) }, now), { dueInMin: undefined, overdue: false });
  assert.equal(formatWorkDeadline(row.dueAt), "No deadline");
});

test("absent, malformed and impossible timestamps cannot crash or generate overdue work", () => {
  for (const dueAt of [undefined, null, "", {}, 123, "not a date", "2026-10-11", "2026-02-30T12:00", "2026-10-11T24:00", "2026-10-11T12:60", "2026-10-11T12:00+05:60"]) {
    assert.equal(parseWorkDate(dueAt), null);
    assert.equal(formatWorkDeadline(dueAt, true), "No deadline");
    assert.deepEqual(getWorkTiming({ dueAt, status: "Open" }, now), { dueInMin: undefined, overdue: false });
  }
});

test("server India-local timestamps and explicit ISO offsets represent the same instant", () => {
  for (const value of ["2026-10-11T12:00", "2026-10-11 12:00", "2026-10-11T12:00:00+05:30", "2026-10-11T06:30:00Z", "2026-10-11T02:30:00-04:00"]) {
    assert.equal(parseWorkDate(value)?.getTime(), now.getTime());
    assert.equal(formatWorkDeadline(value, true), "2026-10-11 12:00 Asia/Kolkata");
  }
  assert.equal(parseWorkDate("2024-02-29T12:00:01.123456Z")?.toISOString(), "2024-02-29T12:00:01.123Z");
});

test("scheduled rows sort by deadline, with unscheduled rows last and stable", () => {
  const rows = [undefined, "2026-10-11T14:00", null, "2026-10-11T11:00", "invalid"].map(dueAt => ({ dueAt }));
  assert.deepEqual(rows.sort((a, b) => compareWorkDeadlines(a.dueAt, b.dueAt)).map(row => row.dueAt), ["2026-10-11T11:00", "2026-10-11T14:00", undefined, null, "invalid"]);
  assert.equal(compareWorkDeadlines(undefined, null), 0);
});

test("real deadlines and active SLA clocks still update, completed clocks stop", () => {
  const item = { dueAt: "2026-10-11T11:30", startedAt: "2026-10-11T11:00", slaMinutes: 45, status: "In progress" };
  assert.deepEqual(getWorkTiming(item, now), { dueInMin: -30, overdue: true, slaRemaining: -15, slaBreached: true });
  assert.equal(getWorkTiming(item, new Date(now.getTime() + 60_000)).slaRemaining, -16);
  assert.deepEqual(getWorkTiming({ ...item, status: "Approved", completedAt: "2026-10-11T11:30" }, now), { dueInMin: -30, overdue: false, slaRemaining: 15, slaBreached: false });
});

test("no SLA or invalid start times do not count as breaches", () => {
  for (const values of [{ startedAt: "invalid", slaMinutes: 45 }, { startedAt: "2026-10-11T09:00", slaMinutes: 0 }, { startedAt: undefined, slaMinutes: 45 }]) {
    const timing = getWorkTiming({ status: "In progress", ...values }, now);
    assert.equal(timing.slaRemaining, undefined);
    assert.equal(timing.slaBreached, undefined);
  }
  assert.equal(workDurationMinutes("invalid", "2026-10-11T12:00"), undefined);
  assert.equal(workDurationMinutes("2026-10-11T12:00", "2026-10-11T11:00"), undefined);
  assert.equal(workDurationMinutes("2026-10-11T11:00", "2026-10-11T12:00"), 60);
});
