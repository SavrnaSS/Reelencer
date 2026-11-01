import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_PRESETS, DEFAULT_ACTIVITY_FILTERS, activeActivityFilterCount, isPresetActive, matchesActivity, presetFilters, setupStage, type WorkerActivity } from "@/lib/workerActivity";

const now = Date.parse("2026-11-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const f = (patch: Partial<typeof DEFAULT_ACTIVITY_FILTERS>) => ({ ...DEFAULT_ACTIVITY_FILTERS, ...patch });

test("account setup stages follow the application and its bio check", () => {
  const cp = (status: string, setup?: { status?: string; ownership?: string }) => setupStage({ contentPosting: true, status, setup });
  assert.equal(setupStage({ contentPosting: false, status: "Pending" }), "none");
  assert.equal(cp("Pending"), "not_started");
  assert.equal(cp("Pending", { status: "Submitted", ownership: "missing" }), "code_missing");
  assert.equal(cp("Pending", { status: "Submitted", ownership: "unreadable" }), "unreadable");
  assert.equal(cp("Pending", { status: "Submitted", ownership: "found" }), "awaiting_review");
  assert.equal(cp("Pending", { status: "Submitted", ownership: "manual" }), "awaiting_review");
  assert.equal(cp("Pending", { status: "ChangesRequested", ownership: "found" }), "changes_requested");
  assert.equal(cp("Accepted", { status: "Submitted" }), "verified");
  assert.equal(cp("Rejected"), "none");
});

test("filters match on applications, a chosen gig, KYC and join date", () => {
  const creator: WorkerActivity = {
    joinedAt: daysAgo(3), kyc: "pending",
    applications: [
      { gigId: "a", status: "Pending", appliedAt: daysAgo(1), setup: "awaiting_review", handle: "creator" },
      { gigId: "b", status: "Rejected", appliedAt: daysAgo(2), setup: "none" },
    ],
  };
  assert.equal(matchesActivity(creator, f({ setup: "awaiting_review" }), now), true);
  assert.equal(matchesActivity(creator, f({ setup: "awaiting_review", gig: "b" }), now), false, "With a gig chosen only that gig counts");
  assert.equal(matchesActivity(creator, f({ application: "rejected", gig: "b" }), now), true);
  assert.equal(matchesActivity(creator, f({ application: "never" }), now), false);
  assert.equal(matchesActivity(creator, f({ application: "never", gig: "c" }), now), true);
  assert.equal(matchesActivity(undefined, f({ application: "never" }), now), true, "No activity means never applied");
  assert.equal(matchesActivity(creator, f({ kyc: "pending", joined: "7d" }), now), true);
  assert.equal(matchesActivity(creator, f({ joined: "established" }), now), false);
  assert.equal(matchesActivity(creator, f({ kyc: "approved" }), now), false);
});

test("presets are one-tap filter sets and count as active filters", () => {
  const awaiting = ACTIVITY_PRESETS.find(preset => preset.id === "awaiting")!;
  const filters = presetFilters(awaiting);
  assert.equal(isPresetActive(awaiting, filters), true);
  assert.equal(isPresetActive(awaiting, { ...filters, kyc: "pending" }), false);
  assert.equal(activeActivityFilterCount(filters), 1);
  assert.equal(activeActivityFilterCount(DEFAULT_ACTIVITY_FILTERS), 0);
});
