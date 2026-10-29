import { formatAmount } from "./money";
import { countedReels } from "./reelTracking";

// Linked social accounts (Content Posting gigs): the account a creator made, verified in screening, then linked to
// their profile. Insights arrive as dated snapshots (recorded by the team from the platform's insights, or synced
// from an API later) plus per-reel results. Pure module: shared by the creator dashboard, admin console and tests.

export type SocialAccountStatus = "active" | "paused" | "unlinked";

export type SocialSnapshot = {
  id: string;
  capturedAt: string;
  /** Days covered by the period metrics (reach, impressions, profile views, engagements, link clicks). */
  periodDays: number;
  followers?: number;
  following?: number;
  posts?: number;
  reach?: number;
  impressions?: number;
  profileViews?: number;
  engagements?: number;
  linkClicks?: number;
  /** "screenshot": read from uploaded insight screenshots by the AI screenshot reader. */
  source: "manual" | "api" | "screenshot" | "profile";
  note?: string;
};

export type SocialPost = {
  id: string;
  url: string;
  caption?: string;
  postedAt?: string;
  views?: number;
  /** Last time this view count was measured; independent of other metric updates. */
  viewsCapturedAt?: string;
  viewsSource?: SocialPost["source"];
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  updatedAt: string;
  /** Creator-submitted reels wait for review; only approved reels count towards pay. */
  status: SocialPostStatus;
  submittedByWorker: boolean;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
  /** "api": found on the account by the automatic sync (numbers refresh by themselves). */
  source: "manual" | "api" | "screenshot" | "profile";
  /** Removed by the team: kept only so it can't come back; never shown to creators or counted. Admins only. */
  removedAt?: string;
  removalReason?: string;
  /** Removed silently: the creator was never told (no email, no live update, a neutral answer on resubmitting). */
  removedSilently?: boolean;
};

export type SocialPostStatus = "submitted" | "approved" | "rejected";

/** Total only measured eligible reels. Missing counts and actual zero stay distinct. */
export function reelViewSummary(posts: SocialPost[]) {
  const eligible = posts.filter((post) => post.status !== "rejected");
  const measured = eligible.filter((post) => typeof post.views === "number" && Number.isSafeInteger(post.views) && post.views >= 0);
  const total = measured.length ? measured.reduce((sum, post) => sum + (post.views ?? 0), 0) : undefined;
  const dates = measured.map((post) => post.viewsCapturedAt).filter((date): date is string => !!date && Number.isFinite(Date.parse(date))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { total, measured: measured.length, missing: eligible.length - measured.length, average: total !== undefined ? total / measured.length : undefined, oldestCapturedAt: dates.length === measured.length ? dates[0] : undefined };
}

/**
 * Automatic stats sync. `available`: the platform has a configured reader (YouTube API or public Instagram profile); otherwise numbers come from the team's check-ins.
 */
export type SyncState = {
  available: boolean;
  status: "pending" | "ok" | "error" | "unsupported" | "not_configured";
  lastSyncedAt?: string;
  lastAttemptAt?: string;
  nextSyncAt?: string;
  inProgress?: boolean;
  consecutiveFailures?: number;
  provider?: "profile" | "meta" | "youtube";
  errorCode?: import("./socialSyncSchedule").SyncErrorCode;
  error?: string;
};

/** Minimum gap between syncs a person can trigger, and how stale data gets before it refreshes on page load. */
export const SYNC_COOLDOWN_MINUTES = 1;
export const SYNC_STALE_HOURS = 3;

/**
 * Stable post id from any link form, so synced posts match the reels creators submitted:
 * instagram.com/reel/CODE, /p/CODE, /reels/CODE → CODE; youtube.com/shorts/ID, watch?v=ID, youtu.be/ID → ID.
 */
export function externalPostId(url: string) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "instagram.com") {
      const i = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
      return i >= 0 && parts[i + 1] ? `ig:${parts[i + 1]}` : undefined;
    }
    if (host === "youtu.be") return parts[0] ? `yt:${parts[0]}` : undefined;
    if (host === "youtube.com") {
      if (parts[0] === "shorts" && parts[1]) return `yt:${parts[1]}`;
      const v = u.searchParams.get("v");
      return v ? `yt:${v}` : undefined;
    }
  } catch {
    // not a URL
  }
  return undefined;
}

/** One Instagram reel identity regardless of share parameters, mobile host or permalink form. */
export function canonicalInstagramReelUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/(?:reel|reels|p)\/([\w-]{1,100})\/?$/);
    return match ? `https://www.instagram.com/reel/${match[1]}/` : undefined;
  } catch { return undefined; }
}

