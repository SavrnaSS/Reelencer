import test from "node:test";
import assert from "node:assert/strict";
import { applicationQuota, formatWait, quotaBlocksGig, quotaCoversGig, strictestQuota } from "../../lib/applicationQuota";

const now = Date.parse("2026-10-30T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

test("counts gigs applied to in the last seven days, once per gig", () => {
  const quota = applicationQuota([
    { gigId: "a", appliedAt: daysAgo(1) },
    { gigId: "a", appliedAt: daysAgo(3) },
    { gigId: "old", appliedAt: daysAgo(7.1) },
    { gigId: "", appliedAt: daysAgo(1) },
    { gigId: "b", appliedAt: "not a date" },
  ], now);
  assert.equal(quota.used, 1);
  assert.equal(quota.remaining, 1);
  assert.equal(quota.nextSlotAt, null);
});

test("when full, the next slot opens seven days after the oldest counted application", () => {
  const quota = applicationQuota([{ gigId: "a", appliedAt: daysAgo(2) }, { gigId: "b", appliedAt: daysAgo(5) }, { gigId: "c", appliedAt: daysAgo(1) }], now);
  assert.equal(quota.used, 3);
  assert.equal(quota.remaining, 0);
  // Three counted (one added by the team): two must age out, so the slot opens when "a" does.
  assert.equal(quota.nextSlotAt, new Date(now + 5 * 86_400_000).toISOString());
  assert.deepEqual(quota.gigs.map((gig) => gig.gigId), ["b", "a", "c"]);
  assert.equal(quotaBlocksGig(quota, "d"), true);
  assert.equal(quotaBlocksGig(quota, "a"), false);
  assert.equal(quotaCoversGig(quota, "a"), true);
});

test("the server's stricter answer holds until its slot opens", () => {
  const local = applicationQuota([], now);
  const server = { ...local, used: 2, remaining: 0, nextSlotAt: new Date(now + 3_600_000).toISOString() };
  assert.equal(strictestQuota(local, server, now), server);
  assert.equal(strictestQuota(local, server, now + 3_600_001), local);
  assert.equal(strictestQuota(local, null, now), local);
});

test("formats the wait until a slot opens", () => {
  const at = (ms: number) => new Date(now + ms).toISOString();
  assert.equal(formatWait(at(2 * 86_400_000 + 4 * 3_600_000), now), "2d 4h");
  assert.equal(formatWait(at(3 * 3_600_000 + 20 * 60_000), now), "3h 20m");
  assert.equal(formatWait(at(30_000), now), "1m");
  assert.equal(formatWait(at(-1), now), "now");
});
