import test from "node:test";
import assert from "node:assert/strict";
import { MIN_PAYOUT_REQUEST_INR } from "../../lib/payoutPolicy";
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

test("INR 500 still requires approved KYC, verified UPI and no active request", () => {
  const eligible = { ...verified, eligibleAmount: 500 };
  assert.equal(buildPayoutReadiness({ ...eligible, kycStatus: "rejected" }).primaryBlocker?.code, "kyc_rejected");
  assert.equal(buildPayoutReadiness({ ...eligible, upiVerified: false }).primaryBlocker?.code, "upi_unverified");
  assert.equal(buildPayoutReadiness({ ...eligible, hasActiveBatch: true }).primaryBlocker?.code, "active_batch");
});

test("minimum withdrawal API errors report INR 500", () => {
  assert.throws(() => databaseError({ code: "P0001", message: "minimum_amount" }), (error: unknown) =>
    error instanceof ApiError && error.status === 400 && error.code === "minimum_amount" &&
    error.message === "At least ₹500 in eligible earnings is required.");
});