export type LinkedSocialAccount = {
  id: string;
  applicationId: string;
  gigId: string;
  gigTitle?: string;
  company?: string;
  workerCode: string;
  platform: string;
  handle: string;
  profileUrl: string;
  status: SocialAccountStatus;
  profileHealth?: import("./accountProfileHealth").AccountProfileHealth;
  linkedAt: string;
  /** The gig's listed payout ("₹2,800") and how it's paid ("Per post"), for the earnings estimate. */
  payout?: string;
  payoutType?: string;
  sync: SyncState;
  /** Oldest first. */
  snapshots: SocialSnapshot[];
  /** Newest first. */
  posts: SocialPost[];
};

export type SnapshotMetric = "followers" | "following" | "reach" | "impressions" | "profileViews" | "engagements" | "linkClicks" | "posts";

export const SNAPSHOT_FIELDS: { key: SnapshotMetric; label: string; period: boolean }[] = [
  { key: "followers", label: "Followers", period: false },
  { key: "following", label: "Following", period: false },
  { key: "posts", label: "Posts", period: false },
  { key: "reach", label: "Accounts reached", period: true },
  { key: "impressions", label: "Impressions / views", period: true },
  { key: "profileViews", label: "Profile visits", period: true },
  { key: "engagements", label: "Interactions", period: true },
  { key: "linkClicks", label: "Link taps", period: true },
];

const byTime = (a: { capturedAt: string }, b: { capturedAt: string }) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Latest snapshot that actually has `key`, and the one before it (for "+12% since last check-in"). */
export function metricChange(snapshots: SocialSnapshot[], key: SnapshotMetric) {
  const withValue = snapshots.filter((s) => validCount(s[key]) && Number.isFinite(Date.parse(s.capturedAt))).sort(byTime);
  const current = withValue.at(-1);
  const previous = withValue.at(-2);
  const value = current?.[key];
  const before = previous?.[key];
  const change = typeof value === "number" && typeof before === "number" ? value - before : undefined;
  const pct = change !== undefined && before ? (change / before) * 100 : undefined;
  return { value, previous: before, change, pct, capturedAt: current?.capturedAt };
}

/** Interactions per account reached, as a percentage. */
export function engagementRate(snapshot?: Pick<SocialSnapshot, "engagements" | "reach">) {
  if (!snapshot?.reach || snapshot.engagements === undefined) return undefined;
  return (snapshot.engagements / snapshot.reach) * 100;
}

export const postInteractions = (post: SocialPost) => (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0) + (post.saves ?? 0);

/** Interactions over reach (or views when reach wasn't recorded). */
export function postEngagementRate(post: SocialPost) {
  const base = post.reach || post.views;
  return base ? (postInteractions(post) / base) * 100 : undefined;
}

export type SeriesPoint = { t: number; v: number; capturedAt: string };

/** Chart points for one metric inside the last `rangeDays` (0 = all time), oldest first. */
export function metricSeries(snapshots: SocialSnapshot[], key: SnapshotMetric, rangeDays: number, now = Date.now()): SeriesPoint[] {
  const from = rangeDays > 0 ? now - rangeDays * 86_400_000 : -Infinity;
  return snapshots
    .filter((s) => typeof s[key] === "number" && Date.parse(s.capturedAt) >= from)
    .sort(byTime)
    .map((s) => ({ t: Date.parse(s.capturedAt), v: s[key] as number, capturedAt: s.capturedAt }));
}

/** Days since the last check-in (undefined when there has never been one). */
export function daysSinceSnapshot(snapshots: SocialSnapshot[], now = Date.now()) {
  const last = [...snapshots].sort(byTime).at(-1);
  return last ? Math.floor((now - Date.parse(last.capturedAt)) / 86_400_000) : undefined;
}

/** Accounts without a check-in for this long are flagged to the team. */
export const STALE_AFTER_DAYS = 7;

export function formatCompact(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  const fmt = (n: number, suffix: string) => `${(Math.round(n * 10) / 10).toString().replace(/\.0$/, "")}${suffix}`;
  if (abs >= 1_000_000_000) return fmt(value / 1_000_000_000, "B");
  if (abs >= 1_000_000) return fmt(value / 1_000_000, "M");
  if (abs >= 10_000) return fmt(value / 1_000, "K");
  return Math.round(value).toLocaleString("en-US");
}

export function formatPct(value?: number, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return "–";
  return `${value.toFixed(digits).replace(/\.0+$/, "")}%`;
}

