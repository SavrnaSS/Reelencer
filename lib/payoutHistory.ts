export type PayoutHistoryItem = {
  id: string;
  amountINR: number;
  handle?: string;
  workItemTitle?: string;
  reelUrl?: string;
  reason?: string;
};

export type PayoutHistoryBatch = {
  id: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  periodStart: string;
  periodEnd: string;
  method: string;
  origin?: "auto" | "manual";
  /** Where it was sent: a UPI ID or a masked bank account. */
  payTo?: string;
  items: PayoutHistoryItem[];
  notes?: string[];
  paymentReference?: string;
};

/** Sum the frozen payout items in paise; malformed amounts cannot look like a verified total. */
export function payoutHistoryTotal(items: readonly Pick<PayoutHistoryItem, "amountINR">[]) {
  let paise = 0;
  for (const item of items) {
    if (!Number.isFinite(item.amountINR) || item.amountINR < 0) return undefined;
    paise += Math.round(item.amountINR * 100);
    if (!Number.isSafeInteger(paise)) return undefined;
  }
  return paise / 100;
}

/**
 * What a payout's status means for the creator's wallet. A request holds its amount out of the available balance;
 * approval and payment take it out for good; a rejected payout returns every rupee to the available balance.
 * (The database enforces this: request_payout reserves the credits; a rejected cycle's items become Failed and
 * are released.)
 */
export type PayoutWalletEffect = "held" | "deducted" | "returned" | "unknown";

export function payoutHistoryStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case "paid": return { label: "Paid", detail: "Sent to you. This amount has left your wallet for good.", tone: "success" as const, effect: "deducted" as PayoutWalletEffect };
    case "processing": return { label: "Approved", detail: "Approved and being sent to you. The amount has left your wallet.", tone: "info" as const, effect: "deducted" as PayoutWalletEffect };
    case "failed": return { label: "Rejected", detail: "Not approved. The full amount was returned to your wallet.", tone: "danger" as const, effect: "returned" as PayoutWalletEffect };
    case "draft": return { label: "Requested", detail: "Held from your wallet while the payout team reviews it.", tone: "pending" as const, effect: "held" as PayoutWalletEffect };
    default: return { label: "Status unavailable", detail: "Refresh to check this payout’s status.", tone: "neutral" as const, effect: "unknown" as PayoutWalletEffect };
  }
}

/**
 * Where a creator's credited money is, from the wallet balance and their payouts: available to withdraw, held in a
 * payout under review, approved or paid (gone for good), and returned from rejected payouts (back in available).
 */
export function payoutWalletLedger(batches: ReadonlyArray<{ status: string; items: ReadonlyArray<{ amountINR: number }> }>, available?: number) {
  const paise = { held: 0, deducted: 0, returned: 0, paid: 0 };
  let heldCount = 0, returnedCount = 0;
  for (const batch of batches) {
    const total = payoutHistoryTotal(batch.items);
    if (total === undefined) continue;
    const cents = Math.round(total * 100);
    const status = payoutHistoryStatus(batch.status);
    if (status.effect === "held") { paise.held += cents; heldCount++; }
    else if (status.effect === "deducted") { paise.deducted += cents; if (status.label === "Paid") paise.paid += cents; }
    else if (status.effect === "returned") { paise.returned += cents; returnedCount++; }
  }
  const availablePaise = available !== undefined && Number.isFinite(available) ? Math.round(available * 100) : undefined;
  return {
    available: availablePaise === undefined ? undefined : availablePaise / 100,
    held: paise.held / 100,
    /** Approved (being sent) and paid: no longer in the wallet. */
    withdrawn: paise.deducted / 100,
    paid: paise.paid / 100,
    returned: paise.returned / 100,
    heldCount,
    returnedCount,
    /** Everything the wallet has received: what's available, held and withdrawn (returned money is in available). */
    credited: availablePaise === undefined ? undefined : (availablePaise + paise.held + paise.deducted) / 100,
  };
}

export function payoutEarningTitle(item: Pick<PayoutHistoryItem, "workItemTitle">) {
  const title = item.workItemTitle?.trim();
  // Older cached responses may only contain internal references. They never become display labels.
  return title && !/^(?:(?:VIEW|REEL)-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)
    ? title : "Approved earnings";
}

export function payoutHistoryDate(value: string | undefined, includeTime = false) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function payoutHistoryNotes(notes: readonly string[] = []) {
  return [...new Set(notes.filter(note => typeof note === "string").map(note => note.trim()).filter(note => note && !/^requested by worker$/i.test(note)))];
}
