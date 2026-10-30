"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { LinkedSocialAccount } from "@/lib/socialAnalytics";
import AccountPerformanceCard from "./AccountPerformanceCard";
import { isOpenPayoutStatus, type AccountEarningsSummary } from "@/lib/creatorEarnings";
import { buildCreatorJobs, creatorJobCounts, CREATOR_JOB_GROUPS, CREATOR_JOB_LABELS, type CreatorJobApplication, type CreatorJobAssignment } from "@/lib/creatorJobs";
import {
  Card,
  CardHeader,
  DAY_MS,
  Icon,
  JobPayout,
  LinkButton,
  Skeleton,
  StatusBadge,
  cx,
  formatMoney,
  formatMoneyCompact,
  formatRelative,
  getInitials,
  safeTime,
} from "./dashboardUi";

/* ------------------------------------------------------------------ */
/* Types — structural subsets of the dashboard page's data            */
/* ------------------------------------------------------------------ */

export type OverviewSection = "profile" | "dashboard" | "jobs" | "find" | "accounts" | "messages" | "wallet";

type OverviewGig = {
  id: string;
  title: string;
  company: string;
  platform: string;
  payout: string;
  payoutType?: string;
  location: string;
  postedAt: string;
  verified?: boolean;
};

type OverviewApplication = CreatorJobApplication;
type OverviewAssignment = CreatorJobAssignment;

type OverviewPayoutBatch = {
  id: string;
  cycleLabel: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  items: Array<{ amountINR: number }>;
};

type OverviewMessage = {
  id: string;
  title: string;
  preview: string;
  meta: string;
  timestamp?: string;
  unread?: boolean;
  section: OverviewSection;
};

type NavigateOptions = { gigId?: string | null; intent?: "details" | "apply" };

export type DashboardOverviewProps = {
  firstName: string;
  loading: boolean;
  gigs: OverviewGig[];
  openGigs: OverviewGig[];
  applications: OverviewApplication[];
  assignments: OverviewAssignment[];
  payoutBatches: OverviewPayoutBatch[];
  payoutSummary: { credited: number; pending: number; liveBatches: number };
  accountEarnings: AccountEarningsSummary | null;
  earningsLoading: boolean;
  earningsError?: string;
  /** Linked social accounts for the performance card. */
  socialAccounts: LinkedSocialAccount[];
  socialAccountsLoading: boolean;
  socialAccountsError?: string;
  messages: OverviewMessage[];
  unreadCount: number;
  profileChecklist: Array<{ label: string; complete: boolean }>;
  profileCompletion: number;
  onNavigate: (section: OverviewSection, options?: NavigateOptions) => void;
};

type RangeKey = "7d" | "30d" | "90d" | "all";

const RANGES: Array<{ key: RangeKey; label: string; long: string; days: number | null }> = [
  { key: "7d", label: "7D", long: "Last 7 days", days: 7 },
  { key: "30d", label: "30D", long: "Last 30 days", days: 30 },
  { key: "90d", label: "90D", long: "Last 90 days", days: 90 },
  { key: "all", label: "All", long: "All time", days: null },
];

