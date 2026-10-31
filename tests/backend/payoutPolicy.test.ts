import test from "node:test";
import assert from "node:assert/strict";
import { KYC_FREE_WITHDRAWAL_LIMIT_INR, MIN_PAYOUT_REQUEST_INR, autoWithdrawalDay, nextAutoWithdrawalAt, payoutKycRequired, nextManualWithdrawalAt } from "../../lib/payoutPolicy";
import { buildPayoutReadiness } from "../../lib/payoutReadiness";
import { ApiError, databaseError } from "../../lib/api/errors";

const verified = {
  kycStatus: "approved" as const,
  upiVerified: true,
  hasActiveBatch: false,
  eligibleItemCount: 1,
  minimumAmount: MIN_PAYOUT_REQUEST_INR,
};

test("withdrawal readiness uses the INR 500 boundary", () => {
  assert.equal(MIN_PAYOUT_REQUEST_INR, 500);
  const below = buildPayoutReadiness({ ...verified, eligibleAmount: 499.99 });
  assert.equal(below.ready, false);
  assert.equal(below.primaryBlocker?.code, "below_minimum");
  for (const eligibleAmount of [500, 750, 1000]) {
    assert.equal(buildPayoutReadiness({ ...verified, eligibleAmount }).ready, true);
  }
});

test("INR 500 still requires verified UPI and no active request, and no KYC while earnings stay within INR 1,000", () => {
  const eligible = { ...verified, eligibleAmount: 500, lifetimeCredited: 1000 };
  for (const kycStatus of ["none", "pending", "rejected"] as const) {
    const readiness = buildPayoutReadiness({ ...eligible, kycStatus });
    assert.equal(readiness.ready, true, kycStatus);
    assert.equal(readiness.kycRequired, false);
    assert.equal(readiness.requestAmount, 500);
  }
  assert.equal(buildPayoutReadiness({ ...eligible, upiVerified: false }).primaryBlocker?.code, "upi_unverified");
  assert.equal(buildPayoutReadiness({ ...eligible, hasActiveBatch: true }).primaryBlocker?.code, "active_batch");
});

test("once the wallet has received more than INR 1,000 in total, every payout waits for approved KYC", () => {
  assert.equal(KYC_FREE_WITHDRAWAL_LIMIT_INR, 1000);
  assert.equal(payoutKycRequired(false, 1000), false);
  assert.equal(payoutKycRequired(false, 1000.01), true);
  assert.equal(payoutKycRequired(true, 50_000), false);
  // Most of it already withdrawn: the balance is small, but lifetime credits decide.
  for (const [kycStatus, code] of [["none", "kyc_missing"], ["pending", "kyc_pending"], ["rejected", "kyc_rejected"]] as const) {
    const blocked = buildPayoutReadiness({ ...verified, kycStatus, eligibleAmount: 600, lifetimeCredited: 1500 });
    assert.equal(blocked.primaryBlocker?.code, code);
    assert.equal(blocked.kycRequired, true);
    assert.equal(blocked.requestAmount, 0);
  }
  // Even below the minimum, KYC is reported first so the creator can fix it early.
  assert.deepEqual(buildPayoutReadiness({ ...verified, kycStatus: "none", eligibleAmount: 300, lifetimeCredited: 2928.42 }).blockers.map(b => b.code), ["kyc_missing", "below_minimum"]);
  // Without a lifetime figure, the balance itself is the lower bound.
  assert.equal(buildPayoutReadiness({ ...verified, kycStatus: "none", eligibleAmount: 2928.42 }).kycRequired, true);
  const approved = buildPayoutReadiness({ ...verified, eligibleAmount: 2928.42, lifetimeCredited: 5000 });
  assert.equal(approved.ready, true);
  assert.equal(approved.requestAmount, 2928.42);
});

test("minimum withdrawal API errors report INR 500", () => {
  assert.throws(() => databaseError({ code: "P0001", message: "minimum_amount" }), (error: unknown) =>
    error instanceof ApiError && error.status === 400 && error.code === "minimum_amount" &&
    error.message === "At least ₹500 in eligible earnings is required.");
});

test("manual withdrawals reopen 7 days after the last request, and auto-withdrawals follow the chosen monthly day", () => {
  const now = Date.parse("2026-10-31T06:30:00Z"); // 31 Oct, 12:00 India time
  assert.equal(nextManualWithdrawalAt(null, now), null);
  assert.equal(nextManualWithdrawalAt("2026-10-24T06:29:00Z", now), null);
  assert.equal(nextManualWithdrawalAt("2026-10-30T10:00:00Z", now)?.toISOString(), "2026-11-06T10:00:00.000Z");
  assert.equal(autoWithdrawalDay("Monthly", "15"), 15);
  assert.equal(autoWithdrawalDay("Weekly", "Fri"), 1);
  assert.equal(autoWithdrawalDay("Monthly", "31"), 1);
  // Not yet run this month and the day has passed: it runs today. Already run: the chosen day next month.
  assert.equal(nextAutoWithdrawalAt(1, false, now).toISOString(), "2026-10-30T18:30:00.000Z");
  assert.equal(nextAutoWithdrawalAt(1, true, now).toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(nextAutoWithdrawalAt(5, true, Date.parse("2026-12-20T00:00:00Z")).toISOString(), "2027-01-04T18:30:00.000Z");
  const weekly = buildPayoutReadiness({ ...verified, eligibleAmount: 900, nextManualAt: new Date("2026-11-06T10:00:00Z") });
  assert.equal(weekly.primaryBlocker?.code, "weekly_limit");
  assert.match(weekly.primaryBlocker?.detail ?? "", /6 Nov/);
  assert.equal(buildPayoutReadiness({ ...verified, eligibleAmount: 900, nextManualAt: null }).ready, true);
});

test("an auto-withdrawal switched on after this month's day waits for next month", () => {
  const now = Date.parse("2026-10-31T06:30:00Z"); // 31 Oct, India time
  assert.equal(nextAutoWithdrawalAt(1, false, now, "2026-10-31T06:00:00Z").toISOString(), "2026-10-31T18:30:00.000Z");
  // Switched on today for today's date: it runs today.
  assert.equal(nextAutoWithdrawalAt(28, false, Date.parse("2026-10-28T06:30:00Z"), "2026-10-28T05:00:00Z").toISOString(), "2026-10-27T18:30:00.000Z");
  // Switched on earlier in the month, before the day: this month's date still counts.
  assert.equal(nextAutoWithdrawalAt(15, false, Date.parse("2026-10-10T06:30:00Z"), "2026-10-02T05:00:00Z").toISOString(), "2026-10-14T18:30:00.000Z");
});
