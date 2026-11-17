import test from "node:test";
import assert from "node:assert/strict";
import { breakEvenViews, cumulativePaise, describePlan, outstandingPaise, readAccountPayoutPlan, readPayoutTerms, reelPayoutINR, shortPlan, termsForReel, validatePlanDraft, planDraftFrom } from "../../lib/payoutPlans";
import { summarizeAccountEarnings } from "../../lib/creatorEarnings";
import { reelEarnings, type LinkedSocialAccount, type SocialPost } from "../../lib/socialAnalytics";
import { adjustedViewAmount } from "../../lib/viewPayoutReview";
import { readSocialPostWalletCredit } from "../../lib/socialWallet";

const switchPlan = { mode: "all" as const, rateINR: 49, baseINR: 200, thresholdViews: 10_000 };
const beyondPlan = { ...switchPlan, mode: "beyond" as const };
const plan = { ...switchPlan, planId: "plan-1", planName: "Premium", appliesFrom: "2026-10-01T00:00:00+05:30" };

test("plan formulas match the database, including paise rounding", () => {
  assert.equal(reelPayoutINR(0, switchPlan), 200);
  assert.equal(reelPayoutINR(10_000, switchPlan), 200);
  assert.equal(reelPayoutINR(10_001, switchPlan), 490.05);
  assert.equal(reelPayoutINR(12_500, switchPlan), 612.5);
  assert.equal(reelPayoutINR(12_500, beyondPlan), 322.5);
  assert.equal(reelPayoutINR(10_011, beyondPlan), 200.54, "11 × ₹0.049 = ₹0.539 rounds half-up like SQL");
  assert.equal(reelPayoutINR(1_308, { mode: "cpm", rateINR: 49, baseINR: 0, thresholdViews: 0 }), 64.09);
});

test("outstanding amounts: base before measurement, then only growth", () => {
  assert.equal(outstandingPaise(undefined, 0, { ...beyondPlan, started: false }), 20_000);
  assert.equal(outstandingPaise(15_000, 0, { ...beyondPlan, started: false }), 44_500);
  assert.equal(outstandingPaise(15_000, 4_000, { ...beyondPlan, started: true }), 24_500);
  assert.equal(outstandingPaise(9_000, 4_000, { ...beyondPlan, started: true }), 0);
  assert.equal(outstandingPaise(undefined, 0, { mode: "cpm", rateINR: 49, baseINR: 0, thresholdViews: 0 }), 0);
});

test("reels posted before the plan's start date keep the plain rate", () => {
  assert.equal(termsForReel(plan, 49, "2026-09-30T10:00:00Z").mode, "cpm");
  assert.equal(termsForReel(plan, 49, "2026-10-02T10:00:00Z").mode, "all");
  assert.equal(termsForReel(undefined, 49).mode, "cpm");
});

test("copy and comparisons", () => {
  assert.equal(shortPlan(switchPlan), "₹200 + ₹49/1K past 10K");
  assert.match(describePlan(beyondPlan), /₹200 per approved reel up to 10K views, then ₹49 per 1K views beyond 10K/);
  assert.equal(breakEvenViews(switchPlan, 49), 4082, "standard pay first reaches ₹200 at 4,082 views");
  assert.equal(Number(cumulativePaise(20_000, beyondPlan)), 69_000);
});

test("plan drafts are validated like the database", () => {
  assert.deepEqual(validatePlanDraft(planDraftFrom()), { name: "Give the plan a name." });
  const errors = validatePlanDraft({ ...planDraftFrom(), name: "x", baseINR: "0", thresholdViews: "1.5", rateINR: "abc" });
  assert.deepEqual(Object.keys(errors).sort(), ["baseINR", "rateINR", "thresholdViews"]);
});

