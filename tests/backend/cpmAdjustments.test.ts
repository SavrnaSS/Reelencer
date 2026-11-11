import test from "node:test";
import assert from "node:assert/strict";
import { cpmPresets, cpmSummary, readCpmAdjustment } from "../../lib/cpmAdjustments";
import { postPayoutTerms, readPayoutTerms } from "../../lib/payoutPlans";
import { summarizeAccountEarnings } from "../../lib/creatorEarnings";
import { reelEarnings, type LinkedSocialAccount, type SocialPost } from "../../lib/socialAnalytics";
import { adjustedViewAmount, claimItemPlanLabel } from "../../lib/viewPayoutReview";

const post = (id: string, status: SocialPost["status"], views?: number, extra: Partial<SocialPost> = {}): SocialPost => ({
  id, status, views, postedAt: "2026-10-30T04:00:00Z", url: `https://instagram.com/reel/${id}/`, createdAt: "", updatedAt: "", source: "manual", submittedByWorker: false, ...extra,
});
const account = (posts: SocialPost[], overrides: Partial<LinkedSocialAccount> = {}): LinkedSocialAccount => ({
  id: "acc", posts, applicationId: "app", gigId: "gig", workerCode: "WKR-1", platform: "Instagram", handle: "creator", profileUrl: "",
  status: "active", linkedAt: "", snapshots: [], payout: "₹49", payoutType: "Per 1k Views", sync: { available: false, status: "pending" }, ...overrides,
});
const plan = { mode: "beyond" as const, rateINR: 49, baseINR: 200, thresholdViews: 10_000, planId: "p", planName: "Premium", appliesFrom: "2026-10-01T00:00:00Z" };
const low = (rateINR: number, reasons = ["low_reel_engagement"], afterViews = 0) => ({ cpmAdjustment: { rateINR, reasons, afterViews } });

test("database rows and API objects are read strictly", () => {
  assert.deepEqual(readCpmAdjustment({ cpm_override_inr: "20.50", cpm_override_reasons: ["no_bio_link", "nonsense"], cpm_override_note: " Add the link ", cpm_override_at: "2026-11-11T00:00:00Z" }),
    { rateINR: 20.5, reasons: ["no_bio_link"], afterViews: 0, note: "Add the link", at: "2026-11-11T00:00:00Z" });
  assert.deepEqual(readCpmAdjustment({ rateINR: 35, reasons: ["low_signups"], afterViews: 5_000, walletChangeINR: -28 }), { rateINR: 35, reasons: ["low_signups"], afterViews: 5_000, walletChangeINR: -28 });
  assert.equal(readCpmAdjustment({ cpm_override_inr: null }), undefined);
  assert.equal(readCpmAdjustment({ rateINR: -1, reasons: [] }), undefined);
  assert.deepEqual(readPayoutTerms({ mode: "cpm", rateINR: 20, baseINR: 0, thresholdViews: 0, cpmAdjusted: true, standardRateINR: 49 }),
    { mode: "cpm", rateINR: 20, baseINR: 0, thresholdViews: 0, cpmAdjusted: true, standardRateINR: 49, cpmAfterViews: 0 });
});

test("a reel's terms carry the adjusted rate and the rate it replaced, once", () => {
  const terms = postPayoutTerms(post("a", "approved", 1_000, low(20)), undefined, 49);
  assert.deepEqual([terms.mode, terms.rateINR, terms.standardRateINR, terms.cpmAdjusted], ["cpm", 20, 49, true]);
  // Wallet terms already adjusted by the database stay as they are.
  const frozen = postPayoutTerms(post("b", "approved", 1_000, { ...low(20), walletCredit: { creditedINR: 0, consumedViews: 0, pendingClaimINR: 0, fixedCredit: false, payoutTerms: { mode: "beyond", rateINR: 20, baseINR: 200, thresholdViews: 10_000, cpmAdjusted: true, standardRateINR: 49 } } }), plan, 49);
  assert.deepEqual([frozen.rateINR, frozen.standardRateINR, frozen.baseINR], [20, 49, 200]);
});

test("estimates price adjusted reels at their own CPM", () => {
  const earnings = reelEarnings(account([post("full", "approved", 2_000), post("low", "approved", 10_000, low(20)), post("review", "submitted", 1_000, low(35)), post("nocount", "approved", undefined, low(20))]))!;
  assert.equal(earnings.approvedAmount, 98 + 200, "2K × ₹49 plus 10K × ₹20");
  assert.equal(earnings.pendingAmount, 35);
  assert.equal(earnings.approvedViews, 12_000);
  assert.equal("unmeasuredApproved" in earnings ? earnings.unmeasuredApproved : -1, 1, "an adjusted reel without a count still waits for one");
  const planned = reelEarnings(account([post("plan", "approved", 15_000, low(20))], { payoutPlan: plan }))!;
  assert.equal(planned.approvedAmount, 300, "₹200 base + 5K × ₹20");
});

