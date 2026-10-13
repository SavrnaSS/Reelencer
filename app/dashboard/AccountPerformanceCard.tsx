"use client";

import { useMemo, type ReactNode } from "react";
import { accountPlatformFor } from "@/lib/accountSetup";
import {
  STALE_AFTER_DAYS,
  averageViews,
  daysSinceSnapshot,
  engagementRate,
  followerEngagementRate,
  followerPace,
  formatChange,
  formatCompact,
  formatPct,
  metricChange,
  metricSeries,
  nextMilestone,
  postingCadence,
  reelEarnings,
  type LinkedSocialAccount,
  type SocialPost,
} from "@/lib/socialAnalytics";
import { Card, CardHeader, DAY_MS, Icon, LinkButton, Skeleton, cx, formatDate, formatRelative } from "./dashboardUi";
import { Sparkline } from "./MetricChart";
import PlatformGlyph from "./PlatformGlyph";

// Dashboard summary of the creator's linked social accounts: portfolio totals for the selected range, each
// account's share of reel views, one row per account and the most useful next step. Details live in "Accounts".

/* One-hue ordinal ramp for the view-share bar (darkest = biggest share). Always paired with a labelled legend. */
const SHARE_RAMP = ["#1f5131", "#2e7d4f", "#5a9e6f", "#8dbf98", "#bcdac2"];

type Props = {
  accounts: LinkedSocialAccount[];
  loading: boolean;
  error?: string;
  /** Selected dashboard range in days; null = all time. */
  rangeDays: number | null;
  rangeLabel: string;
  now: number;
  onOpen: () => void;
};

const postTime = (post: SocialPost) => Date.parse(post.postedAt ?? post.createdAt);
const counted = (posts: SocialPost[]) => posts.filter((post) => post.status !== "rejected");
const sumViews = (posts: SocialPost[]) => posts.reduce((sum, post) => sum + (typeof post.views === "number" ? post.views : 0), 0);

function summarize(account: LinkedSocialAccount, rangeDays: number | null, now: number) {
  const posts = counted(account.posts);
  const from = rangeDays ? now - rangeDays * DAY_MS : -Infinity;
  const previousFrom = rangeDays ? from - rangeDays * DAY_MS : -Infinity;
  const inRange = posts.filter((post) => postTime(post) >= from && postTime(post) <= now);
  const inPrevious = rangeDays ? posts.filter((post) => postTime(post) >= previousFrom && postTime(post) < from) : [];
  const followers = metricChange(account.snapshots, "followers");
  const latestWithReach = [...account.snapshots].reverse().find((snapshot) => engagementRate(snapshot) !== undefined);
  const rate = engagementRate(latestWithReach) ?? followerEngagementRate(account.posts, followers.value);
  const trend = metricSeries(account.snapshots, "followers", rangeDays ?? 0, now).map((point) => point.v);
  const top = [...posts].filter((post) => typeof post.views === "number").sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const pace = followerPace(account.snapshots, now);
  return {
    account,
    platform: accountPlatformFor(account.platform),
    followers,
    trend,
    rate,
    reels: inRange.length,
    views: sumViews(inRange),
    previousViews: sumViews(inPrevious),
    hasViews: inRange.some((post) => typeof post.views === "number"),
    pending: account.posts.filter((post) => post.status === "submitted").length,
    cadence: postingCadence(account.posts, now),
    earnings: reelEarnings(account),
    stale: daysSinceSnapshot(account.snapshots, now),
    milestone: nextMilestone(followers.value, pace, now),
    top,
    avgViews: averageViews(account.posts),
  };
}

type AccountSummary = ReturnType<typeof summarize>;