test("read-model terms are parsed strictly", () => {
  assert.equal(readPayoutTerms({ mode: "beyond", rateINR: 49, baseINR: 0, thresholdViews: 10 }), undefined);
  assert.equal(readPayoutTerms({ mode: "bonus", rateINR: 49, baseINR: 200, thresholdViews: 10 }), undefined);
  assert.deepEqual(readAccountPayoutPlan(plan), { ...switchPlan, planId: "plan-1", planName: "Premium", appliesFrom: plan.appliesFrom });
  const credit = readSocialPostWalletCredit({ creditedINR: 0, consumedViews: 0, pendingClaimINR: 0, fixedCredit: false, payoutTerms: { ...beyondPlan, started: false } });
  assert.equal(credit?.payoutTerms?.mode, "beyond");
});

const post = (id: string, status: SocialPost["status"], views?: number, extra: Partial<SocialPost> = {}): SocialPost => ({
  id, status, views, postedAt: "2026-10-30T04:00:00Z", url: `https://instagram.com/reel/${id}/`, createdAt: "", updatedAt: "", source: "manual", submittedByWorker: false, ...extra,
});
const account = (posts: SocialPost[], overrides: Partial<LinkedSocialAccount> = {}): LinkedSocialAccount => ({
  id: "acc", posts, applicationId: "app", gigId: "gig", workerCode: "WKR-1", platform: "Instagram", handle: "creator", profileUrl: "",
  status: "active", linkedAt: "", snapshots: [], payout: "₹49", payoutType: "Per 1k Views", sync: { available: false, status: "pending" }, ...overrides,
});

test("estimates use the creator's plan, including unmeasured reels", () => {
  const linked = account([post("a", "approved", 4_000), post("b", "approved", 12_000), post("c", "submitted"), post("d", "approved", 2_000, { postedAt: "2026-09-01T00:00:00Z" })], { payoutPlan: plan });
  const earnings = reelEarnings(linked)!;
  assert.equal(earnings.approvedAmount, 200 + 588 + 98, "base, full rate past 10K, and a pre-plan reel at ₹49/1K");
  assert.equal(earnings.pendingAmount, 200);
  assert.equal("unmeasuredPending" in earnings ? earnings.unmeasuredPending : -1, 0);
});

test("verified wallet estimates add the plan's outstanding amount per reel", () => {
  const wallet = (consumedViews: number, creditedINR: number, started: boolean) => ({ creditedINR, consumedViews, pendingClaimINR: 0, fixedCredit: false, payoutTerms: { ...beyondPlan, started } });
  const linked = account([
    post("fresh", "approved", undefined, { walletCredit: wallet(0, 0, false) }),
    post("growing", "approved", 15_000, { walletCredit: wallet(4_000, 200, true) }),
    post("plain", "approved", 2_000, { walletCredit: { creditedINR: 49, consumedViews: 1_000, pendingClaimINR: 0, fixedCredit: false } }),
  ], { payoutPlan: { ...plan, mode: "beyond" }, walletCredits: { amountINR: 249, reels: 2 } });
  const summary = summarizeAccountEarnings([linked]);
  assert.equal(summary.walletVerified, true);
  assert.equal(summary.approved, 249);
  assert.equal(summary.pending, 200 + 245 + 49);
});

test("claim review previews plan intervals at their frozen terms", () => {
  const opening = { from_views: 0, to_views: 12_000, payout_mode: "beyond" as const, item_rate_inr: 60, base_inr: 200, threshold_views: 10_000, opens_plan: true };
  assert.equal(adjustedViewAmount(opening, 49, 0), 320);
  assert.equal(adjustedViewAmount(opening, 49, 1_000), 260);
  assert.equal(adjustedViewAmount({ ...opening, to_views: 0 }, 49, 0), 200, "base-only interval");
  assert.equal(adjustedViewAmount({ from_views: 1_000, to_views: 1_500 }, 49, 0), 24.5);
});

