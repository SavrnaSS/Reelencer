import test from "node:test";
import assert from "node:assert/strict";
import { creatorViewMilestone, FIRST_VIEW_MILESTONE, nextViewMilestone } from "../../lib/creatorViewMilestones";
import type { SocialPost } from "../../lib/socialAnalytics";

const linkedAt = "2026-10-31T08:00:00Z";
const reel = (id: string, values: Partial<SocialPost> = {}): SocialPost => ({
  id, url: `https://www.instagram.com/reel/${id}/`, postedAt: "2026-10-31T09:00:00Z",
  updatedAt: "2026-10-31T10:00:00Z", createdAt: "2026-10-31T09:00:00Z",
  status: "approved", submittedByWorker: false, source: "profile", ...values,
});

test("view goals start at 1000 and immediately advance at each exact boundary", () => {
  assert.equal(FIRST_VIEW_MILESTONE, 1000);
  const almost = nextViewMilestone(999)!;
  assert.equal(almost.target, 1000);
  assert.equal(almost.remaining, 1);
  assert.equal(almost.progress, 999 / 1000);
  assert.equal(almost.percent, 99);
  assert.equal(almost.previousTarget, undefined);
  assert.equal(almost.nextTarget, 2500);
  for (const [views, target, previousTarget, nextTarget] of [
    [1000, 2500, 1000, 5000], [2500, 5000, 2500, 10000], [5000, 10000, 5000, 25000],
    [10000, 25000, 10000, 50000], [500000, 1000000, 500000, 2500000],
  ]) {
    const goal = nextViewMilestone(views)!;
    assert.equal(goal.target, target);
    assert.equal(goal.previousTarget, previousTarget);
    assert.equal(goal.nextTarget, nextTarget);
    assert.equal(goal.remaining, target - views);
    assert.ok(goal.percent < 100);
  }
});

test("a large views update skips completed goals and the ladder continues beyond a million", () => {
  for (const [views, target] of [[1000001, 2500000], [2700000, 5000000], [5000000, 10000000], [2500000000000, 5000000000000]]) {
    const goal = nextViewMilestone(views)!;
    assert.equal(goal.target, target);
    assert.ok(goal.target > views);
    assert.equal(goal.progress, views / target);
  }
  assert.equal(nextViewMilestone(5000000000000000), undefined, "never fabricate an unsafe target beyond the supported integer range");
});

test("invalid or unsafe view counts cannot create a goal", () => {
  for (const count of [undefined, NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(nextViewMilestone(count), undefined);
  }
});

test("each account advances from its own current measured reels without shared goal state", () => {
  const first = { linkedAt, posts: [reel("first", { views: 999 })] };
  const second = { linkedAt, posts: [reel("second", { views: 49000 })] };
  assert.equal(creatorViewMilestone(first).milestone?.target, 1000);
  assert.equal(creatorViewMilestone(second).milestone?.target, 50000);
  const updated = creatorViewMilestone({ ...first, posts: [reel("first", { views: 6000 })] });
  assert.equal(updated.milestone?.target, 10000);
  assert.equal(updated.milestone?.previousTarget, 5000);
  assert.equal(creatorViewMilestone(second).milestone?.target, 50000);
  assert.equal(first.posts[0].views, 999, "calculation never mutates account data");
});

test("goals exclude rejected, removed and pre-link reels while including the account's linking day", () => {
  const summary = creatorViewMilestone({ linkedAt, posts: [
    reel("approved", { views: 500 }),
    reel("submitted", { views: 250, status: "submitted" }),
    reel("linking-day", { views: 100, postedAt: "2026-10-30T18:30:00Z" }),
    reel("before-link", { views: 100000, postedAt: "2026-10-30T18:29:59Z" }),
    reel("rejected", { views: 100000, status: "rejected" }),
    reel("removed", { views: 100000, removedAt: "2026-10-31T10:00:00Z" }),
  ] });
  assert.equal(summary.total, 850);
  assert.equal(summary.totalReels, 3);
  assert.equal(summary.measured, 3);
  assert.equal(summary.milestone?.target, 1000);
  assert.equal(summary.milestone?.remaining, 150);
});

test("missing counts remain distinct from measured zero and partial coverage stays visible", () => {
  const missing = creatorViewMilestone({ linkedAt, posts: [reel("missing")] });
  assert.equal(missing.total, undefined);
  assert.equal(missing.milestone, undefined);
  assert.equal(missing.missing, 1);
  assert.equal(creatorViewMilestone({ linkedAt, posts: [] }).milestone, undefined);
  const zero = creatorViewMilestone({ linkedAt, posts: [reel("zero", { views: 0 })] });
  assert.equal(zero.total, 0);
  assert.equal(zero.milestone?.target, 1000);
  assert.equal(zero.milestone?.progress, 0);
  const partial = creatorViewMilestone({ linkedAt, posts: [reel("measured", { views: 1250 }), reel("missing")] });
  assert.equal(partial.total, 1250);
  assert.equal(partial.measured, 1);
  assert.equal(partial.missing, 1);
  assert.equal(partial.milestone?.target, 2500);
});

test("measurement freshness comes from every measured reel's view timestamp", () => {
  const summary = creatorViewMilestone({ linkedAt, posts: [
    reel("newer", { views: 1000, viewsCapturedAt: "2026-10-31T10:00:00Z" }),
    reel("older", { views: 500, viewsCapturedAt: "2026-10-31T09:00:00Z" }),
  ] });
  assert.equal(summary.oldestCapturedAt, "2026-10-31T09:00:00Z");
  const undated = creatorViewMilestone({ linkedAt, posts: [reel("dated", { views: 500, viewsCapturedAt: "2026-10-31T10:00:00Z" }), reel("undated", { views: 0 })] });
  assert.equal(undated.oldestCapturedAt, undefined, "profile checks or updatedAt cannot masquerade as view measurements");
});

test("pinned readings drive goals and an unsafe aggregate cannot create a milestone", () => {
  const pinned = creatorViewMilestone({ linkedAt, posts: [reel("pinned", { views: 913, syncedViews: 2003, viewsPinned: true })] });
  assert.equal(pinned.total, 913);
  assert.equal(pinned.milestone?.target, 1000);
  const overflow = creatorViewMilestone({ linkedAt, posts: [reel("large-a", { views: Number.MAX_SAFE_INTEGER }), reel("large-b", { views: Number.MAX_SAFE_INTEGER })] });
  assert.equal(overflow.milestone, undefined);
});
