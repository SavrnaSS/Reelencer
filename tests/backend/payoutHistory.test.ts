import test from "node:test";
import assert from "node:assert/strict";
import { payoutEarningTitle, payoutHistoryDate, payoutHistoryNotes, payoutHistoryStatus, payoutHistoryTotal } from "../../lib/payoutHistory";

test("history totals include all earnings, with exact paise across paginated rows", () => {
  const items = Array.from({ length: 24 }, (_, index) => ({ amountINR: index === 23 ? 39.13 : 37.5 }));
  assert.equal(payoutHistoryTotal(items), 901.63);
  assert.equal(payoutHistoryTotal([{ amountINR: 0.1 }, { amountINR: 0.2 }]), 0.3);
  assert.equal(payoutHistoryTotal([{ amountINR: 0 }]), 0);
  assert.equal(payoutHistoryTotal([]), 0);
});

test("invalid history amounts never masquerade as a verified partial total", () => {
  for (const amountINR of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(payoutHistoryTotal([{ amountINR: 37.5 }, { amountINR }]), undefined);
  }
});

test("earnings titles never fall back to internal work references", () => {
  const uuid = "9b0bcfe5-bc32-435d-a56a-ce6d10f93b3c";
  assert.equal(payoutEarningTitle({ workItemTitle: " Approved reel view earnings " }), "Approved reel view earnings");
  for (const workItemTitle of [undefined, "", "   ", uuid, `VIEW-${uuid}`, `REEL-${uuid}`]) {
    assert.equal(payoutEarningTitle({ workItemTitle }), "Approved earnings");
  }
});

test("history presents requested payouts clearly without marking unfinished payouts as paid", () => {
  assert.equal(payoutHistoryStatus("Draft").label, "Requested");
  assert.equal(payoutHistoryStatus("Processing").label, "Processing");
  assert.equal(payoutHistoryStatus("Paid").tone, "success");
  assert.equal(payoutHistoryStatus("Failed").label, "Not completed");
  assert.equal(payoutHistoryStatus("unknown").label, "Status unavailable");
});

test("payout dates use the India calendar and malformed dates stay unavailable", () => {
  assert.equal(payoutHistoryDate("2026-10-30T20:00:00Z"), "31 Oct 2026");
  assert.equal(payoutHistoryDate("invalid"), "Date unavailable");
  assert.equal(payoutHistoryDate(undefined), "Date unavailable");
});

test("history removes duplicate and redundant request notes while preserving useful updates", () => {
  assert.deepEqual(payoutHistoryNotes(["Requested by worker", " Payment reference updated ", "Payment reference updated", "", "Contact support about the returned payment"]), ["Payment reference updated", "Contact support about the returned payment"]);
});
