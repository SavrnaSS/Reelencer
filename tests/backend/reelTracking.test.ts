import test from "node:test";
import assert from "node:assert/strict";
import { countedReels, reelTracking, trackingStart, trackingStartLabel } from "../../lib/reelTracking";

test("the tracking window opens at midnight India time on the linking day", () => {
  // Linked 29 Oct 2026, 13:22 IST.
  const linkedAt = "2026-10-29T07:52:00Z";
  assert.equal(new Date(trackingStart(linkedAt)!).toISOString(), "2026-10-28T18:30:00.000Z");
  assert.equal(trackingStartLabel(linkedAt), "29 Oct 2026");
  // Linked 00:10 IST still counts the whole of that day, not the previous one.
  assert.equal(new Date(trackingStart("2026-10-28T18:40:00Z")!).toISOString(), "2026-10-28T18:30:00.000Z");
  assert.equal(trackingStart("not a date"), undefined);
});

test("reels from before the linking day are excluded, same-day and undated reels are kept", () => {
  const linkedAt = "2026-10-29T07:52:00Z";
  assert.equal(reelTracking("2026-10-28T18:29:59Z", linkedAt), "before_link");
  assert.equal(reelTracking("2026-10-28T18:30:00Z", linkedAt), "tracked");
  assert.equal(reelTracking("2026-10-29T06:00:00Z", linkedAt), "tracked", "posted earlier on the linking day");
  assert.equal(reelTracking(undefined, linkedAt), "undated");
  const posts = [{ id: "old", postedAt: "2026-10-01T00:00:00Z" }, { id: "new", postedAt: "2026-10-30T00:00:00Z" }, { id: "undated" }];
  assert.deepEqual(countedReels(posts, linkedAt).map((post) => post.id), ["new", "undated"]);
});

test("earnings and posting progress ignore reels from before linking", async () => {
  const { reelEarnings } = await import("../../lib/socialAnalytics");
  const { postingProgress } = await import("../../lib/creatorEarnings");
  const base = { url: "https://www.instagram.com/reel/a/", createdAt: "", updatedAt: "", submittedByWorker: false, source: "profile" as const };
  const posts = [
    { ...base, id: "old", status: "approved" as const, views: 50_000, postedAt: "2026-10-01T00:00:00Z" },
    { ...base, id: "new", status: "approved" as const, views: 2_000, postedAt: "2026-10-30T00:00:00Z" },
    { ...base, id: "wait", status: "submitted" as const, views: 1_000, postedAt: "2026-10-30T00:00:00Z" },
  ];
  const account = { handle: "creator", posts, payout: "₹50", payoutType: "Per 1K views", linkedAt: "2026-10-29T07:52:00Z" };
  const earnings = reelEarnings(account)!;
  assert.equal(earnings.approvedAmount, 100);
  assert.equal(earnings.approved, 1);
  const progress = postingProgress(account, []);
  assert.equal(progress.submitted, 2);
  assert.equal(progress.earned, 100);
});

test("date inputs start at the linking day in India time", async () => {
  const { trackingStartInput } = await import("../../lib/reelTracking");
  assert.equal(trackingStartInput("2026-10-29T07:52:00Z"), "2026-10-29");
  assert.equal(trackingStartInput("2026-10-28T19:00:00Z"), "2026-10-29", "00:30 IST on the 29th");
  assert.equal(trackingStartInput(undefined), undefined);
});

test("creator account data drops reels from before linking, including data cached on the device", async () => {
  const { creatorAccountData } = await import("../../lib/creatorDeviceCache");
  const post = (id: string, postedAt: string) => ({ id, url: `https://www.instagram.com/reel/${id}/`, postedAt, status: "approved", createdAt: postedAt, updatedAt: postedAt, submittedByWorker: false, source: "profile" });
  const account = (posts: unknown[]) => ({ id: "a", applicationId: "app", gigId: "gig", workerCode: "WKR-1", profileUrl: "https://www.instagram.com/creator/", handle: "creator", platform: "Instagram", status: "active", linkedAt: "2026-10-29T07:52:00Z", sync: { available: true, status: "ok" }, snapshots: [], posts });
  const data = creatorAccountData({ accounts: [account([post("old", "2026-10-01T00:00:00Z"), post("new", "2026-10-30T00:00:00Z")])], accountIssues: [account([post("old", "2026-10-01T00:00:00Z")])], screenshotReader: false });
  assert.deepEqual(data.accounts[0].posts.map((p) => p.id), ["new"]);
  assert.deepEqual(data.accountIssues?.[0].posts, []);
});

test("removed reels never count and never reach the creator", async () => {
  const { creatorAccountData } = await import("../../lib/creatorDeviceCache");
  const { reelEarnings } = await import("../../lib/socialAnalytics");
  const posts = [
    { id: "kept", url: "https://www.instagram.com/reel/kept/", postedAt: "2026-10-30T00:00:00Z", status: "approved", views: 2000, createdAt: "2026-10-30", updatedAt: "2026-10-30", submittedByWorker: false, source: "profile" },
    { id: "gone", url: "https://www.instagram.com/reel/gone/", postedAt: "2026-10-30T00:00:00Z", status: "rejected", views: 90000, removedAt: "2026-10-31T00:00:00Z", removalReason: "Duplicate", createdAt: "2026-10-30", updatedAt: "2026-10-31", submittedByWorker: false, source: "profile" },
  ];
  assert.deepEqual(countedReels(posts, "2026-10-29T07:52:00Z").map((p) => p.id), ["kept"]);
  const account = { id: "a", applicationId: "app", gigId: "gig", workerCode: "WKR-1", profileUrl: "https://www.instagram.com/creator/", handle: "creator", platform: "Instagram", status: "active", linkedAt: "2026-10-29T07:52:00Z", sync: { available: true, status: "ok" }, snapshots: [], posts };
  assert.deepEqual(creatorAccountData({ accounts: [account], screenshotReader: false }).accounts[0].posts.map((p) => p.id), ["kept"]);
  assert.equal(reelEarnings({ ...account, posts: posts as never, payout: "₹50", payoutType: "Per 1K views" })!.approvedViews, 2000);
});
