import test from "node:test";
import assert from "node:assert/strict";
import { postingProgress } from "../../lib/creatorEarnings";
import { formatMoney } from "../../lib/money";
import type { SocialPost } from "../../lib/socialAnalytics";

const post = (id: string, status: SocialPost["status"], views?: number): SocialPost => ({ id, url: `https://www.instagram.com/reel/${id}/`, status, views, updatedAt: "2026-10-20T00:00:00Z", createdAt: "2026-10-19T00:00:00Z", submittedByWorker: true, source: "manual" });

test("posting progress is empty before an account or reels exist", () => {
  assert.deepEqual(postingProgress(null, []), { submitted: 0, approved: 0, inReview: 0, rejected: 0, paid: 0, inPayout: 0, earned: 0, symbol: "₹" });
});

test("posting progress counts live reels, ignores rejected ones and matches payouts by handle", () => {
  const account = { handle: "AiMoneyGina", payout: "₹49", payoutType: "Per 1K views", posts: [post("a", "approved", 20_000), post("b", "submitted", 500), post("c", "rejected")] };
  const progress = postingProgress(account, [
    { status: "Paid", items: [{ amountINR: 300, handle: "@aimoneygina" }, { amountINR: 999, handle: "someone_else" }] },
    { status: "processing", items: [{ amountINR: 680, handle: "aimoneygina" }] },
    { status: "failed", items: [{ amountINR: 50, handle: "aimoneygina" }] },
  ]);
  assert.equal(progress.submitted, 2);
  assert.equal(progress.approved, 1);
  assert.equal(progress.inReview, 1);
  assert.equal(progress.rejected, 1);
  assert.equal(progress.paid, 300);
  assert.equal(progress.inPayout, 680);
  assert.equal(progress.earned, 980);
  assert.equal(progress.symbol, "₹");
});

test("money shows paise with both digits and keeps whole amounts whole", () => {
  assert.equal(formatMoney(7073.1), "₹7,073.10");
  assert.equal(formatMoney(49), "₹49");
  assert.equal(formatMoney(120000.5), "₹1,20,000.50");
});
