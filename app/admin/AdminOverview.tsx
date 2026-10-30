"use client";

import { useCallback, useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/api/client";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { useAdminLive, type AdminLiveKind } from "@/lib/useAdminLive";
import { ACTIVITY_PERIODS, activityChange, activityCsv, isAdminActivity, type ActivityDay, type ActivityKind, type ActivityPeriod, type AdminActivity, type AdminOverviewCounts } from "@/lib/adminOverview";
import type { AdminSection } from "@/lib/adminNavigation";
import AdminUpiQueue from "./AdminUpiQueue";
import styles from "./AdminOverview.module.css";

const number = (value: number) => value.toLocaleString("en-IN");
const dateLabel = (date: string, full = false) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: full ? "long" : "short", ...(full ? { year: "numeric" } : {}), timeZone: "Asia/Kolkata" }).format(new Date(date.length === 10 ? `${date}T12:00:00+05:30` : date));
type Glyph = "users" | "pulse" | "link" | "wallet" | "arrow" | "refresh" | "download" | "check" | "reel" | "application" | "shield" | "plus";
function Glyph({ name, className }: { name: Glyph; className?: string }) {
  const paths: Record<Glyph, ReactNode> = {
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-3-5.2" /></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    link: <><path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0)" /></>,
    wallet: <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V5a2 2 0 0 1 2-2h12v3m4 5h-5v5h5m-3-2.5h.01" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />,
    check: <path d="m5 12 4 4L19 6" />,
    reel: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M7 4l3 5m4-5 3 5m-7 4 5 3-5 3z" /></>,
    application: <><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M9 3h6v4H9zM8 12h8m-8 4h5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Metric = "users" | "actions" | "signups";
const metrics: Array<{ id: Metric; label: string }> = [{ id: "users", label: "Active users" }, { id: "actions", label: "Actions" }, { id: "signups", label: "New users" }];
type Series = { label: string; color: string; values: number[] };
function chartSeries(days: ActivityDay[], metric: Metric): Series[] {
  if (metric === "users") return [{ label: "Active users", color: "#2e7d57", values: days.map(day => day.activeUsers) }];
  if (metric === "signups") return [{ label: "New users", color: "#6674b7", values: days.map(day => day.newUsers) }];
  return [
    { label: "Applications", color: "#6877ba", values: days.map(day => day.applications) },
    { label: "Reel submissions", color: "#2e8b80", values: days.map(day => day.reels) },
    { label: "Earnings requests", color: "#c38c36", values: days.map(day => day.claims + day.withdrawals) },
  ];
}

function ActivityChart({ days, metric }: { days: ActivityDay[]; metric: Metric }) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  const series = chartSeries(days, metric);
  const maximum = Math.max(1, ...series.flatMap(item => item.values));
  const step = Math.max(1, Math.ceil(maximum / 4));
  const top = step * 4;
  const x = (index: number) => index / Math.max(1, days.length - 1) * 1000;
  const y = (value: number) => 234 - value / top * 224;
  const line = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
  const empty = series.every(item => item.values.every(value => value === 0));
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setSelected(null);
    setSelected(index => event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : Math.min(days.length - 1, Math.max(0, (index ?? days.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
  };
  return <>
    <div className={styles.chartFrame}>
      <div className={styles.yAxis} aria-hidden="true">{[4, 3, 2, 1, 0].map(tick => <span key={tick}>{number(tick * step)}</span>)}</div>
      <div className={styles.plot} tabIndex={0} role="group" aria-label="User activity chart. Use left and right arrows to explore daily values."
        onKeyDown={keyDown} onFocus={() => setSelected(days.length - 1)} onBlur={() => setSelected(null)}
        onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setSelected(Math.max(0, Math.min(days.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (days.length - 1))))); }}
        onPointerLeave={() => { if (document.activeElement?.getAttribute("aria-label") !== "User activity chart. Use left and right arrows to explore daily values.") setSelected(null); }}>
        <svg viewBox="0 0 1000 244" preserveAspectRatio="none" className={styles.chartSvg} aria-hidden="true">
          <defs>{series.map((item, index) => <linearGradient key={item.label} id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".18" /><stop offset="100%" stopColor={item.color} stopOpacity=".015" /></linearGradient>)}</defs>
          {[0, 1, 2, 3, 4].map(tick => <line key={tick} x1="0" x2="1000" y1={y(tick * step)} y2={y(tick * step)} stroke="#edf0ec" vectorEffect="non-scaling-stroke" strokeDasharray={tick ? "3 5" : undefined} />)}
          {series.map((item, index) => <g key={item.label}>
            {series.length === 1 ? <path d={`${line(item.values)} L1000,234 L0,234 Z`} fill={`url(#${id}-${index})`} /> : null}
            <path d={line(item.values)} fill="none" stroke={item.color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>)}
          {selected !== null ? <>
            <line x1={x(selected)} x2={x(selected)} y1="0" y2="244" stroke="#b5beb6" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          </> : null}
        </svg>
        {selected !== null ? series.map(item => <span key={item.label} className={styles.point} style={{ left: `${selected / Math.max(1, days.length - 1) * 100}%`, top: `${y(item.values[selected]) / 244 * 100}%`, borderColor: item.color }} />) : null}
        {empty && selected === null ? <div className={styles.chartEmpty}><span>No {metric === "signups" ? "new users" : "recorded activity"} in this period</span><small>Choose a longer period to explore earlier activity.</small></div> : null}
        {selected !== null ? <div className={styles.tooltip} style={{ left: `clamp(94px, ${selected / Math.max(1, days.length - 1) * 100}%, calc(100% - 94px))` }}>
          <strong>{dateLabel(days[selected].date, true)}</strong>
          {series.map(item => <span key={item.label}><i style={{ background: item.color }} />{item.label}<b>{number(item.values[selected])}</b></span>)}
        </div> : null}
      </div>
      <div className={styles.xAxis} aria-hidden="true">{[0, .25, .5, .75, 1].map((fraction, index) => <span key={index} className={index % 2 ? styles.optionalTick : undefined}>{dateLabel(days[Math.round(fraction * (days.length - 1))].date)}</span>)}</div>
    </div>
    <div className={styles.legend}>{series.map(item => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>
    <span className={styles.srOnly} aria-live="polite">{selected !== null ? `${dateLabel(days[selected].date, true)}. ${series.map(item => `${item.label}: ${item.values[selected]}`).join(". ")}` : "Explore the chart with the arrow keys or view the daily data table."}</span>
  </>;
}

function Delta({ current, previous, days }: { current: number; previous: number; days: number }) {
  const change = activityChange(current, previous);
  return <span className={`${styles.delta} ${change.direction === "up" ? styles.deltaUp : change.direction === "down" ? styles.deltaDown : ""}`} title={`Compared with the previous ${days} days`}>
    {change.direction === "up" ? "↗" : change.direction === "down" ? "↘" : "—"} {change.label}<span className={styles.deltaContext}> vs previous {days} days</span>
  </span>;
}

const activityLabels: Record<ActivityKind, { text: string; icon: Glyph; section: AdminSection }> = {
  signup: { text: "joined Reelencer", icon: "users", section: "Workers" },
  application: { text: "applied to a gig", icon: "application", section: "applications" },
  reel: { text: "submitted a reel", icon: "reel", section: "linked-accounts" },
  claim: { text: "requested earnings review", icon: "wallet", section: "Payouts" },
  withdrawal: { text: "requested a withdrawal", icon: "wallet", section: "Payouts" },
};

export default function AdminOverview({ adminId, counts, countsUpdatedAt, onCounts, onNavigate, onRefreshCounts }: {
  adminId: string; counts?: AdminOverviewCounts; countsUpdatedAt: number | null; onCounts: (counts: AdminOverviewCounts) => void;
  onNavigate: (section: AdminSection, workerCode?: string) => void; onRefreshCounts: () => void;
}) {
  const [period, setPeriod] = useState<ActivityPeriod>(30);
  const [metric, setMetric] = useState<Metric>("users");
  const read = useCallback(async (signal: AbortSignal) => {
    const response = await apiFetch(`/api/admin/activity?days=${period}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const data: unknown = await response.json();
    if (!response.ok || !isAdminActivity(data) || data.period.days !== period) throw new Error("User activity could not be refreshed.");
    return data;
  }, [period]);
  const resource = useAdminCachedResource<AdminActivity>({ scope: adminId, key: `overview-activity:v1:${period}`, load: read, ttlMs: 15_000, persist: true, validate: isAdminActivity });
  const refresh = resource.refresh;
  useAdminLive(true, kinds => {
    if (!kinds || ["gig_applications", "linked_social_accounts", "social_account_posts", "view_payout_claims", "payout_batches", "worker_kyc", "worker_moderation", "worker_deletion_jobs"].some(kind => kinds.has(kind as AdminLiveKind))) void refresh({ afterCurrent: true });
  }, { refreshOnConnect: false });
  useEffect(() => {
    const update = () => { void refresh({ afterCurrent: true }); };
    const events = ["admin-overview-refresh", "view-payout-claims-updated", "admin-linked-accounts-refresh"];
    events.forEach(event => window.addEventListener(event, update));
    return () => events.forEach(event => window.removeEventListener(event, update));
  }, [refresh]);
  const data = resource.data;
  useEffect(() => {
    // A cached historical range must not replace counts refreshed after a review or payment.
    if (data && !resource.stale && resource.updatedAt && (!countsUpdatedAt || resource.updatedAt > countsUpdatedAt)) onCounts(data.counts);
  }, [data, resource.stale, resource.updatedAt, countsUpdatedAt, onCounts]);
  const totals = counts && countsUpdatedAt && countsUpdatedAt > (resource.updatedAt ?? 0) ? counts : data?.counts ?? counts;
  const summary = data?.summary;
  const previous = data?.previous;
  const refreshAll = () => { onRefreshCounts(); window.dispatchEvent(new Event("admin-overview-refresh")); };
  const attention = data?.queues;
  const queues: Array<{ label: string; description: string; count: number | undefined; icon: Glyph; section: AdminSection }> = [
    { label: "Applications", description: "Awaiting a hiring decision", count: attention?.applications, icon: "application", section: "applications" },
    { label: "Identity checks", description: "Ready for verification", count: attention?.identityChecks, icon: "shield", section: "kyc-review" },
    { label: "Reel submissions", description: "Waiting for a review", count: attention?.reels, icon: "reel", section: "linked-accounts" },
    { label: "Account corrections", description: "Profiles needing attention", count: attention?.profiles, icon: "link", section: "linked-accounts" },
    { label: "Earnings claims", description: "Review before crediting earnings", count: totals?.pendingClaims, icon: "wallet", section: "Payouts" },
    { label: "Withdrawals", description: "Awaiting approval or payment", count: totals?.pendingWithdrawals, icon: "wallet", section: "Payouts" },
  ];
  const breakdown = [
    { label: "Applications", value: summary?.applications ?? 0, color: "#6877ba", icon: "application" as Glyph, section: "applications" as AdminSection },
    { label: "Reel submissions", value: summary?.reels ?? 0, color: "#2e8b80", icon: "reel" as Glyph, section: "linked-accounts" as AdminSection },
    { label: "Earnings requests", value: (summary?.claims ?? 0) + (summary?.withdrawals ?? 0), color: "#c38c36", icon: "wallet" as Glyph, section: "Payouts" as AdminSection },
  ];
  const metricKey = metric === "users" ? "activeUsers" : metric === "signups" ? "newUsers" : "actions";
  const exportData = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", activityCsv(data)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `reelencer-activity-${data.period.start}-${data.period.end}.csv`; anchor.style.display = "none";
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className={styles.overview} aria-label="Platform activity overview">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>YOUR PLATFORM, AT A GLANCE</span><h2>Overview</h2><p>Understand user activity and keep your creator operations moving.</p></div>
      <div className={styles.headingActions}><button type="button" className={styles.secondaryButton} onClick={() => onNavigate("Workers")}><Glyph name="users" />Manage users</button><button type="button" className={styles.primaryButton} onClick={() => onNavigate("create-new-gig")}><Glyph name="plus" />Create gig</button></div>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.period} role="group" aria-label="Activity period">{ACTIVITY_PERIODS.map(days => <button key={days} type="button" aria-pressed={days === period} onClick={() => setPeriod(days)}>{days} days</button>)}</div>
      <div className={styles.freshness}><span className={styles.statusDot} />{resource.refreshing ? "Updating…" : data ? `Updated ${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(data.generatedAt))} IST` : resource.error ? "Update unavailable" : "Loading activity…"}<button type="button" onClick={refreshAll} disabled={resource.refreshing} aria-label="Refresh overview" title="Refresh overview"><Glyph name="refresh" /></button></div>
    </div>
    {resource.error ? <div role="status" className={styles.notice}><span>{data ? "Showing saved activity. The latest update could not be loaded." : "User activity is temporarily unavailable. Your other admin tools are ready to use."}</span><button type="button" onClick={refreshAll}>Try again</button></div> : null}
    <div className={styles.stats}>
      {([
        { label: "Total users", value: data?.totalUsers, icon: "users" as Glyph, description: summary ? `${number(summary.newUsers)} joined · ${period} days` : "Creator accounts on the platform", section: "Workers" as AdminSection, growth: null },
        { label: "Active users", value: summary?.activeUsers, icon: "pulse" as Glyph, description: `Joined or took action · ${period} days`, section: "Workers" as AdminSection, growth: summary && previous ? { current: summary.activeUsers, previous: previous.activeUsers } : null },
        { label: "Linked accounts", value: totals?.linkedAccounts, icon: "link" as Glyph, description: "Active and paused profiles", section: "linked-accounts" as AdminSection, growth: null },
        { label: "Pending payouts", value: totals?.pendingPayouts, icon: "wallet" as Glyph, description: totals ? `${number(totals.pendingClaims)} claim${totals.pendingClaims === 1 ? "" : "s"} · ${number(totals.pendingWithdrawals)} withdrawal${totals.pendingWithdrawals === 1 ? "" : "s"}` : "Earnings claims and withdrawals", section: "Payouts" as AdminSection, growth: null },
      ]).map((stat, index) => <button key={stat.label} type="button" className={`${styles.stat} ${index === 1 ? styles.featuredStat : ""}`} title={`View ${stat.label.toLowerCase()}`} aria-busy={stat.value === undefined && resource.loading || undefined} onClick={() => onNavigate(stat.section)}>
        <span className={styles.statTop}><span className={styles.statLabel}><span className={styles.statIcon}><Glyph name={stat.icon} /></span><span>{stat.label}</span></span><Glyph name="arrow" className={styles.statArrow} /></span>
        <span className={styles.statValue}><strong>{stat.value === undefined ? "–" : number(stat.value)}</strong>{stat.growth ? <Delta {...stat.growth} days={period} /> : null}</span>
        <span className={styles.statDescription}>{stat.description}</span>
      </button>)}
    </div>
    <AdminUpiQueue adminId={adminId} onOpenCreator={code => onNavigate("Workers", code || undefined)} />
    <div className={styles.mainGrid}>
      <section className={`${styles.card} ${styles.activityCard}`} aria-labelledby="admin-activity-title">
        <div className={styles.cardHeading}><div><h3 id="admin-activity-title">User activity</h3><p>{data ? `${dateLabel(data.period.start)} – ${dateLabel(data.period.end, true)}` : `Last ${period} days`}<span className={styles.dotSeparator}>·</span>Daily activity in IST</p></div><button type="button" className={styles.exportButton} aria-label="Export CSV" onClick={exportData} disabled={!data}><Glyph name="download" /><span>Export CSV</span></button></div>
        <div className={styles.chartToolbar}><div className={styles.chartMetric}><strong>{summary ? number(summary[metricKey]) : "–"}</strong><span>{metrics.find(item => item.id === metric)?.label.toLowerCase()} in this period</span>{summary && previous ? <Delta current={summary[metricKey]} previous={previous[metricKey]} days={period} /> : null}</div>
          <div className={styles.metricTabs} role="group" aria-label="Chart metric">{metrics.map(item => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div>
        </div>
        {data ? <ActivityChart key={`${period}-${metric}`} days={data.days} metric={metric} /> : <div className={styles.chartLoading} aria-busy={resource.loading}><Glyph name="pulse" /><span>{resource.error ? "Activity chart unavailable" : "Loading your activity…"}</span></div>}
        <div className={styles.chartNote}>Active users are unique people who joined, applied, submitted a reel or requested earnings. The current day updates as activity is recorded.</div>
        {data ? <details className={styles.dataDisclosure}><summary>View daily data<span>Accessible table</span></summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Daily user activity data"><table><caption className={styles.srOnly}>Daily user activity in Asia/Kolkata</caption><thead><tr><th scope="col">Date</th><th scope="col">Users</th><th scope="col">New users</th><th scope="col">Applications</th><th scope="col">Reels</th><th scope="col">Earnings requests</th></tr></thead><tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{dateLabel(day.date)}</th><td>{number(day.activeUsers)}</td><td>{number(day.newUsers)}</td><td>{number(day.applications)}</td><td>{number(day.reels)}</td><td>{number(day.claims + day.withdrawals)}</td></tr>)}</tbody></table></div></details> : null}
      </section>
      <section className={`${styles.card} ${styles.attentionCard}`} aria-labelledby="admin-attention-title"><div className={styles.cardHeading}><div><h3 id="admin-attention-title">Needs attention</h3><p>Your current review queues</p></div><span className={styles.attentionIcon}><Glyph name="shield" /></span></div>
        <div className={styles.queueList}>{queues.map(queue => <button key={queue.label} type="button" className={styles.queue} onClick={() => onNavigate(queue.section)}><span className={styles.queueIcon}><Glyph name={queue.icon} /></span><span className={styles.queueText}><strong>{queue.label}</strong><small>{queue.description}</small></span><span className={`${styles.queueCount} ${queue.count ? styles.queuePending : ""}`}>{queue.count === undefined ? "–" : number(queue.count)}</span><Glyph name="arrow" /></button>)}</div>
      </section>
    </div>
    <div className={styles.bottomGrid}>
      <section className={styles.card} aria-labelledby="admin-breakdown-title"><div className={styles.cardHeading}><div><h3 id="admin-breakdown-title">Activity breakdown</h3><p>How users engaged over the last {period} days</p></div><span className={styles.cardTotal}>{summary ? number(summary.actions) : "–"}<small>recorded actions</small></span></div>
        <div className={styles.breakdown}>{breakdown.map(item => { const share = summary?.actions ? Math.round(item.value / summary.actions * 100) : 0; return <button key={item.label} type="button" onClick={() => onNavigate(item.section)} className={styles.breakdownRow} style={{ "--series-color": item.color } as CSSProperties}><span className={styles.breakdownLabel}><Glyph name={item.icon} /><strong>{item.label}</strong><b>{summary ? number(item.value) : "–"}</b><small>{summary ? `${share}%` : "–"}</small></span><span className={styles.track}><span style={{ width: `${share}%` }} /></span></button>; })}</div>
        <div className={styles.signupNote}><span className={styles.signupIcon}><Glyph name="users" /></span><span><strong>{summary ? number(summary.newUsers) : "–"} new user{summary?.newUsers === 1 ? "" : "s"}</strong><small>Joined Reelencer during this period</small></span><button type="button" onClick={() => onNavigate("Workers")} aria-label="View users"><Glyph name="arrow" /></button></div>
      </section>
      <section className={styles.card} aria-labelledby="admin-recent-title"><div className={styles.cardHeading}><div><h3 id="admin-recent-title">Recent activity</h3><p>The latest actions across your platform</p></div><span className={styles.liveTag}><i />Updated automatically</span></div>
        <div className={styles.recentList}>{data?.recent.length ? data.recent.slice(0, 6).map(event => { const label = activityLabels[event.kind]; return <button key={event.id} type="button" className={styles.recent} onClick={() => onNavigate(label.section, event.kind === "signup" ? event.workerCode : undefined)}><span className={styles.recentIcon}><Glyph name={label.icon} /></span><span className={styles.recentText}><strong>{event.userName}</strong><span>{label.text}</span></span><time dateTime={event.at} title={dateLabel(event.at, true)}>{dateLabel(event.at)}<small>{new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(event.at))}</small></time></button>; }) : <div className={styles.feedEmpty}><Glyph name="pulse" /><strong>{resource.loading ? "Loading recent activity…" : resource.error && !data ? "Activity unavailable" : "No activity in this period"}</strong><span>Sign-ups and creator actions will appear here.</span></div>}</div>
      </section>
    </div>
  </div>;
}
