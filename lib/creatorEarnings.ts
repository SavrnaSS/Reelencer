import { reelEarnings, type LinkedSocialAccount } from "./socialAnalytics";
import { needsProfileRecovery } from "./accountProfileHealth";
import { countedReels } from "./reelTracking";
import { readSocialAccountWalletCredits, readSocialPostWalletCredit } from "./socialWallet";

export type AccountEarnings = {
  accountId: string;
  handle: string;
  gigTitle?: string;
  approved: number;
  pending: number;
  approvedReels: number;
  pendingReels: number;
  missingCounts: number;
  /** True only when every amount is backed by the complete wallet read model. */
  walletVerified?: boolean;
};

/** Ledger credits and unreviewed estimates remain separate. Old snapshots retain explicitly estimated totals. */
export function summarizeAccountEarnings(accounts: LinkedSocialAccount[]) {
  const breakdown: AccountEarnings[] = [];
  for (const account of new Map(accounts.map(account => [account.id, account])).values()) {
    const wallet = readSocialAccountWalletCredits(account.walletCredits);
    if (account.status === "unlinked" && !needsProfileRecovery(account) && !wallet?.amountINR) continue;
    const earnings = reelEarnings(account);
    // INR dashboard totals cannot combine currencies or convert a foreign payout rate.
    const hasInrRate = earnings && ["", "₹", "INR"].includes(earnings.symbol);
    if (!hasInrRate && !wallet?.amountINR) continue;
    const posts = countedReels(account.posts, account.linkedAt);
    const walletVerified = !!wallet && posts.every(post => !!readSocialPostWalletCredit(post.walletCredit));
    let pending = hasInrRate ? earnings.pendingAmount : 0;
    let pendingReels = hasInrRate ? earnings.pending : 0;
    if (walletVerified) {
      let pendingPaise = 0;
      pendingReels = 0;
      for (const post of posts) {
        const credit = readSocialPostWalletCredit(post.walletCredit)!;
        let paise = Math.round(credit.pendingClaimINR * 100);
        const needsReview = post.status === "submitted" || post.status === "approved";
        if (hasInrRate && needsReview) {
          if (earnings.basis === "views") {
            if (Number.isSafeInteger(post.views) && post.views! >= 0 && post.views! > credit.consumedViews) {
              const rate = BigInt(Math.round(earnings.rateAmount * 100));
              const cumulative = (views: number) => (BigInt(views) * rate + BigInt(500)) / BigInt(1000);
              paise += Number(cumulative(post.views!) - cumulative(credit.consumedViews));
            }
          } else if (!credit.fixedCredit && credit.creditedINR === 0 && credit.consumedViews === 0) {
            paise += Math.round(earnings.rateAmount * 100);
          }
        }
        pendingPaise += paise;
        if (post.status === "submitted" || paise > 0 || (needsReview && hasInrRate && earnings.basis === "views" && post.views === undefined)) pendingReels++;
      }
      pending = pendingPaise / 100;
    }
    breakdown.push({
      accountId: account.id, handle: account.handle, gigTitle: account.gigTitle,
      approved: walletVerified ? wallet!.amountINR : hasInrRate ? earnings.approvedAmount : wallet?.amountINR ?? 0,
      pending,
      approvedReels: walletVerified ? wallet!.reels : hasInrRate ? earnings.approved : wallet?.reels ?? 0,
      pendingReels,
      missingCounts: hasInrRate ? (earnings.unmeasuredApproved ?? 0) + (earnings.unmeasuredPending ?? 0) : 0,
      walletVerified,
    });
  }
  const sum = (key: "approved" | "pending") => breakdown.reduce((total, row) => total + Math.round(row[key] * 100), 0) / 100;
  return {
    approved: sum("approved"), pending: sum("pending"), accountCount: breakdown.length,
    approvedReels: breakdown.reduce((total, row) => total + row.approvedReels, 0),
    pendingReels: breakdown.reduce((total, row) => total + row.pendingReels, 0),
    missingCounts: breakdown.reduce((total, row) => total + row.missingCounts, 0),
    walletVerified: breakdown.length > 0 && breakdown.every(row => row.walletVerified),
    breakdown,
  };
}

/** Optional on legacy/demo figures; absence must never be presented as a verified wallet credit. */
export type AccountEarningsSummary = Omit<ReturnType<typeof summarizeAccountEarnings>, "walletVerified"> & { walletVerified?: boolean };

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
  account: (Pick<LinkedSocialAccount, "handle" | "posts" | "payout" | "payoutType"> & { linkedAt?: string }) | null | undefined,
  batches: Array<{ status: string; items: Array<{ amountINR: number; handle?: string }> }>,
) {
  // Reels from before the account was linked don't count towards posting progress or pay.
  const posts = countedReels(account?.posts ?? [], account?.linkedAt);
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