/** Signed change label: "+1.2K", "−340", "0". */
export function formatChange(value?: number) {
  if (value === undefined) return "";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatCompact(Math.abs(value))}`;
}

/** Parses a number typed by an admin ("12,400", "12.4k", "1.2M", ""), or undefined when empty/invalid. */
export function parseMetricInput(raw: string): number | undefined {
  const value = raw.trim().toLowerCase().replace(/[,\s_]/g, "");
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)([km]?)$/.exec(value);
  if (!match) return undefined;
  const n = Number(match[1]) * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1);
  return Number.isFinite(n) && n <= 2_000_000_000 ? Math.round(n) : undefined;
}

/* ------------------------------------------------------------------ */
/* Forward-looking insights                                            */
/* ------------------------------------------------------------------ */

const WEEK = 7 * 86_400_000;
const countedPosts = (posts: SocialPost[]) => posts.filter((p) => p.status !== "rejected");

/** Reels posted in the last 7 and 30 days, and the weekly average over the last 4 weeks. */
export function postingCadence(posts: SocialPost[], now = Date.now()) {
  const times = countedPosts(posts)
    .map((p) => Date.parse(p.postedAt ?? p.createdAt))
    .filter((t) => Number.isFinite(t) && t <= now);
  const within = (ms: number) => times.filter((t) => now - t <= ms).length;
  const last30 = within(30 * 86_400_000);
  return { last7: within(WEEK), last30, perWeek: Math.round((within(4 * WEEK) / 4) * 10) / 10 };
}

/** Average views per counted reel (reels without a view count are skipped). */
export function averageViews(posts: SocialPost[]) {
  const withViews = countedPosts(posts).filter((p) => typeof p.views === "number");
  return withViews.length ? withViews.reduce((sum, p) => sum + (p.views ?? 0), 0) / withViews.length : undefined;
}

/**
 * Follower growth per week from a least-squares fit over the last `windowDays` of check-ins, so one odd reading
 * doesn't swing the projection. Needs at least two check-ins at least two days apart.
 */
export function followerPace(snapshots: SocialSnapshot[], now = Date.now(), windowDays = 60) {
  const points = snapshots
    .filter((s) => validCount(s.followers) && Date.parse(s.capturedAt) <= now && now - Date.parse(s.capturedAt) <= windowDays * 86_400_000)
    .map((s) => ({ x: Date.parse(s.capturedAt) / WEEK, y: s.followers as number }));
  if (points.length < 2) return undefined;
  const spanDays = ((Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))) * WEEK) / 86_400_000;
  if (spanDays < 2) return undefined;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den ? num / den : undefined;
}

const MILESTONES = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Next follower milestone and when the current pace reaches it (only when growing and within ~a year). */
export function nextMilestone(followers: number | undefined, perWeek: number | undefined, now = Date.now()) {
  if (!validCount(followers)) return undefined;
  // Continue the same 1 / 2.5 / 5 ladder for large accounts.
  const scale = followers >= 1_000_000 ? 10 ** Math.floor(Math.log10(followers)) : undefined;
  const target = scale
    ? [1, 2.5, 5, 10].map((step) => step * scale).find((m) => Number.isSafeInteger(m) && m > followers)
    : MILESTONES.find((m) => m > followers);
  if (!target) return undefined;
  const remaining = target - followers;
  const progress = followers / target;
  // Do not announce 100% while followers are still short of the target.
  const percent = Math.min(99, Math.round(progress * 100));
  const milestone = { target, remaining, progress, percent, eta: undefined as string | undefined };
  if (perWeek === undefined || !Number.isFinite(perWeek) || perWeek <= 0 || !Number.isFinite(now)) return milestone;
  const weeks = (target - followers) / perWeek;
  const arrival = new Date(now + weeks * WEEK);
  return { ...milestone, eta: weeks <= 52 && Number.isFinite(arrival.getTime()) ? arrival.toISOString() : undefined };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday whose reels average the most views. Needs 4+ dated reels on 2+ different days, and a clear lead. */
export function bestPostingDay(posts: SocialPost[]) {
  const byDay = new Map<number, number[]>();
  for (const p of countedPosts(posts)) {
    if (!p.postedAt || typeof p.views !== "number") continue;
    const day = new Date(p.postedAt).getDay();
    byDay.set(day, [...(byDay.get(day) ?? []), p.views]);
  }
  const total = [...byDay.values()].reduce((a, v) => a + v.length, 0);
  if (total < 4 || byDay.size < 2) return undefined;
  const averages = [...byDay.entries()].map(([day, views]) => ({ day, avg: views.reduce((a, v) => a + v, 0) / views.length })).sort((a, b) => b.avg - a.avg);
  const overall = [...byDay.values()].flat().reduce((a, v) => a + v, 0) / total;
  if (averages[0].avg < overall * 1.15) return undefined;
  return { day: WEEKDAYS[averages[0].day], lift: averages[0].avg / overall };
}

/** "₹2,800" → { amount: 2800, symbol: "₹" }; undefined for ranges or text. */
export function parsePayoutAmount(payout?: string) {
  const match = /^\s*([^\d\s]*)\s*([\d,]+(?:\.\d+)?)\s*$/.exec(String(payout ?? ""));
  if (!match) return undefined;
  const amount = Number(match[2].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? { amount, symbol: match[1] || "" } : undefined;
}

/** View-based rates must be a single positive amount with at most two decimal places. */
export function isValidViewPayoutRate(payout?: string): boolean {
  const rate = parsePayoutAmount(payout);
  return !!rate && Number.isSafeInteger(Math.round(rate.amount * 100)) && /^(?:(?:[₹$€£¥]|INR|USD|EUR|GBP)\s*)?(?:\d+|\d{1,3}(?:,\d{2,3})+)(?:\.\d{1,2})?$/.test(String(payout ?? "").trim());
}

/** Reel earnings estimates: approved results and pending review stay separate; view rates are prorated and rounded to cents. */
/** Reels posted before the account was linked never earn, so they're left out when `linkedAt` is known. */
export function reelEarnings(account: Pick<LinkedSocialAccount, "posts" | "payout" | "payoutType"> & { linkedAt?: string }) {
  const type = String(account.payoutType ?? "").trim().toLowerCase();
  if (type !== "per post" && type !== "per 1k views") return undefined;
  const rate = parsePayoutAmount(account.payout);
  if (!rate) return undefined;
  const posts = countedReels(account.posts, account.linkedAt);
  const approved = posts.filter((p) => p.status === "approved").length;
  const pending = posts.filter((p) => p.status === "submitted").length;
  const money = (n: number) => formatAmount(n, rate.symbol);
  if (type === "per 1k views") {
    if (!isValidViewPayoutRate(account.payout)) return undefined;
    const measured = (status: SocialPostStatus) => posts.filter((post) => post.status === status && typeof post.views === "number" && Number.isSafeInteger(post.views) && post.views >= 0);
    const approvedPosts = measured("approved");
    const pendingPosts = measured("submitted");
    const approvedViews = approvedPosts.reduce((sum, post) => sum + (post.views ?? 0), 0);
    const pendingViews = pendingPosts.reduce((sum, post) => sum + (post.views ?? 0), 0);
    const amountFor = (views: number) => Number((BigInt(views) * BigInt(Math.round(rate.amount * 100)) + BigInt(500)) / BigInt(1000)) / 100;
    return { approved, pending, basis: "views" as const, approvedViews, pendingViews,
      unmeasuredApproved: approved - approvedPosts.length, unmeasuredPending: pending - pendingPosts.length,
      rateAmount: rate.amount, symbol: rate.symbol, approvedAmount: amountFor(approvedViews), pendingAmount: amountFor(pendingViews),
      rate: money(rate.amount), earned: money(amountFor(approvedViews)), pendingValue: money(amountFor(pendingViews)) };
  }
  const approvedAmount = Math.round(approved * rate.amount * 100) / 100;
  const pendingAmount = Math.round(pending * rate.amount * 100) / 100;
  return { approved, pending, rateAmount: rate.amount, symbol: rate.symbol, approvedAmount, pendingAmount,
    rate: money(rate.amount), earned: money(approvedAmount), pendingValue: money(pendingAmount) };
}

/**
 * Engagement when reach isn't available (API syncs): average interactions on the latest reels as a share of
 * followers, the common "engagement rate by followers".
 */
export function followerEngagementRate(posts: SocialPost[], followers?: number, sample = 12) {
  if (!followers) return undefined;
  const recent = posts
    .filter((p) => p.status !== "rejected" && (p.likes !== undefined || p.comments !== undefined))
    .sort((a, b) => Date.parse(b.postedAt ?? b.createdAt) - Date.parse(a.postedAt ?? a.createdAt))
    .slice(0, sample);
  if (!recent.length) return undefined;
  return (recent.reduce((sum, p) => sum + postInteractions(p), 0) / recent.length / followers) * 100;
}
