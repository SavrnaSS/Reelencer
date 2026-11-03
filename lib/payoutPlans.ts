import { formatMoney } from "./money";

/**
 * Custom creator payout plans: a fixed base per approved reel, with the view rate only applying past a threshold.
 * Client-safe. Mirrors `public.reel_payout_cumulative` in 202611030001_creator_payout_plans.sql exactly (paise
 * rounding included) so every estimate matches what the database credits.
 */

export type PayoutPlanMode = "beyond" | "all";
export type PayoutMode = "cpm" | PayoutPlanMode;

/** The terms a reel earns under. `cpm` is the gig's plain rate per 1,000 views. */
export type PayoutTerms = {
  mode: PayoutMode;
  rateINR: number;
  baseINR: number;
  thresholdViews: number;
  planId?: string;
  planName?: string;
  /** True once the reel has a frozen earnings interval: its base is already paid or forfeited. */
  started?: boolean;
};

/** A creator's current plan on one linked account, for reels that haven't started earning. */
export type AccountPayoutPlan = PayoutTerms & { mode: PayoutPlanMode; appliesFrom: string };

export type PayoutPlan = {
  id: string;
  name: string;
  description: string;
  base_inr: number;
  threshold_views: number;
  rate_inr: number | null;
  mode: PayoutPlanMode;
  gig_id: string | null;
  gigTitle?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  memberCount: number;
  reels: number;
  creditedINR: number;
  baseCreditedINR: number;
};
export type PayoutPlanMember = { workerId: string; planId: string; appliesFrom: string; assignedAt: string; workerCode: string; email: string };
export type PayoutPlanGig = { id: string; title: string; company: string; rateINR: number };
export type PayoutPlansSnapshot = { plans: PayoutPlan[]; members: PayoutPlanMember[]; gigs: PayoutPlanGig[] };

export const PLAN_LIMITS = { name: 80, description: 300, base: 1_000_000, threshold: 1_000_000_000, rate: 100_000 } as const;
export const PLAN_MODE_LABELS: Record<PayoutPlanMode, { title: string; hint: string }> = {
  all: { title: "Switch to the view rate", hint: "Base until the threshold. Past it, the reel earns the view rate on all its views (never less than the base)." },
  beyond: { title: "Base + rate on extra views", hint: "The base covers views up to the threshold; every 1K views past it adds the rate." },
};

const paise = (amount: number) => BigInt(Math.round(amount * 100));
/** Same as SQL round(views × rate / 1000, 2), in paise. Half-up; inputs are non-negative. */
const ratePaise = (views: number, rate: number) => (BigInt(Math.max(0, Math.trunc(views))) * paise(rate) + BigInt(500)) / BigInt(1000);

/** Cumulative earnings for a reel at `views`, in paise. Every interval is a difference of two of these. */
export function cumulativePaise(views: number, terms: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">): bigint {
  const v = Math.max(0, Math.trunc(Number.isFinite(views) ? views : 0));
  if (terms.mode === "beyond") return paise(terms.baseINR) + ratePaise(v - terms.thresholdViews, terms.rateINR);
  if (terms.mode === "all") {
    if (v <= terms.thresholdViews) return paise(terms.baseINR);
    const full = ratePaise(v, terms.rateINR);
    return full > paise(terms.baseINR) ? full : paise(terms.baseINR);
  }
  return ratePaise(v, terms.rateINR);
}

/** What a reel at `views` earns in total under `terms`, in rupees. */
export function reelPayoutINR(views: number, terms: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">) {
  return Number(cumulativePaise(views, terms)) / 100;
}

/**
 * What's still owed for a reel: from `consumedViews` (already credited or claimed) up to `views`. A plan reel that
 * hasn't started earning is owed its whole cumulative amount, base included, even before views are measured.
 */
export function outstandingPaise(views: number | undefined, consumedViews: number, terms: PayoutTerms): number {
  const plan = terms.mode !== "cpm";
  if (plan && !terms.started) return Number(cumulativePaise(views ?? 0, terms));
  if (views === undefined || !Number.isSafeInteger(views) || views <= consumedViews) return 0;
  return Number(cumulativePaise(views, terms) - cumulativePaise(consumedViews, terms));
}

/** The terms an unstarted reel posted at `postedAt` would get from the account's plan, else the plain rate. */
export function termsForReel(plan: AccountPayoutPlan | undefined, gigRate: number, postedAt?: string): PayoutTerms {
  if (plan && (!postedAt || !Number.isFinite(Date.parse(postedAt)) || Date.parse(postedAt) >= Date.parse(plan.appliesFrom))) return { ...plan, started: false };
  return { mode: "cpm", rateINR: gigRate, baseINR: 0, thresholdViews: 0, started: false };
}