/* Chart colors: one-hue ordinal ramp (validated: monotone L, single hue, light end ≥ 2:1 on white). */
const SERIES_PENDING = "#7cb68a";
const SERIES_PAID = "#2e7d4f";
/* Fixed status palette — always paired with a text label. */
const STATUS_GOOD = "#0ca30c";
const STATUS_WARNING = "#fab219";
const STATUS_CRITICAL = "#d03b3b";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function batchTotal(batch: OverviewPayoutBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

function batchIsPaid(batch: OverviewPayoutBatch) {
  return String(batch.status).toLowerCase() === "paid";
}

function batchDate(batch: OverviewPayoutBatch) {
  return safeTime(batch.paidAt ?? batch.processedAt ?? batch.createdAt);
}

function niceCeiling(value: number) {
  if (value <= 0) return 1000;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

type Bucket = { key: string; label: string; shortLabel: string; start: number; end: number; paid: number; pending: number };

function buildBuckets(range: RangeKey, batches: OverviewPayoutBatch[], now: number): Bucket[] {
  const startOfDay = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const buckets: Bucket[] = [];

  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const today = startOfDay(now);
    for (let index = days - 1; index >= 0; index -= 1) {
      const start = today - index * DAY_MS;
      const date = new Date(start);
      buckets.push({
        key: String(start),
        label: date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
        shortLabel: range === "7d" ? date.toLocaleDateString("en-IN", { weekday: "short" }) : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        start,
        end: start + DAY_MS,
        paid: 0,
        pending: 0,
      });
    }
  } else if (range === "90d") {
    const today = startOfDay(now);
    for (let index = 12; index >= 0; index -= 1) {
      const end = today + DAY_MS - index * 7 * DAY_MS;
      const start = end - 7 * DAY_MS;
      const startDate = new Date(start);
      buckets.push({
        key: String(start),
        label: `Week of ${startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
        shortLabel: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        start,
        end,
        paid: 0,
        pending: 0,
      });
    }
  } else {
    const earliest = batches.reduce((min, batch) => {
      const time = batchDate(batch);
      return time && time < min ? time : min;
    }, now);
    const current = new Date(now);
    const monthsBack = Math.min(11, Math.max(5, (current.getFullYear() - new Date(earliest).getFullYear()) * 12 + current.getMonth() - new Date(earliest).getMonth()));
    for (let index = monthsBack; index >= 0; index -= 1) {
      const startDate = new Date(current.getFullYear(), current.getMonth() - index, 1);
      const endDate = new Date(current.getFullYear(), current.getMonth() - index + 1, 1);
      buckets.push({
        key: String(startDate.getTime()),
        label: startDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
        shortLabel: startDate.toLocaleDateString("en-IN", { month: "short" }),
        start: startDate.getTime(),
        end: endDate.getTime(),
        paid: 0,
        pending: 0,
      });
    }
  }

  batches.forEach((batch) => {
    const time = batchDate(batch);
    const bucket = buckets.find((item) => time >= item.start && time < item.end);
    if (!bucket) return;
    if (batchIsPaid(batch)) bucket.paid += batchTotal(batch);
    else if (isOpenPayoutStatus(batch.status)) bucket.pending += batchTotal(batch);
  });

  return buckets;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/* ------------------------------------------------------------------ */
/* KPI tiles                                                          */
/* ------------------------------------------------------------------ */

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2 || values.every((value) => value === 0)) {
    return <div className="h-8 w-20" aria-hidden="true" />;
  }
  const width = 80;
  const height = 32;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * (width - 4) + 2;
    const y = height - 3 - (value / max) * (height - 8);
    return [x, y] as const;
  });
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-20 shrink-0 overflow-visible" role="img" aria-label={label}>
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="#b9c0ba"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r="3.5" fill={SERIES_PAID} stroke="#ffffff" strokeWidth="2" /> : null}
    </svg>
  );
}

function KpiTile({
  label,
  value,
  caption,
  delta,
  trend,
  onClick,
  loading,
}: {
  label: string;
  value: string;
  caption: string;
  delta?: { value: number; goodWhenUp: boolean } | null;
  trend?: number[];
  onClick: () => void;
  loading: boolean;
}) {
  const showDelta = delta && Number.isFinite(delta.value) && delta.value !== 0;
  const up = (delta?.value ?? 0) > 0;
  const good = showDelta ? (up ? delta!.goodWhenUp : !delta!.goodWhenUp) : false;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-[#e3e5e1] bg-white p-3.5 text-left shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)] transition hover:border-[#cfd5cf] hover:shadow-[0_4px_14px_-6px_rgba(26,32,28,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-[#616a64]">{label}</span>
        <Icon.ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#616a64]" />
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[#1a201c] tabular-nums sm:text-[22px]">{value}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
              {showDelta ? (
                <span className={cx("inline-flex items-center gap-0.5 font-semibold", good ? "text-[#006300]" : "text-[#b42318]")}>
                  {up ? <Icon.ArrowUp /> : <Icon.ArrowDown />}
                  {Math.abs(Math.round(delta!.value))}%
                </span>
              ) : null}
              <span className="truncate text-[#7a827c]">{caption}</span>
            </div>
          </div>
          {trend ? (
            <span className="hidden min-[420px]:block">
              <Sparkline values={trend} label={`${label} trend`} />
            </span>
          ) : null}
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Earnings chart                                                     */
/* ------------------------------------------------------------------ */

function roundedTopPath(x: number, y: number, width: number, height: number, radius: number) {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

function EarningsChart({ buckets, rangeLabel }: { buckets: Bucket[]; rangeLabel: string }) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const titleId = useId();

  const height = width < 480 ? 190 : 230;
  const padding = { top: 12, right: 8, bottom: 26, left: width < 480 ? 44 : 52 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...buckets.map((bucket) => bucket.paid + bucket.pending), 0);
  const yMax = niceCeiling(maxValue);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * yMax);
  const slot = buckets.length ? plotWidth / buckets.length : 0;
  const barWidth = Math.max(2, Math.min(24, slot * 0.62));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotWidth / 56))));
  const scaleY = (value: number) => (value / yMax) * plotHeight;
  const active = activeIndex !== null ? buckets[activeIndex] : null;

  const pickIndex = (clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left - padding.left;
    if (slot <= 0) return null;
    return Math.min(buckets.length - 1, Math.max(0, Math.floor(x / slot)));
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (!buckets.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((current) => {
        const base = current ?? (event.key === "ArrowRight" ? -1 : buckets.length);
        return Math.min(buckets.length - 1, Math.max(0, base + (event.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (event.key === "Escape") {
      setActiveIndex(null);
    }
  };

  const tooltipLeft = active && activeIndex !== null ? padding.left + slot * activeIndex + slot / 2 : 0;

  return (
    <div ref={containerRef} className="relative w-full">
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActiveIndex(null)}
          onPointerMove={(event) => setActiveIndex(pickIndex(event.clientX, event.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActiveIndex(null)}
          className="block touch-pan-y rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
        >
          <title id={titleId}>{`Payouts, ${rangeLabel.toLowerCase()}. Use arrow keys to read values.`}</title>
          {ticks.map((tick) => {
            const y = padding.top + plotHeight - scaleY(tick);
            return (
              <g key={tick}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke={tick === 0 ? "#c3c2b7" : "#ebebe6"} strokeWidth="1" />
                <text x={padding.left - 8} y={y} dy="0.32em" textAnchor="end" className="fill-[#898781] text-[11px] tabular-nums">
                  {formatMoneyCompact(tick)}
                </text>
              </g>
            );
          })}

          {active && activeIndex !== null ? (
            <rect x={padding.left + slot * activeIndex} y={padding.top} width={slot} height={plotHeight} fill="#f3f5f2" />
          ) : null}

          {buckets.map((bucket, index) => {
            const x = padding.left + slot * index + (slot - barWidth) / 2;
            const paidHeight = scaleY(bucket.paid);
            const pendingHeight = scaleY(bucket.pending);
            const baseline = padding.top + plotHeight;
            const gap = paidHeight > 0 && pendingHeight > 0 ? 2 : 0;
            const pendingVisible = Math.max(0, pendingHeight - gap);
            const dimmed = activeIndex !== null && activeIndex !== index;
            return (
              <g key={bucket.key} opacity={dimmed ? 0.55 : 1} className="transition-opacity">
                {paidHeight > 0 ? (
                  <path d={pendingVisible > 0 ? `M${x},${baseline} V${baseline - paidHeight} H${x + barWidth} V${baseline} Z` : roundedTopPath(x, baseline - paidHeight, barWidth, paidHeight, 4)} fill={SERIES_PAID} />
                ) : null}
                {pendingVisible > 0 ? (
                  <path d={roundedTopPath(x, baseline - paidHeight - gap - pendingVisible, barWidth, pendingVisible, 4)} fill={SERIES_PENDING} />
                ) : null}
                {index % labelEvery === 0 || index === buckets.length - 1 ? (
                  <text x={padding.left + slot * index + slot / 2} y={height - 8} textAnchor="middle" className="fill-[#898781] text-[11px]">
                    {bucket.shortLabel}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: 230 }} />
      )}

      {active ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 w-max min-w-[168px] -translate-x-1/2 rounded-lg border border-[#e3e5e1] bg-white px-3 py-2.5 text-[12px] shadow-[0_8px_24px_-8px_rgba(26,32,28,0.25)]"
          style={{ left: Math.min(Math.max(tooltipLeft, 90), Math.max(90, width - 90)) }}
        >
          <div className="font-medium text-[#616a64]">{active.label}</div>
          <div className="mt-1.5 space-y-1">
            {[
              { label: "Paid", value: active.paid, color: SERIES_PAID },
              { label: "Pending", value: active.pending, color: SERIES_PENDING },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-[#616a64]">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} aria-hidden="true" />
                  {row.label}
                </span>
                <span className="font-semibold tabular-nums text-[#1a201c]">{formatMoney(row.value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export default function DashboardOverview({
  firstName,
  loading,
  gigs,
  openGigs,
  applications,
  assignments,
  payoutBatches,
  payoutSummary,
  accountEarnings,
  earningsLoading,
  earningsError,
  socialAccounts,
  socialAccountsLoading,
  socialAccountsError,
  messages,
  unreadCount,
  profileChecklist,
  profileCompletion,
  onNavigate,
}: DashboardOverviewProps) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [chartView, setChartView] = useState<"chart" | "table">("chart");
  const [setupOpen, setSetupOpen] = useState(true);
  const [greeting, setGreeting] = useState("Welcome back");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
    setNow(Date.now());
  }, [payoutBatches, applications]);

  const rangeMeta = RANGES.find((item) => item.key === range) ?? RANGES[1];
  const rangeStart = rangeMeta.days ? now - rangeMeta.days * DAY_MS : 0;
  const previousStart = rangeMeta.days ? rangeStart - rangeMeta.days * DAY_MS : 0;
  const inRange = (time: number) => time >= rangeStart && time <= now;
  const inPrevious = (time: number) => rangeMeta.days !== null && time >= previousStart && time < rangeStart;
  const percentChange = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

  const gigById = useMemo(() => new Map(gigs.map((gig) => [String(gig.id), gig])), [gigs]);
  const sourceRows = useMemo(() => buildCreatorJobs(applications, assignments, gigById), [applications, assignments, gigById]);
  const jobCounts = useMemo(() => creatorJobCounts(sourceRows), [sourceRows]);

  const buckets = useMemo(() => buildBuckets(range, payoutBatches, now), [now, payoutBatches, range]);

  const metrics = useMemo(() => {
    const paidIn = (predicate: (time: number) => boolean) =>
      payoutBatches.filter((batch) => batchIsPaid(batch) && predicate(batchDate(batch))).reduce((sum, batch) => sum + batchTotal(batch), 0);
    const jobsIn = (predicate: (time: number) => boolean) => sourceRows.filter((job) => predicate(safeTime(job.startedAt))).length;

    const credited = payoutBatches.length ? paidIn(inRange) : payoutSummary.credited;
    const creditedPrevious = payoutBatches.length ? paidIn(inPrevious) : 0;
    const jobsCount = jobsIn(inRange);
    const previousJobsCount = jobsIn(inPrevious);

    return {
      credited,
      creditedDelta: payoutBatches.length && rangeMeta.days ? percentChange(credited, creditedPrevious) : null,
      jobsCount,
      jobsDelta: rangeMeta.days ? percentChange(jobsCount, previousJobsCount) : null,
      activeJobs: jobCounts.active,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceRows, jobCounts, now, payoutBatches, payoutSummary.credited, range]);

  const creditedTrend = useMemo(() => buckets.map((bucket) => bucket.paid), [buckets]);
  const jobTrend = useMemo(() => {
    return buckets.map((bucket) => sourceRows.filter((job) => {
      const time = safeTime(job.startedAt);
      return time >= bucket.start && time < bucket.end;
    }).length);
  }, [sourceRows, buckets]);

  const chartTotals = useMemo(
    () => buckets.reduce((sum, bucket) => ({ paid: sum.paid + bucket.paid, pending: sum.pending + bucket.pending }), { paid: 0, pending: 0 }),
    [buckets]
  );
  const chartHasData = chartTotals.paid + chartTotals.pending > 0;

  const workRows = sourceRows.slice(0, 6);
  const workTotal = sourceRows.length;
  const pipelineRows = CREATOR_JOB_GROUPS.map(group => ({ label: CREATOR_JOB_LABELS[group], value: jobCounts[group], color: group === "review" ? STATUS_WARNING : group === "closed" ? STATUS_CRITICAL : group === "submitted" ? "#6d9bbd" : STATUS_GOOD, icon: group === "closed" ? "✕" : group === "review" || group === "submitted" ? "•" : "✓" }));

  const recommendedGigs = useMemo(() => {
    const engaged = new Set(sourceRows.map(job => job.gigId));
    return openGigs.filter((gig) => !engaged.has(String(gig.id))).slice(0, 4);
  }, [sourceRows, openGigs]);

  const todoItems = useMemo(() => {
    const items: Array<{ key: string; icon: ReactNode; title: string; detail: string; section: OverviewSection; emphasis?: boolean }> = [];
    if (unreadCount > 0)
      items.push({ key: "messages", icon: <Icon.Inbox />, title: `${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`, detail: "Recruiter and payout updates", section: "messages", emphasis: true });
    const inProgress = jobCounts.active;
    if (inProgress > 0)
      items.push({ key: "work", icon: <Icon.Briefcase />, title: `${inProgress} ${inProgress === 1 ? "job" : "jobs"} ready to work on`, detail: "Open the brief and follow the next steps", section: "jobs", emphasis: true });
    if (jobCounts.review > 0)
      items.push({ key: "review", icon: <Icon.Clipboard />, title: `${jobCounts.review} ${jobCounts.review === 1 ? "job" : "jobs"} in review`, detail: "Track recruiter decisions", section: "jobs" });
    if (jobCounts.submitted > 0)
      items.push({ key: "submitted", icon: <Icon.Clipboard />, title: `${jobCounts.submitted} ${jobCounts.submitted === 1 ? "job" : "jobs"} awaiting work approval`, detail: "Track review and payout updates", section: "jobs" });
    if (payoutSummary.pending > 0)
      items.push({ key: "payout", icon: <Icon.Wallet />, title: `${formatMoney(payoutSummary.pending)} pending payout`, detail: `${payoutSummary.liveBatches || "No"} live ${payoutSummary.liveBatches === 1 ? "batch" : "batches"}`, section: "wallet" });
    if (profileCompletion < 100)
      items.push({ key: "profile", icon: <Icon.User />, title: "Finish your creator profile", detail: `${profileCompletion}% complete — brands see this first`, section: "profile" });
    return items;
  }, [jobCounts, payoutSummary.liveBatches, payoutSummary.pending, profileCompletion, unreadCount]);

  const recentActivity = messages.slice(0, 5);
  const completedSteps = profileChecklist.filter((item) => item.complete).length;
  const showSetupGuide = profileCompletion < 100 && profileChecklist.length > 0;
  const firstLoad = loading && gigs.length === 0 && applications.length === 0 && assignments.length === 0;

  const workTableId = useId();

  const renderTodoCard = (headingId: string) => (
    <Card aria-labelledby={headingId}>
        <CardHeader id={headingId} title="Things to do" description={todoItems.length ? `${todoItems.length} ${todoItems.length === 1 ? "item needs" : "items need"} your attention` : undefined} />
        {firstLoad ? (
          <div className="space-y-2 p-4 sm:px-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : todoItems.length === 0 ? (
          <div className="flex items-center gap-3 px-4 pb-4 pt-3 sm:px-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e3f1df] text-[#2e7d4f]">
              <Icon.Check className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[#1a201c]">You&apos;re all caught up</div>
              <div className="text-[12.5px] text-[#616a64]">New tasks and updates will appear here.</div>
            </div>
          </div>
        ) : (
          <ul className="mt-2 pb-2">
            {todoItems.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.section)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f7f8f6] focus-visible:bg-[#f5f7f4] focus-visible:outline-none sm:px-5"
                >
                  <span
                    className={cx(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      item.emphasis ? "bg-[#fdf0d2] text-[#8a5a00]" : "bg-[#eef1ed] text-[#4b544e]"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{item.title}</span>
                    <span className="block truncate text-[12px] text-[#7a827c]">{item.detail}</span>
                  </span>
                  <Icon.ChevronRight className="h-4 w-4 shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#4b544e]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
  );


  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 sm:space-y-5">
      {/* Page header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">
            {greeting}, {firstName}
          </h2>
          <p className="mt-0.5 text-[13px] text-[#616a64]">Here&apos;s how your creator business is performing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-[#d9ddd8] bg-white p-0.5 shadow-[0_1px_2px_rgba(26,32,28,0.06)]">
            {RANGES.map((item) => {
              const active = item.key === range;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={item.long}
                  title={item.long}
                  onClick={() => setRange(item.key)}
                  className={cx(
                    "h-8 min-w-[2.75rem] rounded-md px-2.5 text-[12.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
                    active ? "bg-[#1f2b24] text-white shadow-sm" : "text-[#4b544e] hover:bg-[#f1f3f0]"
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onNavigate("find")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-[#2b3a31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/50 focus-visible:ring-offset-2"
          >
            <Icon.Search className="h-4 w-4" />
            Find gigs
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
        <KpiTile
          label={accountEarnings ? accountEarnings.walletVerified ? "Credited earnings" : "Approved estimate" : "Earnings paid"}
          value={earningsError && !accountEarnings ? "–" : formatMoney(accountEarnings?.approved ?? metrics.credited)}
          caption={accountEarnings ? accountEarnings.walletVerified ? "Reel earnings credited to wallet" : "Approved reels · lifetime estimate" : earningsError ? "Earnings are unavailable" : payoutBatches.length ? rangeMeta.long.toLowerCase() : "lifetime"}
          delta={!accountEarnings && metrics.creditedDelta !== null ? { value: metrics.creditedDelta, goodWhenUp: true } : null}
          trend={!accountEarnings && payoutBatches.length ? creditedTrend : undefined}
          onClick={() => onNavigate("wallet")}
          loading={firstLoad || earningsLoading}
        />
        <KpiTile
          label={accountEarnings ? "Pending earnings" : "Pending payout"}
          value={earningsError && !accountEarnings ? "–" : formatMoney(accountEarnings?.pending ?? payoutSummary.pending)}
          caption={accountEarnings ? "Reels in review · lifetime estimate" : earningsError ? "Earnings are unavailable" : payoutSummary.liveBatches ? `${payoutSummary.liveBatches} live ${payoutSummary.liveBatches === 1 ? "batch" : "batches"}` : "current balance"}
          onClick={() => onNavigate("wallet")}
          loading={firstLoad || earningsLoading}
        />
        <KpiTile
          label="Active jobs"
          value={String(metrics.activeJobs)}
          caption="Ready to work on"
          onClick={() => onNavigate("jobs")}
          loading={firstLoad}
        />
        <KpiTile
          label="Jobs"
          value={String(range === "all" ? workTotal : metrics.jobsCount)}
          caption={rangeMeta.long.toLowerCase()}
          delta={metrics.jobsDelta !== null ? { value: metrics.jobsDelta, goodWhenUp: true } : null}
          trend={workTotal ? jobTrend : undefined}
          onClick={() => onNavigate("jobs")}
          loading={firstLoad}
        />
      </div>

      {/* Phones and tablets: the action list comes right after the KPIs */}
      <div className="lg:hidden">{renderTodoCard("overview-todo-compact")}</div>

      <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <AccountPerformanceCard
            accounts={socialAccounts}
            loading={socialAccountsLoading}
            error={socialAccountsError}
            rangeDays={rangeMeta.days}
            rangeLabel={rangeMeta.long}
            now={now}
            onOpen={() => onNavigate("accounts")}
          />

          {/* Earnings */}
          <Card aria-labelledby="overview-earnings">
            <CardHeader
              id="overview-earnings"
              title="Payouts"
              description={rangeMeta.long}
              action={
                <div role="radiogroup" aria-label="Payouts view" className="inline-flex rounded-md border border-[#e3e5e1] p-0.5">
                  {(["chart", "table"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      role="radio"
                      aria-checked={chartView === view}
                      aria-label={view === "chart" ? "Chart view" : "Table view"}
                      title={view === "chart" ? "Chart view" : "Table view"}
                      onClick={() => setChartView(view)}
                      className={cx(
                        "inline-flex h-7 w-8 items-center justify-center rounded text-[#616a64] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
                        chartView === view ? "bg-[#f1f3f0] text-[#1a201c]" : "hover:bg-[#f7f8f6]"
                      )}
                    >
                      {view === "chart" ? <Icon.Chart /> : <Icon.Table />}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3 px-4 sm:px-5">
              <div>
                <div className="text-[12px] text-[#616a64]">Total in period</div>
                <div className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#1a201c]">{formatMoney(chartTotals.paid + chartTotals.pending)}</div>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 pb-1 text-[12.5px]" aria-label="Legend">
                {[
                  { label: "Paid", value: chartTotals.paid, color: SERIES_PAID },
                  { label: "Pending", value: chartTotals.pending, color: SERIES_PENDING },
                ].map((item) => (
                  <li key={item.label} className="flex items-center gap-2 text-[#616a64]">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
                    {item.label}
                    <span className="font-semibold tabular-nums text-[#1a201c]">{formatMoney(item.value)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-2 pb-3 pt-2 sm:px-3 sm:pb-4">
              {firstLoad ? (
                <Skeleton className="mx-2 h-[200px]" />
              ) : !chartHasData ? (
                <div className="mx-2 flex h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-[#dfe2de] bg-[#fafbf9] px-6 text-center">
                  <Icon.Wallet className="h-6 w-6 text-[#9aa29c]" />
                  <div className="mt-2 text-[13.5px] font-semibold text-[#1a201c]">No payouts in this period</div>
                  <p className="mt-1 max-w-[42ch] text-[12.5px] text-[#616a64]">Completed assignments are batched into payout cycles and show up here.</p>
                  {range !== "all" ? (
                    <button type="button" onClick={() => setRange("all")} className="mt-3 text-[12.5px] font-semibold text-[#2b5d4a] hover:underline">
                      View all time
                    </button>
                  ) : null}
                </div>
              ) : chartView === "chart" ? (
                <EarningsChart buckets={buckets} rangeLabel={rangeMeta.long} />
              ) : (
                <div className="max-h-[260px] overflow-auto px-2">
                  <table className="w-full text-[12.5px]">
                    <caption className="sr-only">Payouts by period, {rangeMeta.long.toLowerCase()}</caption>
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-[#ebedea] text-left text-[#616a64]">
                        <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">Paid</th>
                        <th scope="col" className="py-2 text-right font-medium">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets
                        .filter((bucket) => bucket.paid + bucket.pending > 0)
                        .map((bucket) => (
                          <tr key={bucket.key} className="border-b border-[#f2f3f1] last:border-0">
                            <th scope="row" className="py-2 pr-3 text-left font-normal text-[#1a201c]">{bucket.label}</th>
                            <td className="py-2 pr-3 text-right tabular-nums text-[#1a201c]">{formatMoney(bucket.paid)}</td>
                            <td className="py-2 text-right tabular-nums text-[#1a201c]">{formatMoney(bucket.pending)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* The layout follows this card's width, including beside the desktop rail. */}
          <Card aria-labelledby={workTableId} className="@container/work overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebedea] px-4 py-3.5 @[560px]/work:px-5">
              <h2 id={workTableId} className="text-[14px] font-semibold text-[#1a201c]">Recent work</h2>
              <span className="text-[11.5px] text-[#7a827c]">Newest updates first</span>
            </div>

            <div>
              {firstLoad ? (
                <div className="space-y-3 p-4 sm:p-5">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : workRows.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <Icon.Briefcase className="h-6 w-6 text-[#9aa29c]" />
                  <div className="mt-2 text-[13.5px] font-semibold text-[#1a201c]">
                    No jobs yet
                  </div>
                  <p className="mt-1 max-w-[44ch] text-[12.5px] text-[#616a64]">
                    Your gigs will appear here with their latest status and payout.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate("find")}
                    className="mt-3 inline-flex h-8 items-center rounded-lg border border-[#d9ddd8] bg-white px-3 text-[12.5px] font-semibold text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] hover:bg-[#f7f8f6]"
                  >
                    Browse gigs
                  </button>
                </div>
              ) : (
                <>
                  <div className="hidden @[640px]/work:block">
                    <table className="w-full table-fixed text-[13px]">
                      <caption className="sr-only">Recent jobs, newest updates first</caption>
                      <thead>
                        <tr className="border-b border-[#ebedea] bg-[#fafbf9] text-left text-[12px] text-[#616a64]">
                          <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">Gig</th>
                          <th scope="col" className="w-[92px] px-3 py-2.5 font-medium">Platform</th>
                          <th scope="col" className="w-[132px] px-3 py-2.5 font-medium">Status</th>
                          <th scope="col" className="w-[108px] px-3 py-2.5 text-right font-medium">Payout</th>
                          <th scope="col" className="w-[88px] py-2.5 pl-3 pr-5 text-right font-medium">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workRows.map((row) => (
                          <tr
                            key={row.key}
                            className="border-b border-[#f2f3f1] transition last:border-0 hover:bg-[#fafbf9] focus-within:bg-[#f5f7f4]"
                          >
                            <td className="py-3 pl-5 pr-3">
                              <button
                                type="button"
                                onClick={() => row.assignment ? onNavigate("jobs") : onNavigate("find", { gigId: row.gigId, intent: "details" })}
                                aria-label={`View ${row.gig?.title ?? "gig"}`}
                                className="group flex w-full min-w-0 items-center gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2e7d4f]"
                              >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef1ed] text-[11px] font-bold text-[#2b5d4a]" aria-hidden="true">{getInitials(row.gig?.company ?? "?")}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="line-clamp-2 break-words font-semibold text-[#1a201c] group-hover:underline">{row.gig?.title ?? "Gig unavailable"}</span>
                                  <span className="mt-0.5 block truncate text-[12px] text-[#7a827c]">{row.gig?.company ?? "—"}</span>
                                </span>
                              </button>
                            </td>
                            <td className="break-words px-3 py-3 text-[12px] text-[#4b544e]">{row.gig?.platform ?? "—"}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={row.status} />
                            </td>
                            <td className="px-3 py-3 text-right text-[#1a201c]"><JobPayout gig={row.gig} stacked /></td>
                            <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right text-[#7a827c]">{formatRelative(row.date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul aria-label="Recent jobs" className="divide-y divide-[#f0f1ef] @[640px]/work:hidden">
                    {workRows.map((row) => (
                      <li key={row.key}>
                        <button
                          type="button"
                          onClick={() => (row.assignment ? onNavigate("jobs") : onNavigate("find", { gigId: row.gigId, intent: "details" }))}
                          aria-label={`View ${row.gig?.title ?? "gig"}`}
                          className="flex w-full min-w-0 items-start gap-3 px-4 py-3.5 text-left transition hover:bg-[#fafbf9] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e7d4f] active:bg-[#f5f7f4]"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef1ed] text-[12px] font-bold text-[#2b5d4a]" aria-hidden="true">
                            {getInitials(row.gig?.company ?? "?")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 break-words text-[13.5px] font-semibold leading-5 text-[#1a201c]">{row.gig?.title ?? "Gig unavailable"}</span>
                            <span className="mt-0.5 block break-words text-[12px] text-[#7a827c]">{row.gig?.company ?? "—"} · {row.gig?.platform ?? "—"}</span>
                            <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <StatusBadge status={row.status} />
                              <span className="text-[11.5px] text-[#7a827c]">{formatRelative(row.date)}</span>
                            </span>
                            <span className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-[#1a201c]">
                              <JobPayout gig={row.gig} />
                              <Icon.ChevronRight className="h-4 w-4 shrink-0 text-[#7a827c]" />
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {workRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#ebedea] px-4 py-2.5 text-[11.5px] text-[#7a827c]">
                <span>Showing {workRows.length} of {workTotal}</span>
                <LinkButton onClick={() => onNavigate("jobs")}>
                  View all jobs
                  <Icon.ChevronRight className="h-3.5 w-3.5" />
                </LinkButton>
              </div>
            ) : null}
          </Card>
        </div>

        {/* Side rail: stacks under the main column on phones, pairs up on tablets */}
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
          {/* Things to do (desktop rail) */}
          <div className="hidden lg:block">{renderTodoCard("overview-todo")}</div>

          {/* Setup guide */}
          {showSetupGuide ? (
            <Card aria-labelledby="overview-setup">
              <button
                type="button"
                onClick={() => setSetupOpen((open) => !open)}
                aria-expanded={setupOpen}
                aria-controls="overview-setup-list"
                className="flex w-full items-start justify-between gap-3 px-4 pt-4 text-left sm:px-5"
              >
                <span className="min-w-0">
                  <span id="overview-setup" className="block text-[14px] font-semibold text-[#1a201c]">
                    Setup guide
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-[#616a64]">
                    {completedSteps} of {profileChecklist.length} tasks complete
                  </span>
                </span>
                <Icon.ChevronDown className={cx("mt-0.5 h-4 w-4 shrink-0 text-[#7a827c] transition-transform", setupOpen && "rotate-180")} />
              </button>
              <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-[#e3efe2] sm:mx-5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={profileCompletion} aria-label="Profile completion">
                <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-700" style={{ width: `${profileCompletion}%` }} />
              </div>
              {setupOpen ? (
                <ul id="overview-setup-list" className="mt-2 pb-3">
                  {profileChecklist.map((item) => (
                    <li key={item.label}>
                      <button
                        type="button"
                        onClick={() => onNavigate("profile")}
                        disabled={item.complete}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition enabled:hover:bg-[#f7f8f6] disabled:cursor-default sm:px-5"
                      >
                        <span
                          className={cx(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                            item.complete ? "bg-[#1f2b24] text-white" : "border-[1.5px] border-dashed border-[#a9b0aa]"
                          )}
                        >
                          {item.complete ? <Icon.Check className="h-3 w-3" /> : null}
                        </span>
                        <span className={cx("flex-1 text-[13px]", item.complete ? "text-[#7a827c] line-through decoration-[#c5cac6]" : "font-medium text-[#1a201c]")}>{item.label}</span>
                        {!item.complete ? <Icon.ChevronRight className="h-3.5 w-3.5 text-[#a3aaa4]" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="h-4" />
              )}
            </Card>
          ) : null}

          {/* Job pipeline */}
          <Card aria-labelledby="overview-pipeline">
            <CardHeader
              id="overview-pipeline"
              title="Job pipeline"
              description={workTotal ? `${workTotal} total` : "No jobs yet"}
              action={<LinkButton onClick={() => onNavigate("jobs")}>View</LinkButton>}
            />
            <div className="px-4 pb-4 pt-3 sm:px-5">
              {workTotal > 0 ? (
                <>
                  <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#eef0ed]" role="img" aria-label={pipelineRows.map(row => `${row.value} ${row.label.toLowerCase()}`).join(", ")}>
                    {pipelineRows
                      .filter((segment) => segment.value > 0)
                      .map((segment, index) => (
                        <span key={index} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(segment.value / workTotal) * 100}%`, background: segment.color }} />
                      ))}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-[12.5px]">
                    {pipelineRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3">
                        <dt className="flex items-center gap-2 text-[#4b544e]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: row.color }} aria-hidden="true">
                            {row.icon}
                          </span>
                          {row.label}
                        </dt>
                        <dd className="tabular-nums text-[#1a201c]">
                          <span className="font-semibold">{row.value}</span>
                          <span className="ml-1.5 text-[#9aa29c]">{Math.round((row.value / workTotal) * 100)}%</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="text-[12.5px] text-[#616a64]">Track your jobs from review to completion here.</p>
              )}
            </div>
          </Card>

          {/* Recommended gigs */}
          <Card aria-labelledby="overview-recommended">
            <CardHeader
              id="overview-recommended"
              title="Recommended gigs"
              description={openGigs.length ? `${openGigs.length} open on Reelencer` : undefined}
              action={<LinkButton onClick={() => onNavigate("find")}>Browse</LinkButton>}
            />
            {firstLoad ? (
              <div className="space-y-2 p-4 sm:px-5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full" />
                ))}
              </div>
            ) : recommendedGigs.length ? (
              <ul className="mt-2 pb-2">
                {recommendedGigs.map((gig) => (
                  <li key={gig.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate("find", { gigId: gig.id, intent: "details" })}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f7f8f6] sm:px-5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[12px] font-bold text-[#2b5d4a]" aria-hidden="true">
                        {getInitials(gig.company)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{gig.title}</span>
                        <span className="block truncate text-[12px] text-[#7a827c]">
                          {gig.company} · {gig.platform}
                        </span>
                      </span>
                      <span className="max-w-[40%] shrink-0 truncate text-right text-[12.5px] font-semibold text-[#1a201c]">{gig.payout}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 pt-2 text-[12.5px] text-[#616a64] sm:px-5">You&apos;ve engaged with every open gig. New listings will show up here.</p>
            )}
          </Card>

          {/* Activity */}
          <Card aria-labelledby="overview-activity" className={cx(!showSetupGuide && "md:col-span-2 lg:col-span-1")}>
            <CardHeader id="overview-activity" title="Recent activity" action={<LinkButton onClick={() => onNavigate("messages")}>Inbox</LinkButton>} />
            {recentActivity.length ? (
              <ol className="relative mx-4 mb-4 mt-3 space-y-3 border-l border-[#e6e8e4] pl-4 sm:mx-5">
                {recentActivity.map((item) => (
                  <li key={item.id} className="relative">
                    <span
                      className={cx("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", item.unread ? "bg-[#d99a06]" : "bg-[#c5cbc6]")}
                      aria-hidden="true"
                    />
                    <button type="button" onClick={() => onNavigate("messages")} className="block w-full text-left">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cx("truncate text-[13px]", item.unread ? "font-semibold text-[#1a201c]" : "text-[#2f3832]")}>{item.title}</span>
                        <span className="shrink-0 text-[11.5px] text-[#9aa29c]">{formatRelative(item.timestamp)}</span>
                      </span>
                      <span className="block truncate text-[12px] text-[#7a827c]">{item.preview}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 pb-4 pt-2 text-[12.5px] text-[#616a64] sm:px-5">Updates on jobs and payouts will appear here.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
