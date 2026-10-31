import test from "node:test";
import assert from "node:assert/strict";
import { payoutEarningTitle, payoutHistoryDate, payoutHistoryNotes, payoutHistoryStatus, payoutHistoryTotal, payoutWalletLedger } from "../../lib/payoutHistory";

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
  assert.equal(payoutHistoryStatus("Processing").label, "Approved");
  assert.equal(payoutHistoryStatus("Paid").tone, "success");
  assert.equal(payoutHistoryStatus("Failed").label, "Rejected");
  assert.match(payoutHistoryStatus("Failed").detail, /returned to your wallet/);
  assert.deepEqual(["Draft", "Processing", "Paid", "Failed"].map(status => payoutHistoryStatus(status).effect), ["held", "deducted", "deducted", "returned"]);
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

test("the wallet ledger separates held, withdrawn and returned payouts, and credited equals what the wallet received", () => {
  const batch = (status: string, ...amounts: number[]) => ({ status, items: amounts.map(amountINR => ({ amountINR })) });
  const ledger = payoutWalletLedger([batch("Draft", 500.5), batch("Processing", 300), batch("Paid", 1000, 0.25), batch("Failed", 901.63), batch("Failed", 100)], 1150.1);
  assert.equal(ledger.available, 1150.1);
  assert.equal(ledger.held, 500.5);
  assert.equal(ledger.withdrawn, 1300.25);
  assert.equal(ledger.paid, 1000.25);
  assert.equal(ledger.returned, 1001.63);
  assert.equal(ledger.heldCount, 1);
  assert.equal(ledger.returnedCount, 2);
  assert.equal(ledger.credited, 2950.85, "returned money already counts in the available balance");
  assert.equal(payoutWalletLedger([batch("Paid", 10)]).credited, undefined, "without the balance, the total isn't guessed");
  assert.equal(payoutWalletLedger([batch("Paid", Number.NaN)]).withdrawn, 0, "a malformed payout never moves money in the ledger");
});