/** ₹200 for whole rupees, ₹612.50 otherwise: the same format as every other amount in the app. */
export const formatINR = (amount: number) => formatMoney(amount);
export function compactViews(views: number) {
  if (views >= 1_000_000) return `${+(views / 1_000_000).toFixed(views % 1_000_000 ? 1 : 0)}M`;
  if (views >= 1_000) return `${+(views / 1_000).toFixed(views % 1_000 ? 1 : 0)}K`;
  return String(views);
}

/** "₹200 per reel up to 10K views, then ₹49 per 1K views beyond 10K" */
export function describePlan(terms: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">) {
  const threshold = compactViews(terms.thresholdViews);
  const base = `${formatINR(terms.baseINR)} per approved reel up to ${threshold} views`;
  return terms.mode === "all"
    ? `${base}, then ${formatINR(terms.rateINR)} per 1K on all views once past ${threshold}`
    : `${base}, then ${formatINR(terms.rateINR)} per 1K views beyond ${threshold}`;
}

/** Short form for chips: "₹200 + ₹49/1K after 10K" */
export function shortPlan(terms: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">) {
  return `${formatINR(terms.baseINR)} + ${formatINR(terms.rateINR)}/1K ${terms.mode === "all" ? "past" : "after"} ${compactViews(terms.thresholdViews)}`;
}

/** Checkpoints for comparing a plan with plain pay, centred on the threshold. */
export function comparisonPoints(threshold: number) {
  const points = new Set([0, Math.round(threshold / 2), threshold, Math.round(threshold * 1.5), threshold * 2, threshold * 5, threshold * 10]);
  return [...points].filter(n => n >= 0 && Number.isSafeInteger(n)).sort((a, b) => a - b);
}

/** Views where a plan stops paying more than plain per-1K pay (null if it never does within reason). */
export function breakEvenViews(terms: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">, gigRate: number) {
  if (!(gigRate > 0)) return null;
  // Plain pay overtakes once views × gigRate / 1000 ≥ plan payout. Binary search the monotone difference.
  let low = 0, high = 2_000_000_000;
  const plainAhead = (v: number) => ratePaise(v, gigRate) >= cumulativePaise(v, terms);
  if (!plainAhead(high)) return null;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (plainAhead(mid)) high = mid; else low = mid + 1; }
  return low;
}

export type PlanDraft = { name: string; description: string; baseINR: string; thresholdViews: string; rateINR: string; mode: PayoutPlanMode; gigId: string; active: boolean };

/** Field errors for a plan form, matching the database's checks. */
export function validatePlanDraft(draft: PlanDraft) {
  const errors: Partial<Record<keyof PlanDraft, string>> = {};
  const money = /^\d+(\.\d{1,2})?$/;
  if (!draft.name.trim()) errors.name = "Give the plan a name.";
  else if (draft.name.trim().length > PLAN_LIMITS.name) errors.name = `Keep it under ${PLAN_LIMITS.name} characters.`;
  if (draft.description.trim().length > PLAN_LIMITS.description) errors.description = `Keep it under ${PLAN_LIMITS.description} characters.`;
  if (!money.test(draft.baseINR.trim()) || Number(draft.baseINR) <= 0 || Number(draft.baseINR) > PLAN_LIMITS.base) errors.baseINR = "Enter an amount above ₹0, with at most 2 decimals.";
  if (!/^\d+$/.test(draft.thresholdViews.trim()) || Number(draft.thresholdViews) < 1 || Number(draft.thresholdViews) > PLAN_LIMITS.threshold) errors.thresholdViews = "Enter whole views, at least 1.";
  if (draft.rateINR.trim() && (!money.test(draft.rateINR.trim()) || Number(draft.rateINR) <= 0 || Number(draft.rateINR) > PLAN_LIMITS.rate)) errors.rateINR = "Enter a rate above ₹0, or leave empty to use the gig's.";
  return errors;
}

export function planDraftFrom(plan?: PayoutPlan): PlanDraft {
  return plan
    ? { name: plan.name, description: plan.description, baseINR: String(Number(plan.base_inr)), thresholdViews: String(Number(plan.threshold_views)), rateINR: plan.rate_inr == null ? "" : String(Number(plan.rate_inr)), mode: plan.mode, gigId: plan.gig_id ?? "", active: plan.active }
    : { name: "", description: "", baseINR: "200", thresholdViews: "10000", rateINR: "", mode: "all", gigId: "", active: true };
}

