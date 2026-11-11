import { cumulativePaise, postPayoutTerms, type AccountPayoutPlan, type CpmAdjustment } from "./payoutPlans";

/**
 * Per-reel CPM adjustments: the team lowers a reel's rate per 1K views when the reel or the creator's profile gets
 * little real interaction. Client-safe. The database applies the same rate (202611110001_reel_cpm_adjustments.sql).
 */

export const CPM_REASON_IDS = ["low_signups", "low_reel_engagement", "low_profile_engagement", "no_bio_link", "no_auto_dm"] as const;
export type CpmReason = (typeof CPM_REASON_IDS)[number];

/**
 * `admin` is what the team picks. The creator reads each as a signal found on their own profile: `detected` is the
 * headline, `action` what to do, `signal`/`status` the row in their profile check.
 */
export const CPM_REASONS: Record<CpmReason, { admin: string; title: string; text: string; detected: string; action: string; signal: string; status: string }> = {
  low_signups: {
    admin: "Few viewers signing up", title: "Few viewers are signing up", text: "Your reels aren't turning viewers into Reelencer sign-ups yet.",
    detected: "Low sign-ups detected from your profile", action: "Encourage your viewers to sign up to increase your CPM value.", signal: "Viewer sign-ups", status: "Low",
  },
  low_reel_engagement: {
    admin: "Low interaction on this reel", title: "Low interaction on this reel", text: "Few likes, comments, shares or saves for the views it got.",
    detected: "Low interaction detected on your reels", action: "Ask viewers to comment and share, and reply to every comment, to increase your CPM value.", signal: "Reel interaction", status: "Low",
  },
  low_profile_engagement: {
    admin: "Low interaction on the profile", title: "Low interaction on your profile", text: "Viewers aren't visiting your profile or following from your reels.",
    detected: "Low engagement detected on your profile", action: "Give viewers a reason to open your profile: a clear bio, a pinned reel and the sign-up link.", signal: "Profile visits & follows", status: "Low",
  },
  no_bio_link: {
    admin: "reelencer.com missing from bio", title: "reelencer.com isn't in your bio", text: "Viewers who want to join have no link to tap.",
    detected: "reelencer.com is missing from your bio", action: "Add reelencer.com to your bio link so interested viewers can sign up in one tap.", signal: "Sign-up link in bio", status: "Missing",
  },
  no_auto_dm: {
    admin: "No auto DM reply to commenters", title: "Commenters don't get a DM", text: "People who comment aren't sent the sign-up link.",
    detected: "Your commenters aren't getting the sign-up link", action: "Turn on an auto DM reply so everyone who comments gets reelencer.com.", signal: "Auto DM to commenters", status: "Off",
  },
};
/** The order signals are shown in the creator's profile check. */
/** Short names for headlines like "Low sign-ups detected on 1 of your reels". */
export const SIGNAL_SHORT: Record<CpmReason, string> = {
  low_signups: "Low sign-ups", low_reel_engagement: "Low interaction", low_profile_engagement: "Few profile visits",
  no_bio_link: "No sign-up link in bio", no_auto_dm: "No auto DM to commenters",
};
export const SIGNAL_ORDER: CpmReason[] = ["low_signups", "low_reel_engagement", "low_profile_engagement", "no_bio_link", "no_auto_dm"];

export const REELENCER_LINK = "https://reelencer.com";
export const COMMENT_KEYWORD = "JOIN";

/** The things that raise a creator's CPM, each with ready-to-copy text. */
export const CPM_ACTIONS = [
  {
    id: "bio",
    title: "Add reelencer.com to your bio link",
    text: "Put it in your Instagram bio links so every viewer who visits your profile can sign up in one tap.",
    copyLabel: "Copy link",
    copy: REELENCER_LINK,
    href: "https://www.instagram.com/accounts/edit/",
    hrefLabel: "Edit profile",
    fixes: ["no_bio_link", "low_profile_engagement"] as CpmReason[],
  },
  {
    id: "dm",
    title: "Turn on auto DM replies for commenters",
    text: `Set an automatic reply so everyone who comments "${COMMENT_KEYWORD}" on your reels gets the sign-up link in their DMs.`,
    copyLabel: "Copy DM",
    copy: `Hey! 👋 Thanks for the comment. Here's the link I promised: ${REELENCER_LINK}. Sign up free and start earning from reels like mine.`,
    href: "https://help.instagram.com/",
    hrefLabel: "How to set it up",
    fixes: ["no_auto_dm", "low_reel_engagement"] as CpmReason[],
  },
  {
    id: "cta",
    title: "Ask viewers to sign up",
    text: "Say it in the reel and the caption, and pin it as the first comment. A clear ask gets more comments, and more sign-ups.",
    copyLabel: "Copy caption",
    copy: `Want to earn from reels too? Comment "${COMMENT_KEYWORD}" and I'll DM you the link 🔗 or sign up at reelencer.com (link in bio).`,
    fixes: ["low_signups", "low_reel_engagement"] as CpmReason[],
  },
  {
    id: "story",
    title: "Regularly post Reelencer's story to encourage users to sign up",
    text: "Share a story about Reelencer a few times a week, with a link sticker to reelencer.com. Followers who see you earning are the most likely to join.",
    copyLabel: "Copy story text",
    copy: "I get paid for my reels with Reelencer 💸 Want to earn too? Sign up free at reelencer.com 👆 (tap the link)",
    fixes: ["low_signups", "low_profile_engagement"] as CpmReason[],
  },
] as const;
export type CpmActionId = (typeof CPM_ACTIONS)[number]["id"];

