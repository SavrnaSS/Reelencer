import test from "node:test";
import assert from "node:assert/strict";
import { NEW_CREATOR_HOLD_DAYS, newCreatorHoldMessage, newCreatorHoldUntil } from "@/lib/newCreatorHold";

const now = Date.parse("2026-10-31T10:00:00Z");
const joined = (days: number) => new Date(now - days * 86_400_000).toISOString();
const base = { gigId: "held", held: true, applications: [], assignments: [], now };

test("held gigs wait until 20 days after joining", () => {
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt: joined(5) }), new Date(now + 15 * 86_400_000).toISOString());
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt: joined(NEW_CREATOR_HOLD_DAYS) }), null);
  assert.equal(newCreatorHoldUntil({ ...base, held: false, accountCreatedAt: joined(1) }), null);
  // An unknown account age leaves the decision to the server.
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt: null }), null);
});

test("being assigned another project lifts the hold; applying elsewhere does not", () => {
  const accountCreatedAt = joined(2);
  assert.ok(newCreatorHoldUntil({ ...base, accountCreatedAt, applications: [{ gigId: "other", status: "Pending" }] }));
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt, applications: [{ gigId: "other", status: "Accepted" }] }), null);
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt, assignments: [{ gig_id: "other" }] }), null);
  // Work on the held gig itself doesn't count as "another project", but an approval there was already let in.
  assert.ok(newCreatorHoldUntil({ ...base, accountCreatedAt, assignments: [{ gigId: "held" }] }));
  assert.equal(newCreatorHoldUntil({ ...base, accountCreatedAt, applications: [{ gigId: "held", status: "Accepted" }] }), null);
});

test("the message explains the rule and when the gig opens", () => {
  const opensAt = new Date(now + (3 * 24 + 4) * 3_600_000).toISOString();
  assert.match(newCreatorHoldMessage(opensAt, { now, withTime: false }), /assigned another project, or 20 days after you joined\. Yours opens in 3d 4h at the latest\.$/);
  assert.doesNotMatch(newCreatorHoldMessage(null, { now }), /Yours opens/);
});