/** Parse the read model's terms object; anything malformed is treated as absent, never guessed. */
export function readPayoutTerms(value: unknown): PayoutTerms | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const mode = row.mode;
  const nums = [row.rateINR, row.baseINR, row.thresholdViews].map(Number);
  if ((mode !== "cpm" && mode !== "beyond" && mode !== "all") || !nums.every(n => Number.isFinite(n) && n >= 0) || !(nums[0] > 0)) return undefined;
  if (mode !== "cpm" && !(nums[1] > 0 && nums[2] > 0)) return undefined;
  return {
    mode, rateINR: nums[0], baseINR: nums[1], thresholdViews: Math.trunc(nums[2]),
    ...(typeof row.planId === "string" ? { planId: row.planId } : {}),
    ...(typeof row.planName === "string" && row.planName ? { planName: row.planName } : {}),
    ...(typeof row.started === "boolean" ? { started: row.started } : {}),
  };
}

export function readAccountPayoutPlan(value: unknown): AccountPayoutPlan | undefined {
  const terms = readPayoutTerms(value);
  const appliesFrom = value && typeof value === "object" ? (value as Record<string, unknown>).appliesFrom : undefined;
  if (!terms || terms.mode === "cpm" || typeof appliesFrom !== "string" || !Number.isFinite(Date.parse(appliesFrom))) return undefined;
  return { ...terms, mode: terms.mode, appliesFrom };
}

/**
 * The terms a reel earns under on the creator's side: the read model's frozen terms when present, plain pay for
 * other reels the wallet already knows, and otherwise the account's current plan if the reel falls in its window.
 */
export function postPayoutTerms(post: { postedAt?: string; walletCredit?: { payoutTerms?: PayoutTerms } }, plan: AccountPayoutPlan | undefined, gigRate: number): PayoutTerms {
  if (post.walletCredit) return post.walletCredit.payoutTerms ?? termsForReel(undefined, gigRate);
  return termsForReel(plan, gigRate, post.postedAt);
}

type PlanPost = { id: string; status: "submitted" | "approved" | "rejected"; views?: number; postedAt?: string; walletCredit?: { payoutTerms?: PayoutTerms } };
export type PlanReel<P> = { post: P; views: number; measured: boolean; earnsINR: number; progress: number; remainingToBoost: number; boosted: boolean };

/**
 * A creator's reels split by how they're paid, for the pay plan card. Rejected reels earn nothing and are left out;
 * amounts are estimates at current views (approval credits them to the wallet).
 */
export function planReelSummary<P extends PlanPost>(posts: readonly P[], plan: AccountPayoutPlan, gigRate: number) {
  const reels: PlanReel<P>[] = [];
  let standardReels = 0, standardPaise = 0, standardViews = 0;
  for (const post of posts) {
    if (post.status === "rejected") continue;
    const terms = postPayoutTerms(post, plan, gigRate);
    const measured = Number.isSafeInteger(post.views) && post.views! >= 0;
    const views = measured ? post.views! : 0;
    if (terms.mode === "cpm") {
      standardReels++;
      standardViews += views;
      standardPaise += Number(cumulativePaise(views, terms));
      continue;
    }
    const threshold = terms.thresholdViews;
    reels.push({ post, views, measured, earnsINR: reelPayoutINR(views, terms), progress: Math.min(1, views / threshold), remainingToBoost: Math.max(0, threshold + 1 - views), boosted: views > threshold });
  }
  const sum = (list: PlanReel<P>[]) => list.reduce((total, reel) => total + Math.round(reel.earnsINR * 100), 0) / 100;
  const approved = reels.filter(reel => reel.post.status === "approved");
  const inReview = reels.filter(reel => reel.post.status === "submitted");
  return {
    reels, approved, inReview,
    approvedINR: sum(approved), inReviewINR: sum(inReview),
    boostedCount: reels.filter(reel => reel.boosted).length,
    standard: { reels: standardReels, views: standardViews, amountINR: standardPaise / 100 },
  };
}

/** Plain-language lines for creators. */
export function planCopy(plan: Pick<PayoutTerms, "mode" | "rateINR" | "baseINR" | "thresholdViews">) {
  const base = formatINR(plan.baseINR), rate = formatINR(plan.rateINR), threshold = plan.thresholdViews.toLocaleString("en-IN");
  const big = plan.thresholdViews * 2;
  return {
    headline: `${base} for every approved reel`,
    baseTitle: `${base} for each reel`,
    baseText: `Every reel the team approves earns ${base}, even before it gets views.`,
    boostTitle: `More once a reel passes ${compactViews(plan.thresholdViews)} views`,
    boostText: plan.mode === "all"
      ? `When a reel goes over ${threshold} views, it's paid ${rate} for every 1,000 of its views instead, if that's more than ${base}.`
      : `Every 1,000 views a reel gets after ${threshold} adds ${rate} on top of its ${base}.`,
    examples: [Math.round(plan.thresholdViews / 2), plan.thresholdViews, big].map(views => ({ views, amountINR: reelPayoutINR(views, plan) })),
  };
}
