"use client";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import ViewPayoutClaims from "@/app/_components/ViewPayoutClaims";
import SocialSyncStatus from "@/app/_components/SocialSyncStatus";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { accountPlatformFor, isPlatformProfileUrl, payoutPhrase } from "@/lib/accountSetup";
import type { SocialAccountsState } from "@/lib/useSocialAccounts";
import { trackingStartInput } from "@/lib/reelTracking";
import {
  STALE_AFTER_DAYS,
  averageViews,
  canonicalInstagramReelUrl,
  bestPostingDay,
  daysSinceSnapshot,
  followerEngagementRate,
  engagementRate,
  formatChange,
  formatCompact,
  formatPct,
  metricChange,
  metricSeries,
  nextMilestone,
  followerPace,
  postEngagementRate,
  postingCadence,
  reelEarnings,
  reelViewSummary,
  postInteractions,
  type LinkedSocialAccount,
  type SnapshotMetric,
  type SocialPost,
} from "@/lib/socialAnalytics";
import { Button, Icon as UiIcon, Skeleton, cx, formatDate, formatRelative } from "./dashboardUi";
import MetricChart, { Sparkline } from "./MetricChart";
import PlatformGlyph from "./PlatformGlyph";
import ScreenshotImport from "./ScreenshotImport";
import ReelEarningsSummary from "./ReelEarningsSummary";
import AddAccountsPanel, { AccountsRail, AddAccountSheet, useAccountRequests, type SheetMode } from "./AddAccountsPanel";
import LinkedAccountRecovery from "./LinkedAccountRecovery";
import ViewMilestoneCard from "./ViewMilestoneCard";

// "Accounts": the social accounts linked to the creator after Content Posting screening, with their reach, growth
// and per-reel results. Numbers come from the team's insight check-ins (see lib/socialAnalytics).

const RANGES = [
  { id: 7, label: "7D" },
  { id: 30, label: "30D" },
  { id: 90, label: "90D" },
  { id: 0, label: "All" },
] as const;

const CHART_METRICS: { key: SnapshotMetric; label: string; zeroBased: boolean }[] = [
  { key: "followers", label: "Followers", zeroBased: false },
  { key: "reach", label: "Reach", zeroBased: true },
  { key: "impressions", label: "Views", zeroBased: true },
  { key: "engagements", label: "Interactions", zeroBased: true },
  { key: "profileViews", label: "Profile visits", zeroBased: true },
];

