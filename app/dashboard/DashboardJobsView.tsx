"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { buildCreatorJobs, creatorJobCounts, CREATOR_JOB_GROUPS, CREATOR_JOB_LABELS, CREATOR_JOB_STEPS, type CreatorJob, type CreatorJobAssignment, type CreatorJobGroup } from "@/lib/creatorJobs";
import {
  Button,
  Card,
  EmptyState,
  FilterTabs,
  Icon,
  JobPayout,
  MetricTile,
  PageHeader,
  SearchField,
  Skeleton,
  StatusBadge,
  buttonClassName,
  cx,
  formatMoney,
  formatRelative,
  getInitials,
  safeTime,
} from "./dashboardUi";

type JobsSection = "profile" | "dashboard" | "jobs" | "find" | "messages" | "wallet";

type JobsGig = {
  id: string;
  title: string;
  company: string;
  platform: string;
  payout: string;
  payoutType?: string;
  location: string;
  workload?: string;
  verified?: boolean;
  gigType?: string;
};

type JobsAssignmentEntry = {
  assignment: CreatorJobAssignment;
  gig: JobsGig | null;
};

type JobsApplication = { id: string; gigId: string; status: string; appliedAt: string; decidedAt?: string };

export type DashboardJobsViewProps = {
  loading: boolean;
  assignmentEntries: JobsAssignmentEntry[];
  applications: JobsApplication[];
  gigById: Map<string, JobsGig>;
  openGigsCount: number;
  pendingPayout: number;
  earningsEstimate?: boolean;
  earningsLoading?: boolean;
  earningsUnavailable?: boolean;
  buildDetailHref: (gig: JobsGig) => string;
  onNavigate: (section: JobsSection, options?: { gigId?: string | null; intent?: "details" | "apply" }) => void;
};

type Group = CreatorJobGroup;
type StatusFilter = "all" | Group;
type SortKey = "newest" | "oldest" | "payout";
type ViewMode = "list" | "board";

type Row = CreatorJob<JobsGig>;

const PAGE_SIZE = 10;
const BOARD_LIMIT = 6;

/* ------------------------------------------------------------------ */
/* Status model                                                       */
/* ------------------------------------------------------------------ */