function Delta({ value, suffix = "%", title }: { value: number | null | undefined; suffix?: string; title?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.round(value) === 0) return null;
  const up = value > 0;
  return (
    <span title={title} className={cx("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums", up ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#fde4e1] text-[#8e1f1a]")}>
      {up ? <Icon.ArrowUp className="h-3 w-3" /> : <Icon.ArrowDown className="h-3 w-3" />}
      {suffix === "%" ? `${Math.abs(Math.round(value))}%` : formatChange(value).replace(/^[+−]/, "")}
    </span>
  );
}

function Stat({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#f7f8f6] px-3 py-2.5">
      <div className="truncate text-[11.5px] font-medium text-[#616a64]">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[19px] font-semibold leading-none tracking-[-0.01em] text-[#1a201c] tabular-nums">{value}</span>
        {delta}
      </div>
      {hint ? <div className="mt-1 truncate text-[11px] text-[#8a928c]">{hint}</div> : null}
    </div>
  );
}

function AccountRow({ row, share, color, onOpen }: { row: AccountSummary; share: number | null; color?: string; onOpen: () => void }) {
  const { account, platform, followers, earnings } = row;
  const paused = account.status !== "active";
  const stale = row.stale !== undefined && row.stale > STALE_AFTER_DAYS;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3 text-left transition hover:bg-[#fafbf9] focus-visible:bg-[#fafbf9] focus-visible:outline-none @[640px]/perf:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_16px] @[640px]/perf:px-5"
      >
        {/* Account */}
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,#1f2b24,#2e5a45)] text-white">
            <PlatformGlyph platform={platform} className="h-[18px] w-[18px]" />
            <span className={cx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white", paused ? "bg-[#d99a06]" : "bg-[#2e7d4f]")} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">@{account.handle}</span>
              {paused ? <span className="shrink-0 rounded-full bg-[#fdf0d2] px-1.5 py-px text-[10.5px] font-semibold text-[#6b4a05]">Paused</span> : null}
            </span>
            <span className="block truncate text-[11.5px] text-[#7a827c]">
              {platform.label}
              {account.gigTitle ? ` · ${account.gigTitle}` : ""}
            </span>
          </span>
        </span>

        {/* Compact layouts: headline number on the right */}
        <span className="flex items-center gap-2 @[640px]/perf:hidden">
          <span className="text-right">
            <span className="block text-[14px] font-semibold tabular-nums text-[#1a201c]">{formatCompact(followers.value)}</span>
            <span className="block text-[10.5px] text-[#8a928c]">followers</span>
          </span>
          <Icon.ChevronRight className="h-4 w-4 text-[#a3aaa4] transition group-hover:translate-x-0.5" />
        </span>
        <span className="col-span-2 grid grid-cols-3 gap-2 text-[11.5px] @[640px]/perf:hidden">
          <MiniStat label="Views" value={row.hasViews ? formatCompact(row.views) : "–"} />
          <MiniStat label="Engagement" value={formatPct(row.rate)} />
          <MiniStat label="Earned" value={earnings ? earnings.earned : "–"} />
        </span>

        {/* Wide layout: table-like columns */}
        <span className="hidden min-w-0 items-center gap-2 @[640px]/perf:flex">
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{formatCompact(followers.value)}</span>
            <span className="flex items-center gap-1 text-[11px] text-[#8a928c]">
              {followers.change ? (
                <span className={followers.change > 0 ? "text-[#1f5131]" : "text-[#8e1f1a]"}>{formatChange(followers.change)}</span>
              ) : (
                "followers"
              )}
            </span>
          </span>
          {row.trend.length > 1 ? <Sparkline values={row.trend} className="h-6 w-14 shrink-0" /> : null}
        </span>
        <span className="hidden min-w-0 @[640px]/perf:block">
          <span className="block text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{row.hasViews ? formatCompact(row.views) : "–"}</span>
          {share !== null ? (
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8a928c]">
              <span className="h-1.5 w-10 overflow-hidden rounded-full bg-[#eef0ed]" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(4, share * 100)}%`, background: color }} />
              </span>
              {Math.round(share * 100)}%
            </span>
          ) : (
            <span className="block text-[11px] text-[#8a928c]">{row.reels} {row.reels === 1 ? "reel" : "reels"}</span>
          )}
        </span>
        <span className="hidden min-w-0 @[640px]/perf:block">
          <span className="block text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{formatPct(row.rate)}</span>
          <span className="block text-[11px] text-[#8a928c]">{row.cadence.perWeek ? `${row.cadence.perWeek}/wk` : "no recent reels"}</span>
        </span>
        <span className="hidden min-w-0 @[640px]/perf:block">
          <span className="block truncate text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{earnings ? earnings.earned : "–"}</span>
          <span className={cx("block truncate text-[11px]", stale ? "text-[#9a5b00]" : "text-[#8a928c]")}>
            {stale ? `Stats ${row.stale}d old` : earnings && earnings.pendingAmount > 0 ? `+${earnings.pendingValue} pending` : row.pending ? `${row.pending} in review` : "approved"}
          </span>
        </span>
        <Icon.ChevronRight className="hidden h-4 w-4 text-[#a3aaa4] transition group-hover:translate-x-0.5 @[640px]/perf:block" />
      </button>
    </li>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded-md bg-[#f7f8f6] px-2 py-1.5">
      <span className="block truncate text-[10.5px] text-[#8a928c]">{label}</span>
      <span className="block truncate text-[12.5px] font-semibold tabular-nums text-[#1a201c]">{value}</span>
    </span>
  );
}

export default function AccountPerformanceCard({ accounts, loading, error, rangeDays, rangeLabel, now, onOpen }: Props) {
  const rows = useMemo(
    () =>
      accounts
        .filter((account) => account.status !== "unlinked")
        .map((account) => summarize(account, rangeDays, now))
        .sort((a, b) => b.views - a.views || (b.followers.value ?? 0) - (a.followers.value ?? 0)),
    [accounts, rangeDays, now]
  );

  const totals = useMemo(() => {
    const followerValues = rows.filter((row) => row.followers.value !== undefined);
    const changes = rows.filter((row) => row.followers.change !== undefined);
    const rates = rows.map((row) => row.rate).filter((rate): rate is number => rate !== undefined);
    const views = rows.reduce((sum, row) => sum + row.views, 0);
    const previousViews = rows.reduce((sum, row) => sum + row.previousViews, 0);
    return {
      followers: followerValues.length ? followerValues.reduce((sum, row) => sum + (row.followers.value ?? 0), 0) : undefined,
      followerChange: changes.length ? changes.reduce((sum, row) => sum + (row.followers.change ?? 0), 0) : undefined,
      views,
      hasViews: rows.some((row) => row.hasViews),
      viewsDelta: rangeDays && previousViews > 0 ? ((views - previousViews) / previousViews) * 100 : null,
      rate: rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : undefined,
      reels: rows.reduce((sum, row) => sum + row.reels, 0),
      pending: rows.reduce((sum, row) => sum + row.pending, 0),
      perWeek: Math.round(rows.reduce((sum, row) => sum + row.cadence.perWeek, 0) * 10) / 10,
      lastUpdate: rows
        .flatMap((row) => row.account.snapshots.map((snapshot) => snapshot.capturedAt))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0],
    };
  }, [rows, rangeDays]);

  // View share only means something with 2+ accounts that actually have views in range.
  const shares = rows.length > 1 && totals.views > 0 ? rows.map((row) => row.views / totals.views) : null;

  // The single most useful thing to know right now, in priority order.
  const insight = useMemo(() => {
    const active = rows.filter((row) => row.account.status === "active");
    const stale = active.find((row) => row.stale !== undefined && row.stale > STALE_AFTER_DAYS);
    const quiet = active.find((row) => row.account.posts.length > 0 && row.cadence.last7 === 0);
    const leader = shares && shares[0] >= 0.5 && rows[0].views > 0 ? rows[0] : null;
    const close = rows.find((row) => row.milestone?.eta && row.milestone.percent >= 70);
    const breakout = rows.find((row) => row.top && row.avgViews && (row.top.views ?? 0) > row.avgViews * 2 && (!rangeDays || postTime(row.top) >= now - rangeDays * DAY_MS));
    if (quiet) return { tone: "warn" as const, text: `@${quiet.account.handle} hasn't posted in 7 days. Regular reels keep reach up.` };
    if (stale) return { tone: "warn" as const, text: `Stats for @${stale.account.handle} are ${stale.stale} days old. Refresh them in Accounts.` };
    if (leader) return { tone: "good" as const, text: `@${leader.account.handle} drove ${Math.round(shares![0] * 100)}% of your reel views, ${rangeLabel.toLowerCase()}.` };
    if (breakout?.top) return { tone: "good" as const, text: `A reel on @${breakout.account.handle} hit ${formatCompact(breakout.top.views)} views, over 2× its average. Reuse its hook.` };
    if (close?.milestone) return { tone: "good" as const, text: `@${close.account.handle} is ${close.milestone.percent}% of the way to ${formatCompact(close.milestone.target)} followers, around ${formatDate(close.milestone.eta)} at this pace.` };
    return null;
  }, [rows, shares, rangeDays, rangeLabel, now]);

  // Nothing linked yet: the setup guide and jobs cover that, so stay out of the way.
  if (!loading && !error && rows.length === 0) return null;

  return (
    <Card aria-labelledby="overview-accounts" className="@container/perf overflow-hidden">
      <CardHeader
        id="overview-accounts"
        title="Account performance"
        description={
          loading
            ? "Loading your linked accounts…"
            : error && !rows.length
              ? "Account stats are unavailable right now"
              : `${rows.length} linked ${rows.length === 1 ? "account" : "accounts"} · ${rangeLabel}${totals.lastUpdate ? ` · stats ${formatRelative(totals.lastUpdate)}` : ""}`
        }
        action={<LinkButton onClick={onOpen}>View accounts</LinkButton>}
      />

      {loading && !rows.length ? (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 @[560px]/perf:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[68px]" />
            ))}
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error && !rows.length ? (
        <p className="px-4 pb-4 pt-2 text-[12.5px] text-[#8e1f1a] sm:px-5">{error}</p>
      ) : (
        <>
          {/* Portfolio totals */}
          <div className="grid grid-cols-2 gap-2 px-4 pt-3 @[560px]/perf:grid-cols-4 sm:px-5">
            <Stat
              label="Followers"
              value={formatCompact(totals.followers)}
              hint={totals.followerChange !== undefined ? "since last check-in" : "across accounts"}
              delta={<Delta value={totals.followerChange} suffix="" title="Since the previous check-in" />}
            />
            <Stat
              label="Reel views"
              value={totals.hasViews ? formatCompact(totals.views) : "–"}
              hint={rangeDays ? `reels posted, ${rangeLabel.toLowerCase()}` : "all reels"}
              delta={<Delta value={totals.viewsDelta} title="Compared with the previous period" />}
            />
            <Stat label="Engagement" value={formatPct(totals.rate)} hint={rows.length > 1 ? "average across accounts" : "interaction rate"} />
            <Stat label="Reels" value={String(totals.reels)} hint={totals.pending ? `${totals.pending} in review` : totals.perWeek ? `${totals.perWeek} per week` : "in period"} />
          </div>

          {/* Share of views */}
          {shares ? (
            <div className="px-4 pt-3 sm:px-5">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#eef0ed]" role="img" aria-label={`Share of reel views: ${rows.map((row, index) => `@${row.account.handle} ${Math.round(shares[index] * 100)}%`).join(", ")}`}>
                {rows.map((row, index) =>
                  shares[index] > 0 ? <span key={row.account.id} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${shares[index] * 100}%`, background: SHARE_RAMP[Math.min(index, SHARE_RAMP.length - 1)] }} /> : null
                )}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#616a64]" aria-hidden="true">
                {rows.slice(0, 5).map((row, index) => (
                  <li key={row.account.id} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[2px]" style={{ background: SHARE_RAMP[Math.min(index, SHARE_RAMP.length - 1)] }} />@{row.account.handle}
                    <span className="font-semibold tabular-nums text-[#1a201c]">{Math.round(shares[index] * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {insight ? (
            <div className={cx("mx-4 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] sm:mx-5", insight.tone === "warn" ? "bg-[#fdf8ec] text-[#5f4a1c]" : "bg-[#f4f9f2] text-[#1f5131]")}>
              <span className="mt-0.5 shrink-0" aria-hidden="true">{insight.tone === "warn" ? "!" : "↗"}</span>
              <span className="min-w-0">{insight.text}</span>
            </div>
          ) : null}

          {/* Per-account rows */}
          <div className="mt-3 border-t border-[#ebedea]">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_16px] gap-x-3 bg-[#fafbf9] px-5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a928c] @[640px]/perf:grid">
              <span>Account</span>
              <span>Followers</span>
              <span>Views</span>
              <span>Engagement</span>
              <span>Earned</span>
              <span />
            </div>
            <ul className="divide-y divide-[#f2f3f1]">
              {rows.map((row, index) => (
                <AccountRow key={row.account.id} row={row} share={shares ? shares[index] : null} color={SHARE_RAMP[Math.min(index, SHARE_RAMP.length - 1)]} onOpen={onOpen} />
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}