function Delta({ change, pct, invert = false, label }: { change?: number; pct?: number; invert?: boolean; /** Overrides the formatted change (e.g. "+0.6 pts"). */ label?: string }) {
  if (change === undefined) return null;
  const up = change > 0;
  const good = invert ? !up : up;
  if (change === 0) return <span className="rounded-full bg-[#eef0ed] px-1.5 py-px text-[11px] font-semibold text-[#616a64]">No change</span>;
  return (
    <span
      className={cx("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums", good ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#fde4e1] text-[#8e1f1a]")}
      title="Since the previous check-in"
    >
      {up ? <UiIcon.ArrowUp className="h-3 w-3" /> : <UiIcon.ArrowDown className="h-3 w-3" />}
      {label ?? formatChange(change)}
      {pct !== undefined && Number.isFinite(pct) ? <span className="font-medium opacity-80">({formatPct(Math.abs(pct))})</span> : null}
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  change,
  pct,
  changeLabel,
  trend,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  change?: number;
  pct?: number;
  changeLabel?: string;
  trend?: number[];
  emphasis?: boolean;
}) {
  return (
    <div className={cx("flex min-w-0 flex-col justify-between gap-2 rounded-xl border p-3.5 sm:p-4", emphasis ? "border-[#cfe3d4] bg-[#f4f9f2]" : "border-[#ebedea] bg-white")}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-[#616a64]">{label}</span>
        {trend ? <Sparkline values={trend} className="h-6 w-14 shrink-0 sm:w-16" /> : null}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[22px] font-semibold leading-none tracking-tight text-[#1a201c] tabular-nums sm:text-[24px]">{value}</div>
        <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1.5">
          <Delta change={change} pct={pct} label={changeLabel} />
          {hint ? <span className="text-[11px] text-[#8a928c]">{hint}</span> : null}
        </div>
      </div>
    </div>
  );
}

const REVIEW_CHIP: Record<SocialPost["status"], { label: string; className: string }> = {
  submitted: { label: "Awaiting review", className: "bg-[#fdf0d2] text-[#6b4a05]" },
  approved: { label: "Approved", className: "bg-[#e3f1df] text-[#1f5131]" },
  rejected: { label: "Not approved", className: "bg-[#fde4e1] text-[#8e1f1a]" },
};

type ReelPerformance = { score: number; avgScore: number; maxScore: number; metricLabel: string };

/** "+42% vs avg" when there are enough reels to compare against. */
function VsAverage({ score, avgScore }: { score: number; avgScore: number }) {
  if (!avgScore || !score) return null;
  const pct = (score / avgScore - 1) * 100;
  if (Math.abs(pct) < 5) return <span className="rounded-full bg-[#eef0ed] px-1.5 py-px text-[10.5px] font-semibold text-[#616a64]">At average</span>;
  return (
    <span className={cx("rounded-full px-1.5 py-px text-[10.5px] font-semibold tabular-nums", pct > 0 ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#fde4e1] text-[#8e1f1a]")}>
      {pct > 0 ? "+" : "−"}
      {Math.round(Math.abs(pct))}% vs avg
    </span>
  );
}

type Insight = { kind: "growth" | "reel" | "engagement" | "pace" | "day" | "posting"; title: string; text: string; tone: "good" | "warn" | "neutral" };

const INSIGHT_ICON: Record<Insight["kind"], string> = {
  growth: "M4 14l4-4 3 3 5-6M12 7h4v4",
  reel: "M5 4.5h10v11H5zM8.5 8l3.5 2-3.5 2z",
  engagement: "M10 16s-5.5-3.3-5.5-7.2A3 3 0 0 1 10 7a3 3 0 0 1 5.5 1.8C15.5 12.7 10 16 10 16z",
  pace: "M10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 7v3l2 1.5",
  day: "M4.5 5.5h11v10h-11zM4.5 8.5h11M7.5 4v3M12.5 4v3",
  posting: "M10 5v5M10 13.5v.5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z",
};
const INSIGHT_TONE: Record<Insight["tone"], { card: string; icon: string }> = {
  good: { card: "bg-[#f4f9f2] ring-[#e1eedc]", icon: "bg-white text-[#2e7d4f] ring-[#cfe3d4]" },
  warn: { card: "bg-[#fdf8ec] ring-[#f3e6c4]", icon: "bg-white text-[#9a5b00] ring-[#f0dcae]" },
  neutral: { card: "bg-[#f7f8f6] ring-[#ebedea]", icon: "bg-white text-[#4b544e] ring-[#e3e5e1]" },
};

/** Numbers ("448", "7.0×", "4.6%", "1–3%") in bold so each insight scans at a glance. */
function emphasizeNumbers(text: string) {
  return text.split(/(\d[\d,.]*(?:[–-]\d[\d,.]*)?\s?[×%KMB]?)/g).map((part, i) =>
    i % 2 ? (
      <strong key={i} className="font-semibold text-[#1a201c]">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

function InsightCard({ item }: { item: Insight }) {
  const tone = INSIGHT_TONE[item.tone];
  return (
    <li className={cx("flex items-start gap-3 rounded-xl p-3 ring-1 ring-inset", tone.card)}>
      <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", tone.icon)}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <path d={INSIGHT_ICON[item.kind]} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-[#3b443e]">{item.title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-5 text-[#4b544e]">{emphasizeNumbers(item.text)}</span>
      </span>
    </li>
  );
}

/** "Comment CLAUDE for the guide! #ai #sidehustle" → title without hashtags + the tags (shown separately, muted). */
function splitCaption(caption?: string) {
  const raw = String(caption ?? "").trim();
  const tags = [...new Set((raw.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()))];
  const title = raw.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s{2,}/g, " ").replace(/[\s·|,-]+$/, "").trim();
  return { title: title || (tags.length ? tags.slice(0, 2).join(" ") : "Untitled reel"), tags };
}

function PostRow({
  post,
  rank,
  best,
  performance,
  onWithdraw,
  onScreenshot,
  importSlot,
}: {
  post: SocialPost;
  /** Performance rank among reels with results; none while waiting for numbers. */
  rank?: number;
  best: boolean;
  performance: ReelPerformance;
  onWithdraw?: () => Promise<void>;
  /** Opens the screenshot reader for this reel's insights. */
  onScreenshot?: () => void;
  importSlot?: ReactNode;
}) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const rate = postEngagementRate(post);
  // Only what the platform reports for this reel (synced Instagram posts: likes and comments).
  const stats = [
    { label: "Views", value: post.views },
    { label: "Reach", value: post.reach },
    { label: "Likes", value: post.likes },
    { label: "Comments", value: post.comments },
    { label: "Shares", value: post.shares },
    { label: "Saves", value: post.saves },
  ].filter((stat) => stat.label === "Views" || stat.value !== undefined);
  const chip = post.status !== "approved" ? REVIEW_CHIP[post.status] : null;
  const share = performance.maxScore ? performance.score / performance.maxScore : 0;
  const headline = performance.metricLabel === "views" ? post.views : performance.metricLabel === "reached" ? post.reach
    : stats.some(stat => stat.value !== undefined) ? postInteractions(post) : undefined;
  const caption = splitCaption(post.caption);

  return (
    <li
      className={cx(
        "flex flex-col rounded-2xl border bg-white p-3.5 transition hover:shadow-[0_6px_20px_-12px_rgba(26,32,28,0.3)] sm:p-4",
        post.status === "rejected" ? "border-[#f3d3cf]" : best ? "border-[#cfe3d4]" : "border-[#ebedea]"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cx(
            "mt-0.5 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums",
            !rank ? "bg-[#f1f3f0] text-[#9aa29c]" : best ? "bg-[#f5c451] text-[#3d2c00]" : "bg-[#eef1ed] text-[#2b5d4a]"
          )}
          aria-label={rank ? `Rank ${rank}` : "Not ranked yet"}
        >
          {rank ?? "–"}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            title={post.caption || undefined}
            className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-[#1a201c] underline-offset-2 hover:underline"
          >
            {caption.title}
            <UiIcon.External className="ml-1 inline h-3 w-3 -translate-y-px text-[#9aa29c]" />
          </a>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-[#7a827c]">
            <span>{post.postedAt ? formatDate(post.postedAt) : "Date not recorded"}</span>
            <span aria-hidden="true">·</span>
            <span>{post.status === "submitted" ? `${!post.submittedByWorker && (post.source === "profile" || post.source === "api") ? "found" : "sent"} ${formatRelative(post.createdAt)}` : `updated ${formatRelative(post.updatedAt)}`}</span>
          </div>
          {caption.tags.length ? (
            <p className="mt-1 truncate text-[11px] text-[#8a928c]" title={caption.tags.join(" ")}>
              {caption.tags.slice(0, 3).join(" ")}
              {caption.tags.length > 3 ? ` +${caption.tags.length - 3}` : ""}
            </p>
          ) : null}
        </div>
        {headline !== undefined ? (
          <div className="shrink-0 text-right">
            <div className="text-[18px] font-semibold leading-none tabular-nums text-[#1a201c]">{formatCompact(headline)}</div>
            <div className="mt-1 text-[10.5px] text-[#7a827c]">{performance.metricLabel}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {best ? <span className="rounded-full bg-[#fdf0d2] px-1.5 py-px text-[10.5px] font-semibold text-[#6b4a05]">Top reel</span> : null}
        <VsAverage score={performance.score} avgScore={performance.avgScore} />
        {!post.submittedByWorker && (post.source === "api" || post.source === "profile") ? <span className="rounded-full bg-[#e0ecf8] px-1.5 py-px text-[10.5px] font-semibold text-[#1f4a73]">Auto-detected</span> : null}
        {post.source === "screenshot" ? <span className="rounded-full bg-[#f3ecfb] px-1.5 py-px text-[10.5px] font-semibold text-[#5b3a87]">From screenshot</span> : null}
        {chip ? <span className={cx("rounded-full px-1.5 py-px text-[10.5px] font-semibold", chip.className)}>{chip.label}</span> : null}
      </div>

      {/* Relative performance against the best reel */}
      {performance.score && performance.maxScore ? (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#eef0ed]" aria-hidden="true">
          <div className={cx("h-full rounded-full", best ? "bg-[#d99a06]" : "bg-[#2e7d4f]")} style={{ width: `${Math.max(4, share * 100)}%` }} />
        </div>
      ) : null}

      {post.status === "rejected" && post.reviewNote ? (
        <p className="mt-2.5 rounded-lg bg-[#fdf2f1] px-3 py-2 text-[12.5px] leading-5 text-[#5c1a16]">
          <span className="font-semibold">Team note: </span>
          {post.reviewNote}
        </p>
      ) : null}

      {/* Inline stats: compact at any width, only what the platform reports */}
      {stats.length || rate !== undefined ? (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {stats.map((stat) => (
            <span key={stat.label} className="text-[12px] text-[#7a827c]">
              <span className="text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{stat.label === "Views" ? stat.value?.toLocaleString("en-IN") ?? "Unavailable" : formatCompact(stat.value)}</span>{" "}
              {/* "1 comment", "438 likes" */}
              {stat.value === 1 ? stat.label.toLowerCase().replace(/s$/, "") : stat.label.toLowerCase()}
            </span>
          ))}
          {rate !== undefined ? (
            <span className="ml-auto text-[12px] text-[#7a827c]">
              <span className="text-[13.5px] font-semibold tabular-nums text-[#2e7d4f]">{formatPct(rate)}</span> engagement
            </span>
          ) : null}
        </div>
      ) : post.status === "submitted" ? (
        <p className="mt-2.5 rounded-lg bg-[#fafbf9] px-3 py-2 text-[12px] text-[#616a64]">The team checks the reel and adds its numbers, usually within two days.</p>
      ) : null}


      {importSlot ? <div className="mt-3">{importSlot}</div> : null}

      {(onScreenshot && !importSlot) || onWithdraw ? (
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[#f0f1ef] pt-2.5">
          {onScreenshot && !importSlot ? (
            <button type="button" onClick={onScreenshot} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef1ed]">
              <UiIcon.Chart className="h-3.5 w-3.5" />
              Update from screenshot
            </button>
          ) : null}
          {onWithdraw ? (
            <button
              type="button"
              disabled={withdrawing}
              onClick={async () => {
                setWithdrawing(true);
                setWithdrawError(null);
                try {
                  await onWithdraw();
                } catch (error) {
                  setWithdrawError(error instanceof Error ? error.message : "Couldn't withdraw the reel.");
                } finally {
                  setWithdrawing(false);
                }
              }}
              className="ml-auto inline-flex h-8 items-center rounded-md px-2 text-[12px] font-semibold text-[#b42318] transition hover:bg-[#fdf2f1] disabled:opacity-50"
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          ) : null}
        </div>
      ) : null}
      {post.views !== undefined && post.viewsCapturedAt ? <p className="mt-1.5 text-[10.5px] text-[#8a928c]">Views measured {formatRelative(post.viewsCapturedAt).toLowerCase()}{post.viewsSource === "screenshot" ? " from screenshot" : post.viewsSource === "profile" ? " from Instagram" : ""}</p> : null}
      {withdrawError ? (
        <p role="alert" className="mt-2 text-[12px] text-[#b42318]">
          {withdrawError}
        </p>
      ) : null}
    </li>
  );
}

/** Compact table for tablets and desktops: every reel's numbers side by side. */
function ReelTable({ posts, topPostId, rankOf, onScreenshot }: { posts: SocialPost[]; topPostId?: string; rankOf: Map<string, number>; onScreenshot?: (post: SocialPost) => void }) {
  const cols = (["views", "reach", "likes", "comments", "shares", "saves"] as const).filter((k) => k === "views" || posts.some((p) => p[k] !== undefined));
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-[#ebedea] bg-white">
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead className="bg-[#fafbf9] text-[11px] font-medium text-[#7a827c]">
          <tr>
            <th className="w-10 px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">Reel</th>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2.5 text-right capitalize">
                {c}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right">Eng.</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f1ef]">
          {posts.map((post) => {
            const chip = post.status !== "approved" ? REVIEW_CHIP[post.status] : null;
            return (
              <tr key={post.id} className={cx("transition hover:bg-[#fafbf9]", post.status === "rejected" && "opacity-60")}>
                <td className="px-3 py-2.5 font-semibold tabular-nums text-[#7a827c]">{post.id === topPostId ? <span className="text-[#b07a00]">★</span> : (rankOf.get(post.id) ?? "–")}</td>
                <td className="max-w-[18rem] px-3 py-2.5">
                  <a href={post.url} target="_blank" rel="noreferrer noopener" className="block truncate font-semibold text-[#1a201c] underline-offset-2 hover:underline">
                    {splitCaption(post.caption).title}
                  </a>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8a928c]">
                    {post.postedAt ? formatDate(post.postedAt) : "No date"}
                    {!post.submittedByWorker && (post.source === "profile" || post.source === "api") ? <span className="rounded-full bg-[#e0ecf8] px-1.5 py-px text-[10px] font-semibold text-[#1f4a73]">Auto-detected</span> : null}
                    {chip ? <span className={cx("rounded-full px-1.5 py-px text-[10px] font-semibold", chip.className)}>{chip.label}</span> : null}
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2.5 text-right tabular-nums text-[#1a201c]">
                    {c === "views" ? post.views?.toLocaleString("en-IN") ?? <span className="text-[11px] text-[#8a928c]">Unavailable</span> : formatCompact(post[c])}
                    {c === "views" && post.viewsCapturedAt ? <span className="mt-0.5 block text-[10px] text-[#8a928c]">{formatRelative(post.viewsCapturedAt)}</span> : null}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#2e7d4f]">{formatPct(postEngagementRate(post))}</td>
                <td className="px-2 py-2 text-right">
                  {onScreenshot && post.status !== "rejected" ? (
                    <button type="button" onClick={() => onScreenshot(post)} aria-label={`Update ${post.caption || "reel"} from a screenshot`} title="Update from screenshot" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#2b5d4a] transition hover:bg-[#eef1ed]">
                      <UiIcon.Chart className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compare the same metric across reels; missing views never fall back to likes or comments. */
const postScore = (post: SocialPost, metric: string) => metric === "views" ? post.views ?? 0 : metric === "reached" ? post.reach ?? 0 : postInteractions(post);

function ReelSubmitForm({ account, onSubmitted, onCancel }: { account: LinkedSocialAccount; onSubmitted: (post: SocialPost, message?: string) => void; onCancel: () => void }) {
  const platform = accountPlatformFor(account.platform);
  const today = new Date().toISOString().slice(0, 10);
  const linkedDay = trackingStartInput(account.linkedAt);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [postedAt, setPostedAt] = useState(today);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkOk = platform.id === "instagram" ? !!canonicalInstagramReelUrl(url) : isPlatformProfileUrl(url.trim(), platform) && /^https:\/\//i.test(url.trim());
  const input =
    "h-11 w-full min-w-0 rounded-lg border border-[#d9ddd8] bg-white px-3 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#9aa29c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[14px]";

  const submit = async () => {
    if (!linkOk || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ action: "submit_reel", accountId: account.id, url: url.trim(), caption: caption.trim() || undefined, postedAt: new Date(`${postedAt}T12:00:00`).toISOString() }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.post?.id) throw new Error(payload?.error || "The reel couldn't be sent.");
      onSubmitted(payload.post as SocialPost, payload.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The reel couldn't be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-busy={sending}
      className="mt-3 rounded-xl border border-[#cfe3d4] bg-white p-3.5 sm:p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="block min-w-0 text-[12.5px] font-semibold text-[#1a201c]">
          Reel link
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={platform.id === "youtube" ? "https://www.youtube.com/shorts/…" : platform.hosts.length ? `https://www.${platform.hosts[0]}/reel/…` : "https://…"}
            aria-invalid={!!url.trim() && !linkOk}
            className={cx(input, "mt-1.5", url.trim() && !linkOk && "border-[#e7a19a]")}
          />
          {url.trim() && !linkOk ? <span className="mt-1 block text-[11.5px] font-normal text-[#b42318]">Use the {platform.label} link from the reel&apos;s Share menu.</span> : null}
        </label>
        <label className="block text-[12.5px] font-semibold text-[#1a201c]">
          Went live
          <input type="date" value={postedAt} min={linkedDay} max={today} onChange={(event) => setPostedAt(event.target.value)} className={cx(input, "mt-1.5")} />
          {linkedDay ? <span className="mt-1 block text-[11.5px] font-normal text-[#7a827c]">Reels count from the day this account was linked.</span> : null}
        </label>
      </div>
      <label className="mt-3 block text-[12.5px] font-semibold text-[#1a201c]">
        What&apos;s it about? <span className="font-normal text-[#8a928c]">(optional)</span>
        <input value={caption} maxLength={300} onChange={(event) => setCaption(event.target.value)} placeholder="e.g. 3 budget hacks in Pune" className={cx(input, "mt-1.5")} />
      </label>
      {platform.id === "instagram" ? <p className="mt-2 text-[12px] leading-5 text-[#7a827c]">Your reel&apos;s public caption and counts are added automatically when available. The team reviews it before earnings are approved.</p> : null}
      {error ? (
        <p role="alert" className="mt-2.5 text-[12.5px] text-[#b42318]">
          {error}
        </p>
      ) : null}
      <div className="mt-3.5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={!linkOk || sending}>
          {sending ? platform.id === "instagram" ? "Fetching reel…" : "Sending…" : "Send for review"}
        </Button>
      </div>
    </form>
  );
}

/** Live sync status for automatically read accounts, or who updates the numbers otherwise. */
function SyncBar({ account, onSynced }: { account: LinkedSocialAccount; onSynced: (next: LinkedSocialAccount) => void }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tick = useCallback(async () => { setNow(Date.now()); }, []);
  useVisibleRefresh(tick, 30_000);
  const { sync } = account;
  const latest = account.snapshots.at(-1);

  if (!sync.available) {
    return (
      <span className="text-[11.5px] text-[#8a928c]">
        {latest ? `Updated by the team ${formatRelative(latest.capturedAt).replace(/^Just/, "just")}` : "Stats are updated by the team"}
      </span>
    );
  }

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/social-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", accountId: account.id }) });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Couldn't sync right now.");
      if (payload?.account) onSynced(payload.account as LinkedSocialAccount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't sync right now.");
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        <SocialSyncStatus account={account} now={now} compact />
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncing || account.status !== "active" || sync.inProgress}
          aria-label="Sync stats now"
          title="Sync now"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef1ed] disabled:opacity-50"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cx("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden="true">
            <path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5" />
          </svg>
          {syncing || sync.inProgress ? "Syncing…" : sync.status === "error" ? "Retry" : "Sync"}
        </button>
      </div>
      <div className="max-w-[50ch] sm:text-right"><SocialSyncStatus account={account} now={now} showLabel={false} /></div>
      {message ? <p role="status" className="max-w-[50ch] text-[11.5px] text-[#9a5b00] sm:text-right">{message}</p> : null}
    </div>
  );
}

function AccountDetail({
  account,
  statsEnabled,
  screenshotReader,
  onChange,
  onPostChange,
  onRefresh,
}: {
  account: LinkedSocialAccount;
  statsEnabled: boolean;
  /** The AI screenshot reader is connected: offer "Update from screenshots". */
  screenshotReader: boolean;
  onChange: (next: LinkedSocialAccount) => void;
  onPostChange: (post: SocialPost) => void;
  onRefresh: () => Promise<void>;
}) {
  const platform = accountPlatformFor(account.platform);
  const [range, setRange] = useState<number>(30);
  const [metric, setMetric] = useState<SnapshotMetric>("followers");
  const [postSort, setPostSort] = useState<"views" | "engagement" | "recent">("recent");
  const [reelFilter, setReelFilter] = useState<"all" | SocialPost["status"]>("all");
  const [reelView, setReelView] = useState<"cards" | "table">("table");
  const [submitting, setSubmitting] = useState(false);
  // "account" = whole-account screenshots; a post id = that reel's insights screenshot.
  const [importing, setImporting] = useState<"account" | string | null>(null);
  const canImport = screenshotReader && statsEnabled && account.status === "active";
  const [reelNotice, setReelNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshClock = useCallback(async () => { setNow(Date.now()); }, []);
  useVisibleRefresh(refreshClock, 30_000);
  const snapshots = account.snapshots;
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) setNow(Date.now()); });
    return () => { disposed = true; };
  }, [snapshots]);
  const latest = snapshots.at(-1);
  const stale = daysSinceSnapshot(snapshots, now);
  const change = (key: SnapshotMetric) => metricChange(snapshots, key);
  const trend = (key: SnapshotMetric) => metricSeries(snapshots, key, range, now).map((p) => p.v);
  const followers = change("followers");
  const reach = change("reach");
  const impressions = change("impressions");
  const engagements = change("engagements");
  const profileViews = change("profileViews");
  const linkClicks = change("linkClicks");
  const posts = change("posts");
  const reachRate = engagementRate(latest);
  // API syncs don't include reach, so fall back to the follower-based rate the platforms' own tools use.
  const followerRate = reachRate === undefined ? followerEngagementRate(account.posts, metricChange(snapshots, "followers").value) : undefined;
  const latestRate = reachRate ?? followerRate;
  const previousWithRate = [...snapshots].reverse().filter((s) => engagementRate(s) !== undefined);
  const rateChange = reachRate !== undefined && previousWithRate.length > 1 ? (engagementRate(previousWithRate[0]) ?? 0) - (engagementRate(previousWithRate[1]) ?? 0) : undefined;
  // "last 7 days" for insight check-ins; synced figures are the change since the previous sync.
  const period = latest ? (latest.source === "api" ? "since previous sync" : latest.periodDays === 1 ? "last day" : `last ${latest.periodDays} days`) : undefined;
  const chartMetric = CHART_METRICS.find((m) => m.key === metric) ?? CHART_METRICS[0];
  const series = metricSeries(snapshots, metric, range, now);
  const sinceLinked = useMemo(() => {
    const first = snapshots.find((s) => typeof s.followers === "number");
    const last = [...snapshots].reverse().find((s) => typeof s.followers === "number");
    return first && last && first !== last ? (last.followers ?? 0) - (first.followers ?? 0) : undefined;
  }, [snapshots]);

  const countedPosts = useMemo(() => account.posts.filter((p) => p.status !== "rejected"), [account.posts]);
  const metricLabel = countedPosts.some((p) => p.views !== undefined) ? "views" : countedPosts.some((p) => p.reach !== undefined) ? "reached" : "interactions";
  const sortedPosts = useMemo(() => {
    const list = [...account.posts];
    if (postSort === "engagement") list.sort((a, b) => (postEngagementRate(b) ?? -1) - (postEngagementRate(a) ?? -1));
    else if (postSort === "recent") list.sort((a, b) => Date.parse(b.postedAt ?? b.updatedAt) - Date.parse(a.postedAt ?? a.updatedAt));
    else list.sort((a, b) => postScore(b, metricLabel) - postScore(a, metricLabel));
    return list;
  }, [account.posts, postSort, metricLabel]);
  const newReels = countedPosts.filter((post) => post.status === "submitted" && !post.submittedByWorker && (post.source === "profile" || post.source === "api") && Date.parse(post.createdAt) >= now);
  const topPostId = useMemo(() => [...countedPosts].filter((p) => postScore(p, metricLabel) > 0).sort((a, b) => postScore(b, metricLabel) - postScore(a, metricLabel))[0]?.id, [countedPosts, metricLabel]);
  const scored = countedPosts.map(post => postScore(post, metricLabel)).filter((n) => n > 0);
  const avgScore = scored.length > 1 ? scored.reduce((a, n) => a + n, 0) / scored.length : 0;
  const maxScore = scored.length ? Math.max(...scored) : 0;
  const reelCounts = {
    all: account.posts.length,
    submitted: account.posts.filter((p) => p.status === "submitted").length,
    approved: account.posts.filter((p) => p.status === "approved").length,
    rejected: account.posts.filter((p) => p.status === "rejected").length,
  };
  const visibleReels = reelFilter === "all" ? sortedPosts : sortedPosts.filter((p) => p.status === reelFilter);
  // Performance rank, independent of the chosen sort; reels without results aren't ranked.
  const rankOf = useMemo(() => {
    const ranked = [...countedPosts].filter((p) => postScore(p, metricLabel) > 0).sort((a, b) => postScore(b, metricLabel) - postScore(a, metricLabel));
    return new Map(ranked.map((p, i) => [p.id, i + 1]));
  }, [countedPosts, metricLabel]);
  // Last 12 reels in posting order, for the mini performance chart.
  const recentBars = [...countedPosts]
    .filter((p) => postScore(p, metricLabel) > 0)
    .sort((a, b) => Date.parse(a.postedAt ?? a.createdAt) - Date.parse(b.postedAt ?? b.createdAt))
    .slice(-12);
  const totals = useMemo(
    () => ({
      views: countedPosts.reduce((sum, p) => sum + (p.views ?? 0), 0),
      interactions: countedPosts.reduce((sum, p) => sum + postInteractions(p), 0),
    }),
    [countedPosts],
  );
  const avgViews = averageViews(account.posts) ?? 0;
  const viewSummary = reelViewSummary(account.posts);
  const cadence = postingCadence(account.posts, now);
  const pace = followerPace(snapshots, now);
  const followerMilestone = nextMilestone(followers.value, pace, now);
  const bestDay = bestPostingDay(account.posts);
  const earnings = reelEarnings(account);
  const pay = payoutPhrase(account.payout, account.payoutType);
  const pendingReview = account.posts.filter((p) => p.status === "submitted").length;
  const topPost = account.posts.find((p) => p.id === topPostId);

  const insights = (
    [
      sinceLinked !== undefined
        ? { kind: "growth", title: "Since tracking started", text: `${sinceLinked >= 0 ? "Gained" : "Lost"} ${formatCompact(Math.abs(sinceLinked))} followers.`, tone: sinceLinked >= 0 ? "good" : "warn" }
        : null,
      topPost && avgViews && (topPost.views ?? 0) > avgViews * 1.4
        ? { kind: "reel", title: "Top reel", text: `Got ${((topPost.views ?? 0) / avgViews).toFixed(1)}× your average views. Reuse its hook.`, tone: "good" }
        : null,
      reachRate !== undefined
        ? { kind: "engagement", title: "Engagement", text: `${formatPct(reachRate)} of the accounts you reached interacted${reachRate >= 5 ? ", a strong rate" : ""}.`, tone: reachRate >= 5 ? "good" : "neutral" }
        : followerRate !== undefined
          ? { kind: "engagement", title: "Engagement", text: `Interactions from ${formatPct(followerRate)} of followers on average${followerRate >= 3 ? ", above the usual 1–3%" : ""}.`, tone: followerRate >= 3 ? "good" : "neutral" }
          : null,
      pace !== undefined && Math.abs(pace) >= 1
        ? pace > 0
          ? { kind: "pace", title: "Growth pace", text: `About ${formatCompact(Math.round(pace))} followers a week${followerMilestone?.eta ? `. You'll pass ${formatCompact(followerMilestone.target)} around ${formatDate(followerMilestone.eta)}` : ""}.`, tone: "good" }
          : { kind: "pace", title: "Growth pace", text: `Followers dipped about ${formatCompact(Math.round(-pace))} a week lately. More frequent reels usually turn it around.`, tone: "warn" }
        : null,
      bestDay ? { kind: "day", title: "Best day to post", text: `${bestDay.day} reels average ${bestDay.lift.toFixed(1)}× your usual views. Post more on ${bestDay.day}s.`, tone: "good" } : null,
      account.status === "active" && countedPosts.length > 0 && cadence.last7 === 0
        ? { kind: "posting", title: "Posting", text: "No reels in the last 7 days. Posting regularly keeps your reach up.", tone: "warn" }
        : null,
    ] as Array<Insight | null>
  ).filter((item): item is Insight => item !== null);
  // Headline for the chart: the latest value and how it moved across the selected range.
  const rangeFirst = series[0];
  const rangeLast = series.at(-1);
  const rangeChange = rangeFirst && rangeLast && series.length > 1 ? rangeLast.v - rangeFirst.v : undefined;
  const rangePct = rangeChange !== undefined && rangeFirst?.v ? (rangeChange / rangeFirst.v) * 100 : undefined;
  const rangeDays = rangeFirst && rangeLast ? Math.max(1, (rangeLast.t - rangeFirst.t) / 86_400_000) : undefined;
  const chartMetrics = CHART_METRICS.filter((m) => snapshots.some((s) => typeof s[m.key] === "number"));
  const rateProps =
    latestRate !== undefined
      ? {
          label: "Engagement rate",
          value: formatPct(latestRate),
          hint: reachRate !== undefined ? "interactions ÷ reach" : "avg interactions ÷ followers",
          change: rateChange !== undefined ? Math.round(rateChange * 10) / 10 : undefined,
          // A rate moves in percentage points, not percent.
          changeLabel: rateChange !== undefined ? `${rateChange >= 0 ? "+" : "−"}${Math.abs(rateChange).toFixed(1)} pts` : undefined,
        }
      : null;
  const candidates: { key: string; props: Parameters<typeof Kpi>[0] | null }[] = [
    { key: "followers", props: followers.value !== undefined ? { label: "Followers", value: formatCompact(followers.value), change: followers.change, pct: followers.pct, trend: trend("followers"), emphasis: true } : null },
    { key: "impressions", props: impressions.value !== undefined ? { label: latest?.source === "api" ? "Views gained" : "Views", value: formatCompact(impressions.value), hint: period, change: impressions.change, pct: impressions.pct, trend: trend("impressions") } : null },
    { key: "reach", props: reach.value !== undefined ? { label: "Accounts reached", value: formatCompact(reach.value), hint: period, change: reach.change, pct: reach.pct, trend: trend("reach") } : null },
    { key: "rate", props: rateProps },
    { key: "engagements", props: engagements.value !== undefined ? { label: "Interactions", value: formatCompact(engagements.value), hint: period, change: engagements.change, pct: engagements.pct, trend: trend("engagements") } : null },
    { key: "profileViews", props: profileViews.value !== undefined ? { label: "Profile visits", value: formatCompact(profileViews.value), hint: period, change: profileViews.change, pct: profileViews.pct, trend: trend("profileViews") } : null },
    { key: "linkClicks", props: linkClicks.value !== undefined ? { label: "Link taps", value: formatCompact(linkClicks.value), hint: period, change: linkClicks.change, trend: trend("linkClicks") } : null },
  ];
  const kpis = candidates.filter((c): c is { key: string; props: Parameters<typeof Kpi>[0] } => c.props !== null).slice(0, 4);
  const profileCounts = [
    { label: "posts", value: posts.value ?? (countedPosts.length || undefined) },
    { label: "followers", value: followers.value },
    { label: "following", value: change("following").value },
  ].filter((c) => c.value !== undefined);
  // Pick 4 or 3 columns and widen the (text-heavy) earnings card when that fills the last row exactly.
  const tileCount = (latest ? kpis.length : 0) + 4;
  const desktopLayout =
    [
      { cols: 4, wide: false },
      { cols: 4, wide: true },
      { cols: 3, wide: false },
      { cols: 3, wide: true },
    ].find((l) => (tileCount + (l.wide ? 1 : 0)) % l.cols === 0) ?? { cols: 4, wide: false };
  const grid = { cols: desktopLayout.cols, earningsWideDesktop: desktopLayout.wide, earningsWideMobile: tileCount % 2 === 1 };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Account hero */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedea] bg-white">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(140deg,#1f2b24,#2e5a45)] text-white shadow-sm">
              <PlatformGlyph platform={platform} className="h-7 w-7" />
              <span
                className={cx("absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-[3px] border-white", account.status === "active" ? "bg-[#2e7d4f]" : "bg-[#d99a06]")}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <a href={account.profileUrl} target="_blank" rel="noreferrer noopener" className="truncate text-[18px] font-semibold text-[#1a201c] underline-offset-2 hover:underline sm:text-[20px]">
                  @{account.handle}
                </a>
                <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", account.status === "active" ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#fdf0d2] text-[#6b4a05]")}>
                  {account.status === "active" ? "Linked" : "Paused"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-[#616a64]">
                {platform.label}
                {account.gigTitle ? ` · ${account.gigTitle}` : ""}
                {account.company ? ` · ${account.company}` : ""}
              </p>
              {profileCounts.length ? (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {profileCounts.map((c) => (
                    <div key={c.label} className="flex items-baseline gap-1">
                      <dt className="sr-only">{c.label}</dt>
                      <dd className="text-[15px] font-semibold tabular-nums text-[#1a201c]">{formatCompact(c.value)}</dd>
                      <span className="text-[12.5px] text-[#616a64]" aria-hidden="true">
                        {c.label}
                      </span>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="mt-1 text-[12px] text-[#8a928c]">Linked {formatDate(account.linkedAt)}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <a
              href={account.profileUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#d9ddd8] bg-white px-3.5 text-[13px] font-semibold text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] transition hover:bg-[#f7f8f6]"
            >
              Open on {platform.label} <UiIcon.External className="h-3.5 w-3.5" />
            </a>
            {canImport && importing !== "account" ? (
              <button
                type="button"
                onClick={() => setImporting("account")}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#2b3a31]"
              >
                <UiIcon.Chart className="h-4 w-4" />
                Update from screenshots
              </button>
            ) : null}
            {account.sync.available || stale === undefined || stale <= STALE_AFTER_DAYS ? (
              <SyncBar account={account} onSynced={onChange} />
            ) : (
              <span className="text-[11.5px] text-[#9a5b00]">Stats last updated {formatRelative(latest?.capturedAt)}</span>
            )}
          </div>
        </div>
        {account.status === "paused" ? (
          <div className="border-t border-[#f1e6c8] bg-[#fdf8ec] px-4 py-2.5 text-[12.5px] text-[#5f4a1c] sm:px-5">
            The team paused this account. Hold off on new posts until they get in touch.
          </div>
        ) : null}
      </section>

      {importing === "account" ? (
        <ScreenshotImport
          accountId={account.id}
          handle={account.handle}
          platformLabel={platform.label}
          onCancel={() => setImporting(null)}
          onDone={() => void onRefresh()}
        />
      ) : null}

      {/* Posting & earnings: useful from day one, before the first insights check-in */}
      {/* One grid for the headline numbers and posting/earnings, sized by how many cards there are. */}
      <section aria-label="Key numbers" className={cx("grid grid-cols-2 gap-2.5 sm:gap-3", grid.cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
        {latest ? kpis.map((kpi) => <Kpi key={kpi.key} {...kpi.props} />) : null}
        <div className="rounded-xl border border-[#ebedea] bg-white p-3.5 sm:p-4">
          <div className="text-[12px] font-medium text-[#616a64]">Reels this week</div>
          <div className="mt-2 text-[22px] font-semibold leading-none tabular-nums text-[#1a201c]">{cadence.last7}</div>
          <div className="mt-1.5 text-[11.5px] text-[#8a928c]">{cadence.perWeek ? `${cadence.perWeek} a week on average` : "Post your first reel"}</div>
        </div>
        <div className="rounded-xl border border-[#ebedea] bg-white p-3.5 sm:p-4">
          <div className="text-[12px] font-medium text-[#616a64]">Reel views</div>
          <div className="mt-2 text-[22px] font-semibold leading-none tabular-nums text-[#1a201c]" aria-live="polite">{viewSummary.total?.toLocaleString("en-IN") ?? "–"}</div>
          <div className="mt-1.5 text-[11.5px] text-[#8a928c]">{viewSummary.measured ? `${viewSummary.measured} measured reel${viewSummary.measured === 1 ? "" : "s"} · ${formatCompact(Math.round(viewSummary.average ?? 0))} average views` : countedPosts.length ? "Waiting for public view counts" : "Submit a reel to track its views"}</div>
          {viewSummary.missing ? <p className="mt-1.5 text-[11.5px] text-[#9b6109]">{viewSummary.missing} reel{viewSummary.missing === 1 ? "" : "s"} without a view count</p> : null}
          {viewSummary.oldestCapturedAt ? <p className="mt-1.5 text-[10.5px] text-[#8a928c]">Counts measured {formatRelative(viewSummary.oldestCapturedAt).toLowerCase()}</p> : null}
          <p className="mt-1.5 text-[10.5px] text-[#8a928c]">Automatic checks every 5 minutes; access limits can delay updates.</p>
        </div>
        <div
          className={cx(
            "flex flex-col rounded-xl border border-[#cfe3d4] bg-[#f4f9f2] p-3.5 sm:p-4",
            // Full width on phones goes last, so the smaller cards above pair up without gaps.
            "order-last col-span-2 lg:order-none",
            grid.earningsWideDesktop ? "lg:col-span-2" : "lg:col-span-1"
          )}
        >
          <div className="text-[12px] font-medium text-[#3b5a47]">{earnings?.basis === "views" ? "View earnings (estimate)" : earnings ? "Earned from reels" : "Your pay"}</div>
          <div className="mt-2 break-words text-[19px] font-semibold leading-tight tabular-nums text-[#1a201c] sm:text-[22px] sm:leading-none">{earnings ? earnings.earned : pay || "–"}</div>
          {earnings ? (
            <>
              {/* Breakdown instead of one long sentence */}
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-[#5d7466]">Rate</dt>
                  <dd className="font-semibold tabular-nums text-[#1a201c]">{earnings.basis === "views" ? `${earnings.rate} / 1K views` : `${earnings.rate} / reel`}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[#5d7466]">{earnings.basis === "views" ? "Approved views" : "Approved reels"}</dt>
                  <dd className="font-semibold tabular-nums text-[#1a201c]">{earnings.basis === "views" ? formatCompact(earnings.approvedViews) : earnings.approved}</dd>
                </div>
                  <div className="min-w-0">
                    <dt className="text-[#5d7466]">In review</dt>
                    <dd className="break-words font-semibold tabular-nums text-[#1a201c]">{earnings.pendingValue}</dd>
                  </div>
              </dl>
              {earnings.basis === "views" && (earnings.unmeasuredApproved || earnings.unmeasuredPending) ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-[#8a5300]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d99a06]" aria-hidden="true" />
                  {[
                    earnings.unmeasuredApproved ? `${earnings.unmeasuredApproved} approved reel${earnings.unmeasuredApproved === 1 ? "" : "s"} waiting for a view count` : null,
                    earnings.unmeasuredPending ? `${earnings.unmeasuredPending} reel${earnings.unmeasuredPending === 1 ? "" : "s"} in review without counts` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-1.5 text-[11.5px] text-[#5d7466]">{pay ? "as listed on the gig" : "See the gig for pay details"}</div>
          )}
        </div>
        <ViewMilestoneCard account={account} className={!grid.earningsWideMobile ? "col-span-2 lg:col-span-1" : undefined} />
      </section>
      {earnings ? (
        <p className="-mt-1 text-[11.5px] leading-5 text-[#8a928c]">
          Estimates use the gig&apos;s listed rate. Reel approval credits reviewed earnings to your wallet; new views need another review.
        </p>
      ) : null}

      {String(account.payoutType).trim().toLowerCase() === "per 1k views" ? <ViewPayoutClaims key={account.id} accountId={account.id} /> : null}

      {!latest ? (
        <section className="rounded-2xl border border-dashed border-[#d9ddd8] bg-white px-5 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef1ed] text-[#2b5d4a]">
            <UiIcon.Chart className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-[15px] font-semibold text-[#1a201c]">
            {!statsEnabled ? "Stats tracking is being activated" : account.sync.available ? (account.sync.status === "error" ? "We couldn't load stats yet" : "Fetching your first stats") : "Your stats are on the way"}
          </h3>
          <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-5 text-[#616a64]">
            {statsEnabled && account.sync.available
              ? account.sync.status === "error"
                ? account.sync.error ?? "The platform didn't answer. We'll keep retrying automatically."
                : `Followers, views and reel results load straight from ${account.platform}. Press Sync to fetch them now.`
              : statsEnabled && canImport
              ? "Screenshot your profile and Professional dashboard, then upload them here. Followers, reach and views fill in straight away."
              : statsEnabled
              ? "The team records reach, followers and reel results from this account's insights. The first check-in usually lands within two days of linking."
              : "Your account is verified and linked. Followers, reach and reel results appear here as soon as tracking is switched on for it."}
          </p>
          {canImport && importing !== "account" ? (
            <Button variant="primary" className="mt-4" onClick={() => setImporting("account")}>
              Upload screenshots
            </Button>
          ) : null}
        </section>
      ) : (
        <>
          {/* Trend */}
          <section className="@container/growth rounded-2xl border border-[#ebedea] bg-white p-4 sm:p-5" aria-labelledby="trend-title">
            <div className="flex flex-col gap-3 @[560px]/growth:flex-row @[560px]/growth:items-start @[560px]/growth:justify-between">
              <div className="min-w-0">
                <h3 id="trend-title" className="text-[13px] font-semibold text-[#616a64]">
                  Growth · {chartMetric.label}
                </h3>
                {rangeLast ? (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-[#1a201c] tabular-nums sm:text-[28px]">{formatCompact(rangeLast.v)}</span>
                    {rangeChange !== undefined && rangeChange !== 0 ? (
                      <span
                        className={cx(
                          "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums",
                          rangeChange > 0 ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#fde4e1] text-[#8e1f1a]"
                        )}
                      >
                        {rangeChange > 0 ? <UiIcon.ArrowUp className="h-3 w-3" /> : <UiIcon.ArrowDown className="h-3 w-3" />}
                        {formatCompact(Math.abs(rangeChange))}
                        {rangePct !== undefined && Number.isFinite(rangePct) ? <span className="font-medium opacity-80">({formatPct(Math.abs(rangePct))})</span> : null}
                      </span>
                    ) : null}
                    <span className="text-[12px] text-[#7a827c]">
                      {range ? `last ${range} days` : "all time"}
                      {rangeChange && rangeDays && rangeDays >= 1.5 ? ` · ${rangeChange > 0 ? "+" : "−"}${formatCompact(Math.abs(rangeChange / rangeDays))}/day` : ""}
                    </span>
                  </div>
                ) : null}
              </div>
              <div role="radiogroup" aria-label="Range" className="inline-flex self-start rounded-lg bg-[#f1f3f0] p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={range === r.id}
                    onClick={() => setRange(r.id)}
                    className={cx(
                      "h-8 min-w-[2.75rem] rounded-md px-2 text-[12px] font-semibold transition sm:h-7",
                      range === r.id ? "bg-white text-[#1a201c] shadow-sm" : "text-[#616a64] hover:text-[#1a201c]"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {chartMetrics.length > 1 ? (
              <div className="dashboard-chip-scroller -mx-4 mt-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Metric">
                {chartMetrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={metric === m.key}
                    onClick={() => setMetric(m.key)}
                    className={cx(
                      "h-8 shrink-0 rounded-full border px-3 text-[12.5px] font-semibold transition",
                      metric === m.key ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#e3e5e1] bg-white text-[#3b443e] hover:bg-[#f7f8f6]"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="-mx-1 mt-4 sm:mx-0">
              <MetricChart points={series} label={chartMetric.label} format={formatCompact} zeroBased={chartMetric.zeroBased} height={240} />
            </div>
            {insights.length ? (
              <div className="mt-5 border-t border-[#f0f1ef] pt-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">Insights</h4>
                <ul className="mt-2.5 grid grid-cols-1 gap-2.5 @[560px]/growth:grid-cols-2 @[900px]/growth:grid-cols-3">
                  {insights.map((item) => (
                    <InsightCard key={item.kind + item.text} item={item} />
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      )}

      {/* Reels */}
      <section className="rounded-2xl border border-[#ebedea] bg-[#fafbf9] p-4 sm:p-5" aria-labelledby="reels-title">
        {newReels.length ? (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#cfe3d4] bg-[#f4f9f2] px-3 py-2.5 text-[12px] text-[#2b5d4a]">
            <span>{newReels.length} new reel{newReels.length === 1 ? "" : "s"} found automatically · awaiting review</span>
            <button type="button" onClick={() => { setReelFilter("submitted"); setPostSort("recent"); }} className="rounded-md px-2 py-1 font-semibold underline underline-offset-2">Show newest</button>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="reels-title" className="text-[15px] font-semibold text-[#1a201c]">
              Reels on this account
            </h3>
            <p className="mt-0.5 text-[12.5px] text-[#616a64]">
              {countedPosts.length
                ? [
                    `${countedPosts.length} reel${countedPosts.length === 1 ? "" : "s"}`,
                    totals.views ? `${formatCompact(totals.views)} views` : null,
                    totals.interactions ? `${formatCompact(totals.interactions)} interactions` : null,
                    pendingReview ? `${pendingReview} awaiting review` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : statsEnabled && account.sync.available
                  ? "Reels you post on this account are picked up automatically. Submit one only if it's missing."
                  : statsEnabled
                  ? "Posted a reel? Send its link so the team can review it and add its results."
                  : "Reel tracking starts as soon as stats are switched on for this account."}
            </p>
          </div>
          {recentBars.length > 2 ? (
            <figure className="flex shrink-0 flex-col items-start gap-1 sm:items-end" aria-label={`Recent reels by ${metricLabel}`}>
              <div className="flex h-10 items-end gap-[3px]">
                {recentBars.map((post) => (
                  <span
                    key={post.id}
                    title={`${post.caption || "Reel"}: ${formatCompact(postScore(post, metricLabel))} ${metricLabel}`}
                    className={cx("w-2.5 rounded-t-[3px] sm:w-3", post.id === topPostId ? "bg-[#d99a06]" : "bg-[#2e7d4f]/70")}
                    style={{ height: `${Math.max(12, (postScore(post, metricLabel) / maxScore) * 100)}%` }}
                  />
                ))}
              </div>
              <figcaption className="text-[10.5px] text-[#8a928c]">Last {recentBars.length} reels · {metricLabel}</figcaption>
            </figure>
          ) : null}
        </div>

        {platform.id === "instagram" && account.sync?.available && account.status === "active" ? <p className="mt-2 text-[11px] text-[#8a928c]">Automatic checks run every 5 minutes, with longer waits when Instagram limits access. Discovered reels appear here for review. Submit a link to fetch a reel now.</p> : null}

        {/* Toolbar: status filter · sort · view · submit */}
        {account.posts.length || (account.status === "active" && statsEnabled) ? (
          <div className="mt-3.5 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
            {account.posts.length ? (
              <div className="dashboard-chip-scroller -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter reels">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "submitted", label: "Awaiting review" },
                    { id: "approved", label: "Approved" },
                    { id: "rejected", label: "Not approved" },
                  ] as const
                )
                  .filter((f) => f.id === "all" || reelCounts[f.id] > 0)
                  .map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={reelFilter === f.id}
                      onClick={() => setReelFilter(f.id)}
                      className={cx(
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition",
                        reelFilter === f.id ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e] hover:bg-[#f7f8f6]"
                      )}
                    >
                      {f.label}
                      <span className={cx("rounded-full px-1.5 text-[10.5px] tabular-nums", reelFilter === f.id ? "bg-white/20" : "bg-[#eef0ed] text-[#616a64]")}>{reelCounts[f.id]}</span>
                    </button>
                  ))}
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {account.posts.length > 1 ? (
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#616a64]">
                  <span className="sr-only sm:not-sr-only">Sort</span>
                  <select
                    value={postSort}
                    onChange={(event) => setPostSort(event.target.value as typeof postSort)}
                    aria-label="Sort reels"
                    className="h-8 rounded-lg border border-[#d9ddd8] bg-white px-2 text-[12.5px] font-semibold text-[#1a201c] outline-none focus:ring-2 focus:ring-[#2e7d4f]/25"
                  >
                    <option value="views">{metricLabel === "views" ? "Most viewed" : "Top performing"}</option>
                    <option value="engagement">Best engagement</option>
                    <option value="recent">Newest</option>
                  </select>
                </label>
              ) : null}
              {account.posts.length > 1 ? (
                <div className="hidden rounded-lg bg-[#eef0ed] p-0.5 md:inline-flex" role="radiogroup" aria-label="Layout">
                  {(["cards", "table"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={reelView === v}
                      onClick={() => setReelView(v)}
                      className={cx("h-7 rounded-md px-2.5 text-[12px] font-semibold capitalize transition", reelView === v ? "bg-white text-[#1a201c] shadow-sm" : "text-[#616a64] hover:text-[#1a201c]")}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              ) : null}
              {account.status === "active" && statsEnabled && !submitting ? (
                <Button variant="primary" size="sm" className="ml-auto md:ml-0" onClick={() => { setSubmitting(true); setReelNotice(null); }}>
                  Submit a reel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {reelNotice ? (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-[#cfe6c9] bg-[#f1f8ef] px-3 py-2 text-[12.5px] font-semibold text-[#1f5131]">
            <UiIcon.Check className="h-4 w-4 shrink-0" />
            {reelNotice}
          </p>
        ) : null}
        {submitting ? (
          <ReelSubmitForm
            account={account}
            onCancel={() => setSubmitting(false)}
            onSubmitted={(post, message) => {
              onPostChange(post);
              setSubmitting(false);
              setReelFilter(post.status);
              setPostSort("recent");
              setReelNotice(message || "Reel sent for review. Its stats will appear when available.");
            }}
          />
        ) : null}
        {account.posts.length && !visibleReels.length ? (
          <p className="mt-3 rounded-xl border border-dashed border-[#dfe2de] bg-white px-4 py-6 text-center text-[12.5px] text-[#7a827c]">No reels in this filter.</p>
        ) : null}
        {visibleReels.length && reelView === "table" ? (
          <div className="hidden md:block">
            <ReelTable posts={visibleReels} rankOf={rankOf} topPostId={countedPosts.length > 1 ? topPostId : undefined} onScreenshot={canImport ? (post) => { setReelView("cards"); setImporting(post.id); } : undefined} />
          </div>
        ) : null}
        {visibleReels.length ? (
          <ol className={cx("mt-3 grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3", reelView === "table" && "md:hidden")}>
            {visibleReels.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                rank={rankOf.get(post.id)}
                best={post.id === topPostId && countedPosts.length > 1}
                performance={{ score: post.status === "rejected" ? 0 : postScore(post, metricLabel), avgScore, maxScore, metricLabel }}
                onScreenshot={canImport && post.status !== "rejected" ? () => setImporting(post.id) : undefined}
                importSlot={
                  importing === post.id ? (
                    <ScreenshotImport
                      accountId={account.id}
                      handle={account.handle}
                      platformLabel={platform.label}
                      postId={post.id}
                      postLabel={post.caption}
                      onCancel={() => setImporting(null)}
                      onDone={() => void onRefresh()}
                    />
                  ) : undefined
                }
                onWithdraw={
                  post.status === "submitted" && post.submittedByWorker
                    ? async () => {
                        const res = await fetch("/api/social-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw_reel", id: post.id }) });
                        const payload = await res.json().catch(() => null);
                        if (!res.ok) {
                          setReelNotice(null);
                          throw new Error(payload?.error || "Couldn't withdraw the reel.");
                        }
                        onChange({ ...account, posts: account.posts.filter((p) => p.id !== post.id) });
                        setReelNotice("Reel withdrawn.");
                      }
                    : undefined
                }
              />
            ))}
          </ol>
        ) : null}
      </section>

      <p className="flex items-start gap-2 text-[11.5px] leading-5 text-[#8a928c]">
        <UiIcon.Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {account.sync.available
          ? platform.id === "instagram"
            ? "Instagram statistics are checked automatically every five minutes, with longer waits when access is limited. Public counts may be rounded; hidden post metrics, reach, shares and saves need insight screenshots. If a check fails, your last successful data stays available."
            : `Stats sync automatically from ${platform.label}'s official API every few hours. Reach and profile visits are added by the Reelencer team from the account's insights.`
          : canImport
            ? `Stats come from ${platform.label} insight screenshots you upload (read by AI, never stored) and the Reelencer team's check-ins.`
            : `Stats come from the account's own ${platform.label} insights, recorded by the Reelencer team. Keep the login unchanged so check-ins keep working.`}
      </p>
    </div>
  );
}

export default function SocialAccountsView({ onFindGigs, state }: { onFindGigs: () => void; state: SocialAccountsState }) {
  const { load, refreshing, refresh: refreshAccounts, updateAccount, updatePost, earnings } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const requests = useAccountRequests(load.state === "ready" ? load.accounts : null);
  const refresh = useCallback(() => refreshAccounts(true), [refreshAccounts]);
  // Check deadlines frequently; the server still limits Instagram reads to once per five minutes.
  useVisibleRefresh(refresh, 30_000);

  if (load.state === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading accounts">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div role="alert" className="rounded-2xl border border-[#f3cdc8] bg-[#fdf2f1] px-5 py-6 text-center">
        <p className="text-[14px] font-semibold text-[#8e1f1a]">{load.unavailable ? "Account stats aren't available yet" : "Couldn't load your accounts"}</p>
        <p className="mx-auto mt-1 max-w-[50ch] text-[13px] text-[#5c1a16]">{load.unavailable ? "This part of Reelencer is still being switched on. Check back soon." : load.message}</p>
        <Button size="sm" className="mt-4" onClick={() => void refresh()} disabled={refreshing}>
          Try again
        </Button>
      </div>
    );
  }

  const accounts = load.accounts;
  const issues = load.accountIssues ?? [];
  const recoveryCards = issues.length ? <div role="group" className="space-y-3" aria-label="Profiles needing verification">{issues.map(account => <LinkedAccountRecovery key={account.id} account={account} onChange={(next, message) => { updateAccount(next); if (next.status === "active") setRecoveryNotice(message); }} />)}</div> : null;
  if (!accounts.length) {
    if (issues.length) return <div className="space-y-4">{recoveryCards}{earnings?.accountCount ? <ReelEarningsSummary summary={earnings} /> : null}<p className="text-center text-[12px] leading-5 text-[#7a827c]">Verified profiles will appear in Linked again. Saved reels and earnings are retained.</p></div>;
    return (
      <section className="rounded-2xl border border-[#ebedea] bg-white px-5 py-10 text-center sm:py-14">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eef1ed] text-[#2b5d4a]">
          <UiIcon.User className="h-7 w-7" />
        </span>
        <h3 className="mt-4 text-[16px] font-semibold text-[#1a201c]">No linked accounts yet</h3>
        <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-5 text-[#616a64]">
          When you&apos;re approved for a Content Posting gig, the account you set up for it is linked here with its followers, reach and reel results.
        </p>
        <Button variant="primary" className="mt-5" onClick={onFindGigs}>
          Find Content Posting gigs
        </Button>
      </section>
    );
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];
  return (
    <div className="space-y-4">
      {recoveryNotice ? <p role="status" className="rounded-xl bg-[#edf6e7] px-4 py-3 text-[12.5px] text-[#35633e]">{recoveryNotice}</p> : null}
      {recoveryCards}
      {load.refreshError ? <p role="status" className="rounded-xl border border-[#ecd8a8] bg-[#fff8e8] px-4 py-3 text-[12.5px] text-[#6b4a05]">Showing your last saved account stats. {load.refreshError}</p> : null}
      {accounts.length > 1 ? <ReelEarningsSummary summary={earnings} /> : null}
      <AccountsRail accounts={accounts} selectedId={selected.id} onSelect={setSelectedId} controller={requests} onOpenSheet={setSheet} earnings={earnings} />
      <AddAccountsPanel controller={requests} accounts={accounts} earnings={earnings} onOpenSheet={setSheet} />
      <AccountDetail key={selected.id} account={selected} statsEnabled={load.statsEnabled} screenshotReader={load.screenshotReader} onRefresh={refresh} onChange={updateAccount} onPostChange={post => updatePost(selected.id, post)} />
      {sheet ? <AddAccountSheet mode={sheet} controller={requests} onClose={() => setSheet(null)} onMode={setSheet} /> : null}
      <div className="flex justify-center">
        <Button size="sm" variant="plain" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh stats"}
        </Button>
      </div>
    </div>
  );
}
