import test from "node:test";
import assert from "node:assert/strict";
import { bioCheckWithSignal, bioPreviewNextDelay, bioPreviewRetryAfter, submittedBioNextDelay } from "../../lib/bioPreviewSchedule";

test("bio retries progressively back off failed provider reads", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(count => bioPreviewNextDelay("unreadable", count)), [30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
  assert.equal(bioPreviewNextDelay("error", 2), 60_000);
  assert.equal(bioPreviewNextDelay("found", 0), 15_000);
  assert.equal(bioPreviewNextDelay("not_found", 0), 60_000);
  assert.equal(bioPreviewNextDelay("error", NaN), 30_000);
  assert.equal(bioPreviewNextDelay("error", 2.7), 60_000);
});

test("server retry windows cannot be shortened by the normal polling interval", () => {
  assert.equal(bioPreviewNextDelay("found", 0, 45_000), 45_000);
  assert.equal(bioPreviewNextDelay("unreadable", 1, 180_000), 180_000);
});

test("Retry-After supports seconds, HTTP dates and API body hints", () => {
  const now = Date.parse("2026-10-31T09:00:00Z");
  assert.equal(bioPreviewRetryAfter("45", undefined, now), 45_000);
  assert.equal(bioPreviewRetryAfter("Sat, 31 Oct 2026 09:01:00 GMT", undefined, now), 60_000);
  assert.equal(bioPreviewRetryAfter("30", 90, now), 90_000);
  assert.equal(bioPreviewRetryAfter(null, 30, now), 30_000);
  assert.equal(bioPreviewRetryAfter("Sat, 31 Oct 2026 08:59:00 GMT", undefined, now), 0);
});

test("malformed retry hints cannot break the profile checker", () => {
  const now = Date.parse("2026-10-31T09:00:00Z");
  for (const value of [undefined, null, "60", -1, Infinity, NaN, {}]) assert.equal(bioPreviewRetryAfter("invalid", value, now), 0);
  assert.equal(bioPreviewRetryAfter("", 0, now), 0);
});

test("submitted retries retain their endpoint cooldown and progressively back off", () => {
  assert.deepEqual([1, 2, 3, 4].map(attempt => submittedBioNextDelay("unreadable", attempt, 0, 65_000)), [65_000, 65_000, 120_000, 300_000]);
  assert.equal(submittedBioNextDelay("found", 0, 180_000, 65_000), 180_000);
  assert.equal(submittedBioNextDelay("error", 1, 600_000, 65_000), 600_000);
});

test("cancellation releases a bio check even while authentication is still pending", async () => {
  const controller = new AbortController();
  const pending = bioCheckWithSignal(() => new Promise<never>(() => {}), controller.signal);
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
});

test("cancelled checks never start another operation and successful checks still resolve", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(bioCheckWithSignal(async () => ++calls, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(await bioCheckWithSignal(async () => "checked", new AbortController().signal), "checked");
});