const isReason = (value: unknown): value is CpmReason => typeof value === "string" && (CPM_REASON_IDS as readonly string[]).includes(value);

/** Reads either a database row (cpm_override_*) or an API/cached object; anything malformed is absent. */
export function readCpmAdjustment(value: unknown): CpmAdjustment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const raw = row.cpm_override_inr ?? row.rateINR;
  const rateINR = typeof raw === "string" ? Number(raw) : raw;
  if (typeof rateINR !== "number" || !Number.isFinite(rateINR) || rateINR <= 0) return undefined;
  const reasons = (Array.isArray(row.cpm_override_reasons) ? row.cpm_override_reasons : Array.isArray(row.reasons) ? row.reasons : []).filter(isReason);
  const note = typeof (row.cpm_override_note ?? row.note) === "string" ? String(row.cpm_override_note ?? row.note).trim() : "";
  const at = typeof (row.cpm_override_at ?? row.at) === "string" ? String(row.cpm_override_at ?? row.at) : undefined;
  const after = Number(row.cpm_after_views ?? row.afterViews ?? 0);
  const wallet = Number(row.cpm_wallet_change_inr ?? row.walletChangeINR ?? 0);
  return { rateINR, reasons, afterViews: Number.isSafeInteger(after) && after >= 0 ? after : 0, ...(note ? { note } : {}), ...(at ? { at } : {}), ...(Number.isFinite(wallet) && wallet !== 0 ? { walletChangeINR: wallet } : {}) };
}

type CpmPost = { id: string; status: "submitted" | "approved" | "rejected"; views?: number; postedAt?: string; createdAt?: string; caption?: string; url?: string; walletCredit?: { payoutTerms?: import("./payoutPlans").PayoutTerms }; cpmAdjustment?: CpmAdjustment };

export type AdjustedReel<P> = {
  post: P;
  rateINR: number;
  standardRateINR: number;
  /** Adjusted rate as a share of the standard one (0–1). */
  share: number;
  views: number;
  /** What the adjustment costs at the reel's current views, in rupees. */
  lostINR: number;
  reasons: CpmReason[];
  /** The lower rate applies past this many views. */
  afterViews: number;
  /** Net change made to money already credited for this reel. */
  walletChangeINR: number;
};

const paiseToINR = (paise: number) => Math.round(paise) / 100;

/** How a reel's CPM compares with its standard rate, or undefined when it isn't adjusted. */
export function reelCpm<P extends CpmPost>(post: P, plan: AccountPayoutPlan | undefined, gigRate: number): AdjustedReel<P> | undefined {
  if (!post.cpmAdjustment || !(gigRate > 0)) return undefined;
  const terms = postPayoutTerms(post, plan, gigRate);
  const standardRateINR = terms.standardRateINR ?? terms.rateINR;
  if (!terms.cpmAdjusted || !(standardRateINR > terms.rateINR)) return undefined;
  const views = Number.isSafeInteger(post.views) && post.views! >= 0 ? post.views! : 0;
  const lost = Number(cumulativePaise(views, { ...terms, rateINR: standardRateINR }) - cumulativePaise(views, terms));
  return { post, rateINR: terms.rateINR, standardRateINR, share: terms.rateINR / standardRateINR, views, lostINR: paiseToINR(lost), reasons: post.cpmAdjustment.reasons.filter(isReason), afterViews: terms.cpmAfterViews ?? 0, walletChangeINR: post.cpmAdjustment.walletChangeINR ?? 0 };
}

/**
 * The account's CPM picture: reels the team adjusted, the view-weighted CPM across them against the standard rate,
 * what that costs at current views, and which reasons come up most. Rejected reels are left out.
 */
export function cpmSummary<P extends CpmPost>(posts: readonly P[], plan: AccountPayoutPlan | undefined, gigRate: number) {
  const reels = posts.filter(post => post.status !== "rejected").map(post => reelCpm(post, plan, gigRate)).filter((reel): reel is AdjustedReel<P> => !!reel)
    .sort((a, b) => a.share - b.share || b.views - a.views);
  if (!reels.length) return undefined;
  const totalViews = reels.reduce((sum, reel) => sum + reel.views, 0);
  // Weighted by views so a big reel at a low CPM counts for more; a plain average until reels have views.
  const weigh = (pick: (reel: AdjustedReel<P>) => number) => totalViews
    ? reels.reduce((sum, reel) => sum + pick(reel) * reel.views, 0) / totalViews
    : reels.reduce((sum, reel) => sum + pick(reel), 0) / reels.length;
  const rateINR = Math.round(weigh(reel => reel.rateINR) * 100) / 100;
  const standardRateINR = Math.round(weigh(reel => reel.standardRateINR) * 100) / 100;
  const reasonCounts = new Map<CpmReason, number>();
  for (const reel of reels) for (const reason of reel.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  const reasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  return {
    reels,
    rateINR,
    standardRateINR,
    share: standardRateINR > 0 ? Math.min(1, rateINR / standardRateINR) : 1,
    dropPct: standardRateINR > 0 ? Math.max(0, (1 - rateINR / standardRateINR) * 100) : 0,
    lostINR: paiseToINR(reels.reduce((sum, reel) => sum + Math.round(reel.lostINR * 100), 0)),
    views: totalViews,
    reasons,
  };
}

/** Round, lower rates for the team to pick from: about 80%, 70%, 60%, 50% and 40% of the standard rate. */
export function cpmPresets(standardRateINR: number) {
  if (!(standardRateINR > 1)) return [];
  const values = [0.8, 0.7, 0.6, 0.5, 0.4].map(share => Math.max(1, Math.round(standardRateINR * share)));
  return [...new Set(values)].filter(value => value < standardRateINR);
}