test("verified wallet estimates owe adjusted growth at the adjusted rate", () => {
  const linked = account([post("a", "approved", 3_000, { ...low(20), walletCredit: { creditedINR: 49, consumedViews: 1_000, pendingClaimINR: 0, fixedCredit: false } })], { walletCredits: { amountINR: 49, reels: 1 } });
  const summary = summarizeAccountEarnings([linked]);
  assert.equal(summary.pending, 40, "2K new views × ₹20");
});

test("the creator summary weights CPM by views and totals what the gap costs", () => {
  const summary = cpmSummary([
    post("a", "approved", 10_000, low(20, ["low_reel_engagement", "no_bio_link"])),
    post("b", "submitted", 30_000, low(35, ["low_reel_engagement"])),
    post("c", "approved", 5_000),
    post("d", "rejected", 90_000, low(10)),
  ], undefined, 49)!;
  assert.deepEqual(summary.reels.map(reel => reel.post.id), ["a", "b"], "lowest share first; plain and rejected reels left out");
  assert.equal(summary.rateINR, 31.25, "(10K × ₹20 + 30K × ₹35) / 40K");
  assert.equal(summary.standardRateINR, 49);
  assert.equal(summary.lostINR, 290 + 420);
  assert.equal(Math.round(summary.dropPct), 36);
  assert.deepEqual(summary.reasons, [{ reason: "low_reel_engagement", count: 2 }, { reason: "no_bio_link", count: 1 }]);
  assert.equal(cpmSummary([post("c", "approved", 5_000)], undefined, 49), undefined);
});

test("admin presets are round, lower rates", () => {
  assert.deepEqual(cpmPresets(49), [39, 34, 29, 25, 20]);
  assert.deepEqual(cpmPresets(1), []);
});

test("claim review previews and labels adjusted plain intervals at their frozen rate", () => {
  const item = { from_views: 1_000, to_views: 3_000, payout_mode: "cpm" as const, item_rate_inr: 19, standard_rate_inr: 49 };
  assert.equal(adjustedViewAmount(item, 49, 0), 38);
  assert.equal(adjustedViewAmount(item, 49, 1_000), 19);
  assert.equal(claimItemPlanLabel(item), "CPM adjusted ₹19/1K (standard ₹49)");
  assert.equal(claimItemPlanLabel({ payout_mode: "cpm" }), undefined);
});

test("a lower CPM that starts after N views keeps the standard rate for the first N", async () => {
  const { reelPayoutINR } = await import("../../lib/payoutPlans");
  const terms = postPayoutTerms(post("a", "approved", 10_000, low(20, ["low_signups"], 5_000)), undefined, 49);
  assert.equal(terms.cpmAfterViews, 5_000);
  assert.equal(reelPayoutINR(10_000, terms), 345, "5K × ₹49 + 5K × ₹20, same as the database");
  assert.equal(reelPayoutINR(4_000, terms), 196, "under the start, the full rate");
  const plan = { mode: "beyond" as const, rateINR: 20, baseINR: 200, thresholdViews: 10_000, cpmAdjusted: true, standardRateINR: 49, cpmAfterViews: 12_000 };
  assert.equal(reelPayoutINR(15_000, plan), 200 + 98 + 60, "base, 2K × ₹49 to 12K, then 3K × ₹20");
  const summary = cpmSummary([post("a", "approved", 10_000, low(20, ["low_signups"], 5_000))], undefined, 49)!;
  assert.equal(summary.lostINR, 145, "only the 5K views past the start cost anything");
  assert.equal(adjustedViewAmount({ from_views: 0, to_views: 10_000, payout_mode: "cpm", item_rate_inr: 20, standard_rate_inr: 49, cpm_after_views: 5_000 }, 49, 0), 345);
});

test("a from-now adjustment keeps its flag through the API and cache", () => {
  assert.equal(readCpmAdjustment({ cpm_override_inr: 20, cpm_override_reasons: ["low_signups"], cpm_after_views: 2_970, cpm_from_now: true })?.fromNow, true);
  assert.equal(readCpmAdjustment({ rateINR: 20, reasons: ["low_signups"], afterViews: 2_970, fromNow: true })?.fromNow, true);
  assert.equal(readCpmAdjustment({ rateINR: 20, reasons: ["low_signups"], afterViews: 0 })?.fromNow, undefined);
});