function payoutValue(payout?: string) {
  const match = String(payout ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

/** Where a row sits on its journey, for the stage tracker. `closed` rows stop where they ended. */
function stagesFor(row: Row): { steps: string[]; reached: number; closed: boolean } {
  const steps: string[] = [...CREATOR_JOB_STEPS];
  if (row.group === "closed") steps[row.stage] = row.status;
  return { steps, reached: row.stage, closed: row.group === "closed" };
}

const GROUP_META: Record<Group, { bar: string; dot: string; hint: string }> = {
  active: { bar: "bg-[#2e7d4f]", dot: "bg-[#2e7d4f]", hint: "Ready to work on" },
  review: { bar: "bg-[#d39b2a]", dot: "bg-[#d39b2a]", hint: "Waiting on a decision" },
  submitted: { bar: "bg-[#6d9bbd]", dot: "bg-[#6d9bbd]", hint: "Awaiting work approval" },
  done: { bar: "bg-[#5fae8c]", dot: "bg-[#5fae8c]", hint: "Wrapped up" },
  closed: { bar: "bg-[#c3c8c4]", dot: "bg-[#c3c8c4]", hint: "Ended or not selected" },
};

/* ------------------------------------------------------------------ */
/* View preference (remembered per browser, safe on the server)       */
/* ------------------------------------------------------------------ */

const VIEW_KEY = "reelencer:jobs-view";
const VIEW_EVENT = "reelencer:jobs-view-change";
function subscribeView(callback: () => void) {
  window.addEventListener(VIEW_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(VIEW_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}
function writeView(view: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode etc.: the choice just won't persist.
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                              */
/* ------------------------------------------------------------------ */

function CompanyMark({ name, size = "md" }: { name?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#f4f7f2] font-bold text-[#2b5d4a]",
        size === "sm" && "h-8 w-8 text-[11px]",
        size === "md" && "h-9 w-9 text-[12px]",
        size === "lg" && "h-11 w-11 rounded-xl text-[13px]"
      )}
    >
      {getInitials(name ?? "?")}
    </span>
  );
}

/** Dots joined by a line: done steps filled, the current step ringed, a closed row ends in grey. */
function StageTracker({ row, showLabels = false, className }: { row: Row; showLabels?: boolean; className?: string }) {
  const { steps, reached, closed } = stagesFor(row);
  const current = steps[reached];
  return (
    <div className={cx("min-w-0", className)} aria-label={`Progress: ${current} (step ${reached + 1} of ${steps.length})`} role="img">
      <div className="flex items-center">
        {steps.map((step, index) => {
          const done = index < reached || (index === reached && (row.group === "done" || closed));
          const isCurrent = index === reached;
          const tone = closed && isCurrent ? "bg-[#b9bfba]" : "bg-[#2e7d4f]";
          return (
            <span key={step} className="flex flex-1 items-center last:flex-none">
              <span
                title={step}
                className={cx(
                  "relative h-2.5 w-2.5 shrink-0 rounded-full",
                  done ? tone : isCurrent ? "border-2 border-[#2e7d4f] bg-white" : "border border-[#cfd5cf] bg-white"
                )}
              >
                {isCurrent && !done ? <span className="absolute inset-[-4px] animate-ping rounded-full bg-[#2e7d4f]/20 motion-reduce:hidden" /> : null}
              </span>
              {index < steps.length - 1 ? <span className={cx("mx-1 h-[2px] flex-1 rounded-full", index < reached ? (closed ? "bg-[#d6dad6]" : "bg-[#2e7d4f]/70") : "bg-[#e3e5e1]")} /> : null}
            </span>
          );
        })}
      </div>
      {showLabels ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] font-medium text-[#8a928c]">
          <span className="min-w-0 truncate font-semibold text-[#1a201c]">{current}</span>
          <span className="shrink-0 tabular-nums">{reached + 1} of {steps.length}</span>
        </div>
      ) : null}
    </div>
  );
}

function RowAction({ row, action, compact }: { row: Row; action: ReturnType<typeof makeAction>; compact?: boolean }) {
  const label = (
    <>
      {action.label}
      <Icon.ChevronRight className="h-3.5 w-3.5" />
    </>
  );
  return action.type === "link" ? (
    <Link href={action.href} className={buttonClassName(row.group === "active" ? "primary" : "secondary", "sm", compact ? "w-full justify-center" : undefined)}>
      {label}
    </Link>
  ) : (
    <Button size="sm" onClick={action.onClick} className={compact ? "w-full justify-center" : undefined}>
      {label}
    </Button>
  );
}

function makeAction(row: Row, buildDetailHref: DashboardJobsViewProps["buildDetailHref"], onNavigate: DashboardJobsViewProps["onNavigate"]) {
  if (row.assignment && row.gig) {
    return { type: "link" as const, href: buildDetailHref(row.gig), label: row.group === "active" ? "Continue" : "Open" };
  }
  return { type: "button" as const, onClick: () => onNavigate("find", { gigId: row.gigId, intent: "details" }), label: row.group === "active" ? "Continue" : "View" };
}

const BoardIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
    <rect x="3" y="3.5" width="4" height="13" rx="1.2" />
    <rect x="8" y="3.5" width="4" height="9" rx="1.2" />
    <rect x="13" y="3.5" width="4" height="11" rx="1.2" />
  </svg>
);
const ListIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className={className} aria-hidden="true">
    <path d="M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* View                                                               */
/* ------------------------------------------------------------------ */

export default function DashboardJobsView({
  loading,
  assignmentEntries,
  applications,
  gigById,
  openGigsCount,
  pendingPayout,
  earningsEstimate = false,
  earningsLoading = false,
  earningsUnavailable = false,
  buildDetailHref,
  onNavigate,
}: DashboardJobsViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const view = useSyncExternalStore(subscribeView, readView, () => "list" as ViewMode);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // "/" jumps to search (unless the user is already typing somewhere).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const input = searchWrapRef.current?.querySelector("input");
      if (!input) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sourceRows = useMemo(() => buildCreatorJobs(applications, assignmentEntries.map(entry => entry.assignment), gigById), [applications, assignmentEntries, gigById]);
  const groupCounts = useMemo(() => creatorJobCounts(sourceRows), [sourceRows]);

  // Search + sort apply to both views; the status filter only to the list (the board already splits by status).
  const searched = useMemo(() => {
    const text = query.trim().toLowerCase();
    const filtered = sourceRows.filter((row) =>
      !text ? true : [row.gig?.title, row.gig?.company, row.gig?.platform, row.status].some((field) => String(field ?? "").toLowerCase().includes(text))
    );
    return filtered.sort((left, right) => {
      if (sort === "payout") return payoutValue(right.gig?.payout) - payoutValue(left.gig?.payout);
      const diff = safeTime(right.date) - safeTime(left.date);
      return sort === "oldest" ? -diff : diff;
    });
  }, [query, sort, sourceRows]);
  const rows = useMemo(() => (statusFilter === "all" ? searched : searched.filter((row) => row.group === statusFilter)), [searched, statusFilter]);

  const groups = CREATOR_JOB_GROUPS;
  const statusTabs: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: groupCounts.all },
    ...groups.map((group) => ({ id: group as StatusFilter, label: CREATOR_JOB_LABELS[group], count: groupCounts[group] })),
  ];

  const firstLoad = loading && sourceRows.length === 0;
  const hasAnyWork = sourceRows.length > 0;
  const filtersActive = statusFilter !== "all" || query.trim() !== "";

  const focusGroup = (group: StatusFilter) => {
    setStatusFilter(group);
    setVisible(PAGE_SIZE);
    if (view === "board") writeView("list");
  };
  const action = (row: Row) => makeAction(row, buildDetailHref, onNavigate);

  // The single most useful next step, so the page answers "what should I do now?" at a glance.
  const upNext = useMemo(() => {
    const newest = (list: Row[]) => [...list].sort((a, b) => safeTime(b.date) - safeTime(a.date))[0];
    const active = newest(sourceRows.filter((row) => row.group === "active"));
    if (active) return { row: active, eyebrow: "Up next", title: "Continue your job", note: "Open the brief and follow the next steps for this job." };
    const submitted = newest(sourceRows.filter((row) => row.group === "submitted"));
    if (submitted) return { row: submitted, eyebrow: "Submitted for review", title: "Your work is being reviewed", note: "Check here for approval and payout updates." };
    const applied = newest(sourceRows.filter((row) => row.group === "review"));
    if (applied) return { row: applied, eyebrow: "In review", title: "Waiting on the recruiter", note: "Your decision and next steps will appear here." };
    return null;
  }, [sourceRows]);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 sm:space-y-5">
      <PageHeader
        title="Jobs"
        description="Track every gig from application to approval and payout."
        actions={
          <Button variant="primary" onClick={() => onNavigate("find")}>
            <Icon.Search className="h-4 w-4" />
            Find gigs
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile label="Active jobs" value={String(groupCounts.active)} caption="Ready to work on" loading={firstLoad} active={statusFilter === "active"} onClick={() => focusGroup("active")} />
        <MetricTile label="Submitted for review" value={String(groupCounts.submitted)} caption="Awaiting work approval" loading={firstLoad} active={statusFilter === "submitted"} onClick={() => focusGroup("submitted")} />
        <MetricTile label="In review" value={String(groupCounts.review)} caption="Awaiting a hiring decision" loading={firstLoad} active={statusFilter === "review"} onClick={() => focusGroup("review")} />
        <MetricTile label={earningsEstimate ? "Pending earnings" : "Pending payout"} value={earningsUnavailable ? "–" : formatMoney(pendingPayout)} caption={earningsUnavailable ? "Earnings are unavailable" : earningsEstimate ? "Reels in review · estimate" : "Across open cycles"} loading={firstLoad || earningsLoading} onClick={() => onNavigate("wallet")} />
      </div>

      {/* Up next spotlight */}
      {!firstLoad && upNext ? <UpNextCard {...upNext} action={action(upNext.row)} /> : null}

      {!firstLoad && !hasAnyWork ? (
        <Card>
          <div className="grid items-center gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef6ec] px-2.5 py-1 text-[11.5px] font-semibold text-[#2e7d4f]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2e7d4f]/60 motion-reduce:hidden" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2e7d4f]" />
                </span>
                {openGigsCount > 0 ? `${openGigsCount} ${openGigsCount === 1 ? "gig is" : "gigs are"} open right now` : "New gigs are posted regularly"}
              </span>
              <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Land your first job</h2>
              <p className="mt-1.5 max-w-[34rem] text-[13.5px] leading-relaxed text-[#616a64]">
                Apply to a brief that fits your style. Your job stays here as you get accepted, complete the work and receive your payout.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => onNavigate("find")}>
                  <Icon.Search className="h-4 w-4" />
                  Browse open gigs
                </Button>
                <Button onClick={() => onNavigate("profile")}>Complete your profile</Button>
              </div>
            </div>
            <ol className="grid gap-2.5" aria-label="How jobs work">
              {[
                ["Apply", "Pick a brief and send your application."],
                ["Get accepted", "Open the brief and follow your next steps."],
                ["Submit & get paid", "Send your work; payout follows approval."],
              ].map(([title, body], index) => (
                <li key={title} className="flex items-start gap-3 rounded-xl border border-[#ebedea] bg-[#fafbf9] p-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-[#2e7d4f] shadow-[0_0_0_1px_#e3e5e1]">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[#1a201c]">{title}</span>
                    <span className="block text-[12px] text-[#7a827c]">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : (
        <Card aria-label="Jobs list">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-[#ebedea] p-3 sm:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="flex shrink-0 items-center gap-2 text-[14px] font-semibold text-[#1a201c]">
                Your jobs
                <span className="rounded-full bg-[#eef0ed] px-2 py-0.5 text-[11.5px] tabular-nums text-[#616a64]">{sourceRows.length}</span>
              </h3>
              <div className="flex min-w-0 items-center gap-2">
                <div ref={searchWrapRef} className="relative min-w-0 flex-1 md:w-64 md:flex-none">
                  <SearchField
                    value={query}
                    onChange={(next) => {
                      setQuery(next);
                      setVisible(PAGE_SIZE);
                    }}
                    placeholder="Search jobs"
                    label="Search jobs"
                  />
                  {!query ? (
                    <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-[#e3e5e1] bg-[#fafbf9] px-1.5 text-[11px] font-semibold text-[#8a928c] lg:block">/</kbd>
                  ) : null}
                </div>
                <label className="relative shrink-0">
                  <span className="sr-only">Sort</span>
                  <Icon.Sort className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#616a64]" />
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    className="h-9 appearance-none rounded-lg border border-[#d9ddd8] bg-white pl-8 pr-3 text-[13px] font-semibold text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="payout">Highest payout</option>
                  </select>
                </label>
                {/* Board needs room for columns, so it's offered on large screens only. */}
                <div role="radiogroup" aria-label="Layout" className="hidden shrink-0 rounded-lg bg-[#f1f3f0] p-0.5 lg:inline-flex">
                  {([
                    ["list", "List", ListIcon],
                    ["board", "Board", BoardIcon],
                  ] as const).map(([id, label, ViewIcon]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={view === id}
                      aria-label={`${label} view`}
                      title={`${label} view`}
                      onClick={() => {
                        writeView(id);
                        if (id === "board") setStatusFilter("all");
                        setVisible(PAGE_SIZE);
                      }}
                      className={cx(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
                        view === id ? "bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.12)]" : "text-[#7a827c] hover:text-[#1a201c]"
                      )}
                    >
                      <ViewIcon />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Each job appears in one current stage. */}
            {!firstLoad && groupCounts.all > 0 ? (
              <div className="grid gap-2">
                <div className="flex h-2 overflow-hidden rounded-full bg-[#f1f3f0]" aria-hidden="true">
                  {groups.map((group) =>
                    groupCounts[group] > 0 ? (
                      <span
                        key={group}
                        className={cx("h-full transition-[width,opacity] duration-500 first:rounded-l-full last:rounded-r-full", GROUP_META[group].bar, statusFilter !== "all" && statusFilter !== group && "opacity-30")}
                        style={{ width: `${(groupCounts[group] / groupCounts.all) * 100}%` }}
                      />
                    ) : null
                  )}
                </div>
                <div className="dashboard-chip-scroller -mx-1 flex gap-1 overflow-x-auto px-1">
                  <FilterTabs
                    label="Filter by status"
                    tabs={statusTabs}
                    value={statusFilter}
                    onChange={(next) => {
                      setStatusFilter(next);
                      setVisible(PAGE_SIZE);
                      if (view === "board" && next !== "all") writeView("list");
                    }}
                  />
                </div>
              </div>
            ) : (
              <FilterTabs label="Filter by status" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} />
            )}
          </div>

          {firstLoad ? (
            <div className="space-y-3 p-4 sm:p-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (view === "board" ? searched : rows).length === 0 ? (
            <EmptyState
              icon={<Icon.Search className="h-5 w-5" />}
              title={filtersActive ? "No matches" : "No jobs yet"}
              description={
                filtersActive
                  ? "Try a different status or search term."
                  : "Your gigs appear here with their latest status and next steps."
              }
              action={
                filtersActive ? (
                  <Button
                    onClick={() => {
                      setQuery("");
                      setStatusFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => onNavigate("find")}>
                    Browse gigs
                  </Button>
                )
              }
            />
          ) : (
            <>
              {/* Board: large screens, when chosen */}
              {view === "board" ? (
                <div className="hidden gap-3 overflow-x-auto bg-[#fafbf9] p-4 lg:grid" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(15rem, 1fr))` }}>
                  {groups.map((group) => {
                    const columnRows = searched.filter((row) => row.group === group);
                    return (
                      <section key={group} aria-label={CREATOR_JOB_LABELS[group]} className="flex min-w-0 flex-col rounded-xl border border-[#e3e5e1] bg-[#f4f6f3]">
                        <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
                          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#1a201c]">
                            <span className={cx("h-2 w-2 rounded-full", GROUP_META[group].dot)} aria-hidden="true" />
                            {CREATOR_JOB_LABELS[group]}
                          </span>
                          <span className="rounded-full bg-white px-2 text-[11.5px] font-semibold tabular-nums text-[#616a64] shadow-[0_0_0_1px_#e3e5e1]">{columnRows.length}</span>
                        </header>
                        <ul className="grid gap-2 px-2 pb-2">
                          {columnRows.length === 0 ? (
                            <li className="rounded-lg border border-dashed border-[#d9ddd8] px-3 py-6 text-center text-[12px] text-[#8a928c]">{GROUP_META[group].hint}: none</li>
                          ) : (
                            columnRows.slice(0, BOARD_LIMIT).map((row) => (
                              <li key={row.key} className="rounded-lg border border-[#e3e5e1] bg-white p-3 shadow-[0_1px_2px_rgba(26,32,28,0.05)] transition hover:border-[#cfd5cf] hover:shadow-[0_4px_14px_-8px_rgba(26,32,28,0.25)]">
                                <div className="flex items-start gap-2.5">
                                  <CompanyMark name={row.gig?.company} size="sm" />
                                  <div className="min-w-0 flex-1">
                                    <div className="line-clamp-2 text-[13px] font-semibold leading-5 text-[#1a201c]">{row.gig?.title ?? "Gig unavailable"}</div>
                                    <div className="truncate text-[11.5px] text-[#7a827c]">
                                      {row.gig?.company ?? "—"} · {row.gig?.platform ?? "—"}
                                    </div>
                                  </div>
                                </div>
                                <StageTracker row={row} className="mt-3" />
                                <div className="mt-3 flex items-center justify-between gap-2">
                                  <span className="min-w-0 flex-1">
                                    <JobPayout gig={row.gig} className="text-[13px] text-[#1a201c]" />
                                    <span className="block text-[11px] text-[#8a928c]">{formatRelative(row.date)}</span>
                                  </span>
                                  <RowAction row={row} action={action(row)} />
                                </div>
                              </li>
                            ))
                          )}
                          {columnRows.length > BOARD_LIMIT ? (
                            <li>
                              <button
                                type="button"
                                onClick={() => focusGroup(group)}
                                className="w-full rounded-lg px-3 py-2 text-[12.5px] font-semibold text-[#2e7d4f] transition hover:bg-white"
                              >
                                View all {columnRows.length}
                              </button>
                            </li>
                          ) : null}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              ) : null}

              {/* Table: tablets and up (and large screens in list view) */}
              <div className={cx("overflow-x-auto", view === "board" ? "hidden md:block lg:hidden" : "hidden md:block")}>
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Your jobs</caption>
                  <thead>
                    <tr className="border-b border-[#ebedea] bg-[#fafbf9] text-left text-[12px] text-[#616a64]">
                      <th scope="col" className="w-[40%] py-2.5 pl-5 pr-3 font-medium lg:w-[34%]">Gig</th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">Platform</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                      <th scope="col" className="hidden w-[9.5rem] px-3 py-2.5 font-medium lg:table-cell xl:w-[11rem]">Progress</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Payout</th>
                      <th scope="col" className="hidden px-3 py-2.5 text-right font-medium lg:table-cell">Updated</th>
                      <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, visible).map((row) => (
                      <tr key={row.key} className="group border-b border-[#f2f3f1] transition last:border-0 hover:bg-[#fafbf9]">
                        <td className="max-w-0 py-3 pl-5 pr-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <CompanyMark name={row.gig?.company} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-[#1a201c]">{row.gig?.title ?? "Gig unavailable"}</div>
                              <div className="flex items-center gap-1 truncate text-[12px] text-[#7a827c]">
                                {row.gig?.company ?? "—"}
                                {row.gig?.verified ? <Icon.Check className="h-3 w-3 shrink-0 text-[#2e7d4f]" /> : null}
                                <span className="xl:hidden">· {row.gig?.platform ?? "—"}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-[#4b544e] xl:table-cell">{row.gig?.platform ?? "—"}</td>
                        <td className="px-3 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="hidden px-3 py-3 lg:table-cell">
                          <StageTracker row={row} />
                        </td>
                        <td className="px-3 py-3 text-right text-[#1a201c]">
                          <JobPayout gig={row.gig} stacked />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-right text-[#7a827c] lg:table-cell">{formatRelative(row.date)}</td>
                        <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                          <RowAction row={row} action={action(row)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards: phones */}
              <ul className="divide-y divide-[#f0f1ef] md:hidden">
                {rows.slice(0, visible).map((row) => {
                  const rowAction = action(row);
                  const content = (
                    <>
                      <CompanyMark name={row.gig?.company} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 break-words text-[13.5px] font-semibold leading-5 text-[#1a201c]">{row.gig?.title ?? "Gig unavailable"}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-[#7a827c]">
                          {row.gig?.company ?? "—"} · {row.gig?.platform ?? "—"}
                        </span>
                        <span className="mt-2 block"><StatusBadge status={row.status} /></span>
                        <StageTracker row={row} showLabels className="mt-2.5" />
                        <span className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12.5px]">
                          <JobPayout gig={row.gig} className="text-[#1a201c]" />
                          <span className="ml-auto flex shrink-0 items-center gap-1 text-[#7a827c]">
                            {formatRelative(row.date)}
                            <Icon.ChevronRight className="h-3.5 w-3.5 text-[#a3aaa4]" />
                          </span>
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={row.key}>
                      {rowAction.type === "link" ? (
                        <Link href={rowAction.href} className="flex items-start gap-3 px-4 py-3.5 transition active:bg-[#f5f7f4]">
                          {content}
                        </Link>
                      ) : (
                        <button type="button" onClick={rowAction.onClick} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition active:bg-[#f5f7f4]">
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className={cx("flex flex-col items-center justify-between gap-2 border-t border-[#ebedea] px-4 py-3 text-[12.5px] text-[#616a64] sm:flex-row sm:px-5", view === "board" && "lg:hidden")}>
                <span>
                  Showing {Math.min(visible, rows.length)} of {rows.length}
                </span>
                {rows.length > visible ? (
                  <Button size="sm" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
                    Show {Math.min(PAGE_SIZE, rows.length - visible)} more
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function UpNextCard({ row, eyebrow, title, note, action }: { row: Row; eyebrow: string; title: string; note: string; action: ReturnType<typeof makeAction> }) {
  const primary: ReactNode =
    action.type === "link" ? (
      <Link href={action.href} className={buttonClassName("primary", "md", "w-full justify-center sm:w-auto")}>
        {row.group === "active" ? "Open brief" : action.label}
        <Icon.ChevronRight className="h-4 w-4" />
      </Link>
    ) : (
      <Button variant="primary" onClick={action.onClick} className="w-full justify-center sm:w-auto">
        View gig
        <Icon.ChevronRight className="h-4 w-4" />
      </Button>
    );
  return (
    <Card aria-label={eyebrow}>
      <div className="relative overflow-hidden rounded-[inherit]">
        <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-1", row.group === "active" ? "bg-[#2e7d4f]" : "bg-[#d39b2a]")} />
        {/* Phones: stacked. Tablets: details + button, tracker on its own row. Large screens: one row. */}
        <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)_auto]">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyMark name={row.gig?.company} size="lg" />
            <div className="min-w-0">
              <div className={cx("text-[11px] font-bold uppercase tracking-[0.14em]", row.group === "active" ? "text-[#2e7d4f]" : "text-[#a8761a]")}>{eyebrow}</div>
              <div className="mt-0.5 text-[15px] font-semibold text-[#1a201c] sm:text-[16px]">{title}</div>
              <div className="mt-0.5 truncate text-[13px] text-[#4b544e]">
                <span className="font-semibold text-[#1a201c]">{row.gig?.title ?? "Gig unavailable"}</span>
                {row.gig?.company ? ` · ${row.gig.company}` : ""}
              </div>
              {row.gig?.payout ? <JobPayout gig={row.gig} className="mt-0.5 text-[13px] text-[#2e7d4f]" /> : null}
              <div className="mt-1 text-[12px] text-[#7a827c]">{note}</div>
            </div>
          </div>
          <StageTracker row={row} showLabels className="md:col-span-2 md:row-start-2 lg:col-span-1 lg:row-start-auto" />
          <div className="flex md:col-start-2 md:row-start-1 md:justify-end lg:col-start-auto lg:row-start-auto">{primary}</div>
        </div>
      </div>
    </Card>
  );
}
