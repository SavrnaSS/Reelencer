import { reelEarnings, type LinkedSocialAccount } from "./socialAnalytics";

export type AccountEarnings = {
  accountId: string;
  handle: string;
  gigTitle?: string;
  approved: number;
  pending: number;
  approvedReels: number;
  pendingReels: number;
  missingCounts: number;
};

/** Add the amounts displayed on each account card, in paise; never add payout credits again. */
export function summarizeAccountEarnings(accounts: LinkedSocialAccount[]) {
  const breakdown: AccountEarnings[] = [];
  for (const account of new Map(accounts.map(account => [account.id, account])).values()) {
    if (account.status === "unlinked") continue;
    const earnings = reelEarnings(account);
    // INR dashboard totals cannot combine currencies or convert a foreign payout rate.
    if (!earnings || !["", "₹", "INR"].includes(earnings.symbol)) continue;
    breakdown.push({
      accountId: account.id, handle: account.handle, gigTitle: account.gigTitle,
      approved: earnings.approvedAmount, pending: earnings.pendingAmount,
      approvedReels: earnings.approved, pendingReels: earnings.pending,
      missingCounts: (earnings.unmeasuredApproved ?? 0) + (earnings.unmeasuredPending ?? 0),
    });
  }
  const sum = (key: "approved" | "pending") => breakdown.reduce((total, row) => total + Math.round(row[key] * 100), 0) / 100;
  return {
    approved: sum("approved"), pending: sum("pending"), accountCount: breakdown.length,
    approvedReels: breakdown.reduce((total, row) => total + row.approvedReels, 0),
    pendingReels: breakdown.reduce((total, row) => total + row.pendingReels, 0),
    missingCounts: breakdown.reduce((total, row) => total + row.missingCounts, 0),
    breakdown,
  };
}

export type AccountEarningsSummary = ReturnType<typeof summarizeAccountEarnings>;

export function isOpenPayoutStatus(status: string) {
  return ["draft", "pending", "submitted", "approved", "processing"].includes(status.trim().toLowerCase());
}

export function summarizePayoutBatches(batches: Array<{ status: string; items: Array<{ amountINR: number }> }>) {
  const totals = { credited: 0, pending: 0, liveBatches: 0 };
  for (const batch of batches) {
    const amount = (batch.items ?? []).reduce((sum, item) => {
      const value = Number(item.amountINR);
      return sum + (Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0);
    }, 0);
    if (batch.status.trim().toLowerCase() === "paid") totals.credited += amount;
    else if (isOpenPayoutStatus(batch.status)) {
      totals.pending += amount;
      totals.liveBatches++;
    }
  }
  return { ...totals, credited: totals.credited / 100, pending: totals.pending / 100 };
}

const normalizeHandle = (handle?: string) => String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();

/**
 * Where a Content Posting creator stands on one gig's linked account: reels submitted and reviewed, and money paid
 * or queued for that account (payout items are matched by handle). Drives the "post, then get paid" steps.
 */
export function postingProgress(
  account: Pick<LinkedSocialAccount, "handle" | "posts" | "payout" | "payoutType"> | null | undefined,
  batches: Array<{ status: string; items: Array<{ amountINR: number; handle?: string }> }>,
) {
  const posts = account?.posts ?? [];
  const approved = posts.filter((post) => post.status === "approved").length;
  const inReview = posts.filter((post) => post.status === "submitted").length;
  const rejected = posts.filter((post) => post.status === "rejected").length;
  const handle = normalizeHandle(account?.handle);
  let paid = 0;
  let inPayout = 0;
  if (handle) {
    for (const batch of batches) {
      const status = batch.status.trim().toLowerCase();
      for (const item of batch.items ?? []) {
        const value = Number(item.amountINR);
        if (normalizeHandle(item.handle) !== handle || !Number.isFinite(value) || value <= 0) continue;
        if (status === "paid") paid += Math.round(value * 100);
        else if (isOpenPayoutStatus(status)) inPayout += Math.round(value * 100);
      }
    }
  }
  const earnings = account ? reelEarnings(account) : undefined;
  return {
    submitted: approved + inReview,
    approved,
    inReview,
    rejected,
    paid: paid / 100,
    inPayout: inPayout / 100,
    /** Earned on approved reels at the gig's rate, before payout; `symbol` is the rate's currency. */
    earned: earnings?.approvedAmount ?? 0,
    symbol: earnings?.symbol || "₹",
  };
}

export type PostingProgress = ReturnType<typeof postingProgress>;