test("creator plan card: earlier reels stay standard and plan reels show progress", async () => {
  const { planReelSummary, planCopy } = await import("../../lib/payoutPlans");
  const nov = { ...plan, mode: "beyond" as const, appliesFrom: "2026-11-03T00:00:00+05:30" };
  const summary = planReelSummary([
    post("old", "approved", 335, { postedAt: "2026-11-01T10:00:00Z" }),
    post("new", "approved", 4_000, { postedAt: "2026-11-03T10:00:00Z" }),
    post("viral", "approved", 15_000, { postedAt: "2026-11-03T12:00:00Z" }),
    post("waiting", "submitted", undefined, { postedAt: "2026-11-03T13:00:00Z" }),
    post("rejected", "rejected", 50_000, { postedAt: "2026-11-03T14:00:00Z" }),
  ], nov, 49);
  assert.deepEqual(summary.standard, { reels: 1, views: 335, amountINR: 16.42 }, "the screenshot's ₹16.42 is an earlier, standard-rate reel");
  assert.equal(summary.approvedINR, 200 + 445);
  assert.equal(summary.inReviewINR, 200);
  assert.equal(summary.boostedCount, 1);
  assert.equal(summary.reels.find(reel => reel.post.id === "new")?.remainingToBoost, 6_001);
  const copy = planCopy(nov);
  assert.equal(copy.headline, "₹200 for every approved reel");
  assert.deepEqual(copy.examples.map(example => example.amountINR), [200, 200, 690]);
  assert.match(copy.boostText, /Every 1,000 views a reel gets after 10,000 adds ₹49 on top of its ₹200/);
});

test("payoutBasisPreview estimates switching a plan reel to plain CPM and back", async () => {
  const { payoutBasisPreview, postPayoutTerms, readPayoutBasis } = await import("../../lib/payoutPlans");
  const planTerms = { ...switchPlan, planName: "Premium", started: true };
  // 338 views, ₹200 base credited for its first 12 views.
  const reel = { views: 338, walletCredit: { creditedINR: 200, consumedViews: 12 } };
  const toCpm = payoutBasisPreview(reel, planTerms, 49)!;
  assert.equal(toCpm.to, "cpm");
  assert.equal(toCpm.nowINR, 200);
  assert.equal(toCpm.afterINR, 16.56);
  assert.equal(toCpm.walletChangeINR, -199.41);
  assert.equal(toCpm.plan.baseINR, 200);

  // A lowered CPM below the gig rate stays; one at or above it is cleared.
  const kept = payoutBasisPreview({ ...reel, cpmAdjustment: { rateINR: 20, reasons: [], afterViews: 0 } }, { ...planTerms, rateINR: 20, standardRateINR: 49, cpmAdjusted: true, cpmAfterViews: 0 }, 49)!;
  assert.equal(kept.target.rateINR, 20);
  assert.equal(kept.clearsCpmINR, undefined);
  const cleared = payoutBasisPreview({ ...reel, cpmAdjustment: { rateINR: 45, reasons: [], afterViews: 0 } }, { ...planTerms, rateINR: 45, standardRateINR: 60, cpmAdjusted: true, cpmAfterViews: 0 }, 40)!;
  assert.equal(cleared.clearsCpmINR, 45);
  assert.equal(cleared.target.rateINR, 40);

  // A switched reel previews going back to the plan it had, base included.
  const payoutBasis = readPayoutBasis({ payout_basis: "cpm", payout_basis_plan: switchPlan, payout_basis_at: "2026-11-17T09:00:00Z" })!;
  const switched = { ...reel, walletCredit: { creditedINR: 0.59, consumedViews: 12 }, payoutBasis };
  const back = payoutBasisPreview(switched, { mode: "cpm", rateINR: 49, baseINR: 0, thresholdViews: 0, started: true }, 49)!;
  assert.equal(back.to, "plan");
  assert.equal(back.afterINR, 200);
  assert.equal(back.walletChangeINR, 199.41);

  // An unstarted switched reel never takes the account plan, and plain CPM reels can't be switched.
  assert.equal(postPayoutTerms({ postedAt: "2026-11-01T00:00:00Z", payoutBasis }, plan, 49).mode, "cpm");
  assert.equal(payoutBasisPreview({ views: 100 }, { mode: "cpm", rateINR: 49, baseINR: 0, thresholdViews: 0 }, 49), undefined);
  // Nothing credited yet: the wallet doesn't move.
  assert.equal(payoutBasisPreview({ views: 100 }, { ...switchPlan, started: false }, 49)!.walletChangeINR, 0);
});
