"use client";

import { useMemo, useState } from "react";
import { reelTracking, trackingStartLabel, type ReelTracking } from "@/lib/reelTracking";
import { formatCompact, type LinkedSocialAccount, type SocialPost } from "@/lib/socialAnalytics";
import { BulkBar, ConfirmDialog, ICONS, Icon, SelectAllCheckbox, Spinner, StatusChip, btnBase, btnGhost, btnIcon, btnPrimary, bulkBtn, fieldClass, formatDate, formatRelative, runPool, usePersistedState, type BulkProgress } from "./adminUi";

// Admin: an account's reels with the tracking window made visible. Reels count from the day the account was linked
// (lib/reelTracking.ts); earlier ones sit in their own "Before linking" view and can't be approved. Removed reels
// are hidden from creators and every count; they wait in the "Removed" view, where they can be restored.

type StatusView = "tracked" | "submitted" | "approved" | "rejected" | "undated" | "before_link" | "removed";
type SourceView = "all" | "sync" | "creator" | "team";
type PeriodView = "all" | "7" | "30";
type SortKey = "review" | "newest" | "oldest" | "views" | "likes" | "updated";

const PAGE = 15;
const DAY = 86_400_000;

const sourceOf = (post: SocialPost): Exclude<SourceView, "all"> => (post.submittedByWorker ? "creator" : post.source === "api" || post.source === "profile" ? "sync" : "team");
const time = (value?: string) => Date.parse(value ?? "") || 0;

type Row = { post: SocialPost; tracking: ReelTracking; removed: boolean };
type Failure = { error: string };
type Notice = { text: string; tone: "ok" | "warn"; undo?: SocialPost[] };
type RemovalMode = "notify" | "silent";

const MODES: Array<{ id: RemovalMode; label: string; icon: string; body: string }> = [
  { id: "notify", label: "Tell the creator", icon: ICONS.mail, body: "They get an email with your reason. Resubmitting the link says it was removed." },
  { id: "silent", label: "Silent", icon: ICONS.eyeOff, body: "No email or live update. Resubmitting the link looks like an ordinary duplicate." },
];

const REASONS = ["Duplicate", "Not for this gig", "Wrong account", "Reposted content", "Breaks the brief"];
const btnRemove = `${btnBase} h-8 border border-[#f0c6c1] bg-[#fff] px-2.5 text-[12px] text-[#b42318] hover:bg-[#fdf0ef]`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export default function ReelList({
  account,
  now,
  busyId,
  onReview,
  onEdit,
  onRemove,
  onRestore,
}: {
  account: LinkedSocialAccount;
  now: number;
  busyId: string | null;
  onReview: (post: SocialPost, status: "approved" | "rejected", note?: string) => Promise<{ ok: true } | Failure>;
  onEdit: (post: SocialPost) => void;
  /** Resolves with how many pending view claims cite the reel, or why removing failed. */
  onRemove: (post: SocialPost, reason: string, silent: boolean) => Promise<{ pendingClaims: number; emailed: boolean } | Failure>;
  onRestore: (post: SocialPost) => Promise<{ ok: true } | Failure>;
}) {
  const [status, setStatus] = useState<StatusView>("tracked");
  const [source, setSource] = useState<SourceView>("all");
  const [period, setPeriod] = useState<PeriodView>("all");
  const [sort, setSort] = useState<SortKey>("review");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const [bulk, setBulk] = useState<{ confirm: boolean; done: number; total: number; running: boolean } | null>(null);
  const [removing, setRemoving] = useState<{ posts: SocialPost[]; reason: string; busy: boolean; done: number; error: string | null } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<BulkProgress>(null);
  // Reviews show at once and roll back if saving fails; the failure is shown on the reel with a retry.
  const [optimistic, setOptimistic] = useState<Record<string, "approved" | "rejected">>({});
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, { message: string; retry: () => void }>>({});
  // Remembered per admin, so a team that always removes quietly isn't asked to switch every time.
  const [mode, setMode] = usePersistedState<RemovalMode>("reelencer.reelRemovalMode", "notify", ["notify", "silent"]);

  const since = trackingStartLabel(account.linkedAt);
  const rows: Row[] = useMemo(() => account.posts.map((post) => ({ post, tracking: reelTracking(post.postedAt, account.linkedAt), removed: !!post.removedAt })), [account.posts, account.linkedAt]);

  const counts = useMemo(() => {
    const kept = rows.filter((row) => !row.removed);
    const inWindow = kept.filter((row) => row.tracking !== "before_link");
    return {
      tracked: inWindow.length,
      submitted: inWindow.filter((row) => row.post.status === "submitted").length,
      approved: inWindow.filter((row) => row.post.status === "approved").length,
      rejected: inWindow.filter((row) => row.post.status === "rejected").length,
      undated: inWindow.filter((row) => row.tracking === "undated").length,
      before_link: kept.length - inWindow.length,
      removed: rows.length - kept.length,
    } satisfies Record<StatusView, number>;
  }, [rows]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    const cutoff = period === "all" ? 0 : now - Number(period) * DAY;
    const filtered = rows.filter(({ post, tracking, removed }) => {
      if (status === "removed" ? !removed : removed) return false;
      if (status !== "removed" && (status === "before_link" ? tracking !== "before_link" : tracking === "before_link")) return false;
      if (status === "undated" && tracking !== "undated") return false;
      if ((status === "submitted" || status === "approved" || status === "rejected") && post.status !== status) return false;
      if (source !== "all" && sourceOf(post) !== source) return false;
      if (cutoff && time(post.postedAt ?? post.createdAt) < cutoff) return false;
      return !text || `${post.caption ?? ""} ${post.url}`.toLowerCase().includes(text);
    });
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      review: (a, b) => Number(b.post.status === "submitted") - Number(a.post.status === "submitted") || time(b.post.postedAt) - time(a.post.postedAt),
      newest: (a, b) => time(b.post.postedAt) - time(a.post.postedAt),
      oldest: (a, b) => time(a.post.postedAt) - time(b.post.postedAt),
      views: (a, b) => (b.post.views ?? -1) - (a.post.views ?? -1),
      likes: (a, b) => (b.post.likes ?? -1) - (a.post.likes ?? -1),
      updated: (a, b) => time(b.post.updatedAt) - time(a.post.updatedAt),
    };
    return filtered.sort(by[sort]);
  }, [rows, status, source, period, sort, query, now]);

  const totals = useMemo(() => {
    const sum = (key: "views" | "likes") => visible.reduce((total, row) => total + (row.post[key] ?? 0), 0);
    const approvedViews = visible.filter((row) => row.post.status === "approved" && row.tracking !== "before_link" && !row.removed).reduce((total, row) => total + (row.post.views ?? 0), 0);
    return { views: sum("views"), likes: sum("likes"), approvedViews };
  }, [visible]);

  const reviewable = visible.filter((row) => row.post.status === "submitted" && row.tracking !== "before_link" && !row.removed).map((row) => row.post);
  const filtersOn = source !== "all" || period !== "all" || !!query.trim();

  const exportCsv = () => {
    const escape = (value: unknown) => {
      const text = value === undefined || value === null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ["posted_at", "status", "tracking", "source", "views", "likes", "comments", "caption", "url", "updated_at"];
    const lines = visible.map(({ post, tracking, removed }) => [post.postedAt ?? "", removed ? "removed" : post.status, tracking, sourceOf(post), post.views ?? "", post.likes ?? "", post.comments ?? "", post.caption ?? "", post.url, post.updatedAt].map(escape).join(","));
    const href = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href, download: `${account.handle}-reels.csv` }).click();
    URL.revokeObjectURL(href);
  };

  const review = async (post: SocialPost, status: "approved" | "rejected", note?: string) => {
    const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => id !== post.id)) as Record<string, T>;
    setOptimistic((current) => ({ ...current, [post.id]: status }));
    setWorking((current) => new Set(current).add(post.id));
    setRowErrors(without);
    const result = await onReview(post, status, note);
    setOptimistic(without);
    setWorking((current) => {
      const next = new Set(current);
      next.delete(post.id);
      return next;
    });
    if ("error" in result) {
      setRowErrors((current) => ({ ...current, [post.id]: { message: `Couldn't ${status === "approved" ? "approve" : "reject"}: ${result.error}`, retry: () => void review(post, status, note) } }));
      return false;
    }
    return true;
  };

  const approveMany = async (targets: SocialPost[], report: (done: number) => void) => {
    const results = await runPool(targets, 3, (post) => review(post, "approved"), report);
    const failed = results.filter((ok) => !ok).length;
    setNotice(
      failed
        ? { text: `${plural(targets.length - failed, "reel")} approved. ${plural(failed, "reel")} couldn't be approved; ${failed === 1 ? "its" : "each"} reason is shown on the reel, with Retry.`, tone: "warn" }
        : { text: `${plural(targets.length, "reel")} approved. ${targets.length === 1 ? "Its" : "Their"} views now count towards the creator's pay.`, tone: "ok" },
    );
    return results;
  };

  const approveAll = async () => {
    const targets = reviewable;
    setBulk({ confirm: false, done: 0, total: targets.length, running: true });
    await approveMany(targets, (done) => setBulk((current) => (current ? { ...current, done } : current)));
    setBulk(null);
  };

  const tabs: Array<{ id: StatusView; label: string; hideEmpty?: boolean }> = [
    { id: "tracked", label: "All tracked" },
    { id: "submitted", label: "To review" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "undated", label: "No date", hideEmpty: true },
    { id: "before_link", label: "Before linking", hideEmpty: true },
    { id: "removed", label: "Removed" },
  ];

  const pageRows = visible.slice(0, shown);
  const selectedPosts = visible.filter((row) => selected.has(row.post.id)).map((row) => row.post);
  const selectedApprovable = visible.filter((row) => selected.has(row.post.id) && row.post.status === "submitted" && row.tracking !== "before_link" && !row.removed).map((row) => row.post);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selected.has(row.post.id));
  const changeView = (apply: () => void) => {
    apply();
    setShown(PAGE);
    setSelected(new Set());
  };

  const startRemove = (posts: SocialPost[]) => setRemoving({ posts, reason: "", busy: false, done: 0, error: null });

  const confirmRemove = async () => {
    if (!removing) return;
    const { posts, reason } = removing;
    setRemoving({ ...removing, busy: true, done: 0, error: null });
    const silent = mode === "silent";
    const results = await runPool(posts, 3, (post) => onRemove(post, reason, silent), (done) => setRemoving((current) => (current ? { ...current, done } : current)));
    const failed = results.filter((result): result is Failure => "error" in result);
    const removed = posts.filter((_, index) => !("error" in results[index]));
    const pending = results.reduce((total, result) => total + ("pendingClaims" in result ? result.pendingClaims : 0), 0);
    const emailed = results.filter((result) => "emailed" in result && result.emailed).length;
    if (!removed.length) return setRemoving((current) => (current ? { ...current, busy: false, error: failed[0]?.error ?? "The reel couldn't be removed." } : current));
    setRemoving(null);
    setSelected(new Set());
    const what = removed.length === 1 ? "Reel removed" : `${removed.length} reels removed`;
    const parts = silent
      ? [`${what} silently. @${account.handle} gets no email or live update, and resubmitting the link looks like an ordinary duplicate.`]
      : [`${what}. Hidden from @${account.handle}'s Linked page and no longer counted anywhere.`, emailed === removed.length ? "The creator was emailed." : emailed ? `${emailed} of ${removed.length} emails to the creator were sent.` : "The email to the creator couldn't be sent."];
    if (pending) parts.push(`${plural(pending, "pending view claim")} cited ${removed.length === 1 ? "it" : "them"} and can no longer be approved as is: reject or review ${pending === 1 ? "that claim" : "those claims"}${silent ? ", keeping the note general so the reel isn't mentioned" : ""}.`);
    if (failed.length) parts.push(`${plural(failed.length, "reel")} couldn't be removed: ${failed[0].error}`);
    setNotice({ text: parts.join(" "), tone: pending || failed.length || (!silent && emailed < removed.length) ? "warn" : "ok", undo: removed });
  };

  const restore = async (posts: SocialPost[]) => {
    setNotice(null);
    setProgress({ label: posts.length === 1 ? "Restoring reel" : "Restoring reels", done: 0, total: posts.length });
    const results = await runPool(posts, 3, (post) => onRestore(post), (done) => setProgress((current) => (current ? { ...current, done } : current)));
    setProgress(null);
    setSelected(new Set());
    const failed = results.filter((result): result is Failure => "error" in result);
    const restored = posts.length - failed.length;
    setNotice({
      text: [restored ? `${restored === 1 ? "Reel" : `${restored} reels`} restored to To review, so ${restored === 1 ? "it's" : "they're"} checked again before counting.` : "", failed.length ? `${plural(failed.length, "reel")} couldn't be restored: ${failed[0].error}` : ""].filter(Boolean).join(" "),
      tone: failed.length ? "warn" : "ok",
    });
  };

  const approveSelected = async () => {
    const targets = selectedApprovable;
    setProgress({ label: "Approving reels", done: 0, total: targets.length });
    const results = await approveMany(targets, (done) => setProgress((current) => (current ? { ...current, done } : current)));
    setProgress(null);
    // Reels that failed stay selected, ready to retry.
    setSelected(new Set(targets.filter((_, index) => !results[index]).map((post) => post.id)));
  };

  // What removing takes away, so the dialog can say it before it happens.
  const impact = useMemo(() => {
    if (!removing) return null;
    const counted = removing.posts.filter((post) => reelTracking(post.postedAt, account.linkedAt) !== "before_link");
    return {
      approved: counted.filter((post) => post.status === "approved").length,
      approvedViews: counted.filter((post) => post.status === "approved").reduce((total, post) => total + (post.views ?? 0), 0),
      waiting: counted.filter((post) => post.status === "submitted").length,
      views: removing.posts.reduce((total, post) => total + (post.views ?? 0), 0),
    };
  }, [removing, account.linkedAt]);

  if (!account.posts.length) return null;

  return (
    <div className="mt-2 space-y-2.5">
      {since ? (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-[#d8e8dc] bg-[#f3f9f4] px-3 py-2.5 text-[12.5px] leading-5 text-[#2c4a37]">
          <Icon d={ICONS.clock} className="mt-0.5 h-4 w-4 shrink-0 text-[#2e7d4f]" />
          <span className="min-w-0">
            Tracking reels posted from <strong className="font-semibold">{since}</strong>, the day @{account.handle} was linked.
            {counts.before_link ? ` ${counts.before_link} earlier ${counts.before_link === 1 ? "reel isn't" : "reels aren't"} tracked or paid.` : " Earlier reels aren't tracked or paid."}
          </span>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-[12px] border px-3 py-2.5 text-[12.5px] leading-5 ${notice.tone === "warn" ? "border-[#f3dcae] bg-[#fffaf0] text-[#6b4a00]" : "border-[#d8e8dc] bg-[#f3f9f4] text-[#2c4a37]"}`}
        >
          <Icon d={notice.tone === "warn" ? ICONS.alert : ICONS.check} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 basis-52">{notice.text}</span>
          <span className="ml-auto flex shrink-0 gap-3">
            {notice.undo?.length ? (
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#2b5d4a] hover:underline" disabled={!!progress} onClick={() => void restore(notice.undo ?? [])}>
                <Icon d={ICONS.undo} className="h-3.5 w-3.5" />
                Undo
              </button>
            ) : null}
            <button type="button" className="font-semibold text-[#6b746e] hover:text-[#1a201c]" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      {/* Status tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filter reels by status">
        {tabs
          .filter((tab) => !tab.hideEmpty || counts[tab.id] > 0 || status === tab.id)
          .map((tab) => {
            const active = status === tab.id;
            const warn = tab.id === "submitted" && counts.submitted > 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={(event) => {
                  changeView(() => setStatus(tab.id));
                  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[999px] px-3 text-[12px] font-semibold transition ${
                  active ? "bg-[#1f2b24] text-[#fff]" : "bg-[#f3f4f2] text-[#4b544e] hover:bg-[#e9ebe8]"
                }`}
              >
                {tab.label}
                {tab.id === "removed" ? <Icon d={ICONS.trash} className="h-3.5 w-3.5" /> : null}
                <span className={`rounded-[999px] px-1.5 text-[10.5px] tabular-nums ${active ? "bg-[#fff]/20" : warn ? "bg-[#fdecc8] text-[#9a5b00]" : tab.id === "removed" && counts.removed ? "bg-[#fdf0ef] text-[#b42318]" : "bg-[#fff] text-[#6b746e]"}`}>{counts[tab.id]}</span>
              </button>
            );
          })}
      </div>

      {/* Search, filters and sort */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="relative block min-w-0">
          <span className="sr-only">Search reels</span>
          <Icon d={ICONS.search} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" />
          <input value={query} onChange={(e) => changeView(() => setQuery(e.target.value))} placeholder="Search caption or link" className={`${fieldClass} h-9 w-full pl-8`} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select aria-label="Source" value={source} onChange={(e) => changeView(() => setSource(e.target.value as SourceView))} className={`${fieldClass} h-9 min-w-0 text-[12.5px]`}>
            <option value="all">Any source</option>
            <option value="sync">Found by sync</option>
            <option value="creator">Sent by creator</option>
            <option value="team">Added by team</option>
          </select>
          <select aria-label="Posted" value={period} onChange={(e) => changeView(() => setPeriod(e.target.value as PeriodView))} className={`${fieldClass} h-9 min-w-0 text-[12.5px]`}>
            <option value="all">Any date</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <select aria-label="Sort reels" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${fieldClass} col-span-2 h-9 min-w-0 text-[12.5px] sm:col-span-1`}>
            <option value="review">To review first</option>
            <option value="newest">Newest posted</option>
            <option value="oldest">Oldest posted</option>
            <option value="views">Most views</option>
            <option value="likes">Most likes</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
      </div>

      {/* Totals for what's shown, and bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[12px] text-[#6b746e]">
        <span className="flex flex-wrap items-center gap-x-1 tabular-nums">
          {pageRows.length ? (
            <SelectAllCheckbox
              checked={allOnPage}
              indeterminate={pageRows.some((row) => selected.has(row.post.id))}
              label="Select all reels shown"
              onChange={() => setSelected(allOnPage ? new Set() : new Set(pageRows.map((row) => row.post.id)))}
            />
          ) : null}
          <span className="ml-1">{visible.length} {visible.length === 1 ? "reel" : "reels"}</span> · ▶ {formatCompact(totals.views)} · ♥ {formatCompact(totals.likes)}
          {status !== "before_link" && totals.approvedViews ? <span className="text-[#1f5131]"> · {formatCompact(totals.approvedViews)} approved views</span> : null}
          {filtersOn ? (
            <button type="button" className="ml-2 font-semibold text-[#2b5d4a] hover:underline" onClick={() => changeView(() => { setSource("all"); setPeriod("all"); setQuery(""); })}>
              Clear filters
            </button>
          ) : null}
        </span>
        <span className="flex gap-1.5">
          {reviewable.length > 1 ? (
            <button type="button" className={`${btnGhost} h-8 px-2.5 text-[12px]`} disabled={!!bulk} onClick={() => setBulk({ confirm: true, done: 0, total: reviewable.length, running: false })}>
              {bulk?.running ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.check} className="h-3.5 w-3.5" />}
              {bulk?.running ? `Approving ${bulk.done}/${bulk.total}` : `Approve ${reviewable.length} shown`}
            </button>
          ) : null}
          {visible.length ? (
            <button type="button" className={`${btnGhost} h-8 px-2.5 text-[12px]`} onClick={exportCsv}>
              <Icon d={ICONS.download} className="h-3.5 w-3.5" />
              CSV
            </button>
          ) : null}
        </span>
      </div>

      {visible.length ? (
        <ul className="divide-y divide-[#eef0ec] overflow-hidden rounded-[12px] border border-[#e3e5e1]">
          {pageRows.map(({ post, tracking, removed }) => {
            const before = tracking === "before_link" || removed;
            const busy = busyId === post.id || working.has(post.id);
            const shownStatus = (optimistic[post.id] as SocialPost["status"] | undefined) ?? post.status;
            const rowError = rowErrors[post.id];
            const picked = selected.has(post.id);
            return (
              <li key={post.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 pl-3 pr-3.5 ${picked ? "bg-[#eef6f0]" : before ? "bg-[#f7f8f6]" : shownStatus === "submitted" ? "bg-[#fffaf0]" : ""}`}>
                <input type="checkbox" checked={picked} onChange={() => toggle(post.id)} aria-label={`Select ${post.caption || post.url}`} className="h-4 w-4 shrink-0 cursor-pointer self-start rounded sm:mt-0.5 sm:self-center" />
                <div className={`min-w-0 flex-1 basis-56 ${before ? "opacity-70" : ""}`}>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <a href={post.url} target="_blank" rel="noreferrer" className="min-w-0 max-w-full truncate text-[13px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">
                      {post.caption || post.url}
                    </a>
                    {sourceOf(post) === "sync" ? <StatusChip label="Auto" tone="info" /> : sourceOf(post) === "creator" ? <StatusChip label="Creator" tone="neutral" /> : null}
                    {removed ? <StatusChip label="Removed" tone="danger" /> : before ? <StatusChip label="Before linking" tone="neutral" /> : shownStatus !== "approved" ? <StatusChip label={shownStatus === "submitted" ? "To review" : "Rejected"} tone={shownStatus === "submitted" ? "warning" : "danger"} /> : <StatusChip label="Approved" tone="success" />}
                    {working.has(post.id) ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#6b746e]" role="status">
                        <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" />
                        Saving
                      </span>
                    ) : null}
                    {tracking === "undated" ? <StatusChip label="No date" tone="warning" /> : null}
                  </div>
                  <div className="text-[11.5px] text-[#8a928c]">
                    {post.postedAt ? `Posted ${formatDate(post.postedAt)}` : "Posting date unknown"}
                    {post.submittedByWorker ? ` · sent by creator ${formatRelative(post.createdAt)}` : sourceOf(post) === "sync" ? ` · found by sync, updated ${formatRelative(post.updatedAt)}` : ` · updated ${formatRelative(post.updatedAt)}`}
                  </div>
                  {removed ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#6b746e]">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#b42318]">
                        <Icon d={ICONS.trash} className="h-3.5 w-3.5" />
                        Removed {formatRelative(post.removedAt)}
                      </span>
                      {post.removalReason ? <span className="rounded-[6px] bg-[#fdf0ef] px-1.5 py-px text-[#8a2a20]">{post.removalReason}</span> : null}
                      <span className="inline-flex items-center gap-1 rounded-[6px] bg-[#f1f3f0] px-1.5 py-px font-semibold text-[#4b544e]" title={post.removedSilently ? "The creator was never told" : "The creator was emailed"}>
                        <Icon d={post.removedSilently ? ICONS.eyeOff : ICONS.mail} className="h-3 w-3" />
                        {post.removedSilently ? "Silent" : "Creator told"}
                      </span>
                      <span>Hidden from the creator and not counted.</span>
                    </div>
                  ) : before ? (
                    <div className="mt-0.5 text-[11.5px] text-[#6b746e]">Not tracked: posted before {since}. Its views don&apos;t count towards pay.</div>
                  ) : null}
                  {!before && shownStatus === "rejected" && post.reviewNote ? <div className="mt-0.5 truncate text-[11.5px] text-[#b42318]">Note: {post.reviewNote}</div> : null}
                </div>
                <div className={`gap-3 text-[12px] tabular-nums text-[#3b443e] ${post.views === undefined && post.likes === undefined && post.comments === undefined ? "hidden" : "flex"} ${before ? "opacity-60" : ""}`}>
                  <span title="Views">▶ {formatCompact(post.views)}</span>
                  <span title="Likes">♥ {formatCompact(post.likes)}</span>
                  <span title="Comments">💬 {formatCompact(post.comments)}</span>
                </div>
                {shownStatus === "submitted" && !before ? (
                  <div className="flex w-full gap-1.5 sm:w-auto">
                    <button type="button" className={`${btnPrimary} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy || !!bulk?.running || !!progress} onClick={() => void review(post, "approved")}>
                      {busy ? <Spinner /> : <Icon d={ICONS.check} className="h-3.5 w-3.5" />}
                      Approve
                    </button>
                    <button type="button" className={`${btnGhost} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy} onClick={() => setRejecting({ id: post.id, note: "" })}>
                      Reject
                    </button>
                  </div>
                ) : null}
                {rowError ? (
                  <div role="alert" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] bg-[#fdf0ef] px-3 py-2 text-[12px] leading-5 text-[#b42318]">
                    <Icon d={ICONS.alert} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 basis-48">{rowError.message}</span>
                    <span className="flex gap-3 font-semibold">
                      <button type="button" className="hover:underline" disabled={busy} onClick={rowError.retry}>
                        Retry
                      </button>
                      <button type="button" className="text-[#8a2a20]/70 hover:text-[#8a2a20]" onClick={() => setRowErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== post.id)))}>
                        Dismiss
                      </button>
                    </span>
                  </div>
                ) : null}
                {rejecting?.id === post.id ? (
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <input
                      autoFocus
                      value={rejecting.note}
                      maxLength={500}
                      onChange={(e) => setRejecting({ id: post.id, note: e.target.value })}
                      placeholder="Why? The creator sees this (e.g. posted on a different account)"
                      className={`${fieldClass} h-9 flex-1`}
                    />
                    <div className="flex gap-1.5">
                      <button type="button" className={`${btnGhost} h-9 flex-1`} onClick={() => setRejecting(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`${btnPrimary} h-9 flex-1 bg-[#b42318] hover:bg-[#9a1e14]`}
                        disabled={!rejecting.note.trim() || busy}
                        onClick={() => {
                          const note = rejecting.note;
                          setRejecting(null);
                          void review(post, "rejected", note);
                        }}
                      >
                        Reject reel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex gap-1">
                  {removed ? (
                    <button type="button" className={`${btnGhost} h-8 px-2.5 text-[12px]`} disabled={busy || !!progress} onClick={() => void restore([post])}>
                      {busy ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.undo} className="h-3.5 w-3.5" />}
                      Restore
                    </button>
                  ) : (
                    <>
                      {!before ? (
                        <button type="button" className={btnIcon} onClick={() => onEdit(post)} aria-label="Update numbers" title="Update numbers">
                          <Icon d={ICONS.refresh} />
                        </button>
                      ) : null}
                      <button type="button" className={btnRemove} disabled={busy || !!progress} onClick={() => startRemove([post])} title="Remove from Reelencer: hidden from the creator and not counted anywhere">
                        <Icon d={ICONS.trash} className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-[12px] border border-dashed border-[#e3e5e1] px-3.5 py-3 text-[12.5px] text-[#7a827c]">
          {filtersOn ? "No reels match these filters." : status === "submitted" ? "Nothing waiting for review." : status === "removed" ? "No removed reels. Reels you remove wait here, hidden from the creator and not counted, until you restore them." : "No reels here yet."}
        </p>
      )}

      {visible.length > shown ? (
        <button type="button" className={`${btnGhost} h-9 w-full text-[12.5px]`} onClick={() => setShown((count) => count + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
        </button>
      ) : null}

      {removing && impact ? (
        <ConfirmDialog
          title={removing.posts.length === 1 ? "Remove this reel?" : `Remove ${removing.posts.length} reels?`}
          body={
            removing.posts.length === 1 ? (
              <span className="line-clamp-2 break-all font-medium text-[#3b443e]">{removing.posts[0].caption || removing.posts[0].url}</span>
            ) : (
              <>From @{account.handle}, totalling ▶ {formatCompact(impact.views)} views.</>
            )
          }
          confirmLabel={removing.busy ? (removing.posts.length > 1 ? `Removing ${removing.done}/${removing.posts.length}` : "Removing") : mode === "silent" ? "Remove silently" : "Remove and notify"}
          tone="danger"
          icon={mode === "silent" ? ICONS.eyeOff : ICONS.trash}
          busy={removing.busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        >
          <div role="radiogroup" aria-label="How to remove" className="mt-3 grid grid-cols-2 gap-2">
            {MODES.map((option) => {
              const on = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={removing.busy}
                  onClick={() => setMode(option.id)}
                  className={`flex min-w-0 flex-col items-start gap-1 rounded-[12px] border px-3 py-2.5 text-left transition ${on ? "border-[#b42318] bg-[#fdf0ef] ring-1 ring-[#b42318]" : "border-[#e3e5e1] bg-[#fff] hover:bg-[#f7f8f6]"}`}
                >
                  <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${on ? "text-[#b42318]" : "text-[#1a201c]"}`}>
                    <Icon d={option.icon} className="h-4 w-4" />
                    {option.label}
                  </span>
                  <span className="text-[11.5px] leading-4 text-[#616a64]">{option.body}</span>
                </button>
              );
            })}
          </div>
          <ul className="mt-3 space-y-1.5 rounded-[12px] bg-[#f7f8f6] px-3 py-2.5 text-[12.5px] leading-5 text-[#3b443e]">
            {[
              `Disappears from @${account.handle}'s Linked page: reel list, charts, totals and earnings.`,
              impact.approvedViews
                ? `${formatCompact(impact.approvedViews)} approved views stop counting towards pay, quotes and claims.`
                : impact.waiting
                  ? `Leaves the review queue${impact.waiting > 1 ? ` (${impact.waiting} waiting)` : ""} and never counts towards pay or claims.`
                  : "Never counts towards pay, quotes or claims.",
              mode === "silent"
                ? "The creator isn't told: no email, no live update, and nothing on their page says it was removed."
                : `@${account.handle} is emailed that it was removed${removing.reason.trim() ? ", with your reason" : ""}.`,
              "Sync won't add it back and the creator can't resubmit the link.",
              "Kept in the Removed tab with your reason. Restore sends it back to review.",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <Icon d={ICONS.check} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b42318]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <div className="text-[12px] font-semibold text-[#3b443e]">
              Reason <span className="font-normal text-[#8a928c]">{mode === "silent" ? "(optional, team only)" : "(optional, shared with the creator)"}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REASONS.map((reason) => {
                const on = removing.reason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={on}
                    disabled={removing.busy}
                    onClick={() => setRemoving({ ...removing, reason: on ? "" : reason })}
                    className={`h-7 rounded-[999px] px-2.5 text-[12px] font-semibold transition ${on ? "bg-[#b42318] text-[#fff]" : "bg-[#f3f4f2] text-[#4b544e] hover:bg-[#e9ebe8]"}`}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
            <input
              value={removing.reason}
              maxLength={300}
              disabled={removing.busy}
              aria-label="Removal reason"
              onChange={(e) => setRemoving({ ...removing, reason: e.target.value })}
              placeholder="Or write your own reason"
              className={`${fieldClass} mt-2 h-9 w-full`}
            />
          </div>
          {removing.error ? (
            <p role="alert" className="mt-3 flex gap-2 rounded-[10px] bg-[#fdf0ef] px-3 py-2 text-[12.5px] leading-5 text-[#b42318]">
              <Icon d={ICONS.alert} className="mt-0.5 h-4 w-4 shrink-0" />
              {removing.error}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}

      <BulkBar count={removing ? 0 : selectedPosts.length} total={visible.length} onSelectAll={() => setSelected(new Set(visible.map((row) => row.post.id)))} onClear={() => setSelected(new Set())} progress={progress}>
        {status === "removed" ? (
          <button type="button" className={bulkBtn.primary} onClick={() => void restore(selectedPosts)}>
            <Icon d={ICONS.undo} className="h-4 w-4" />
            Restore {selectedPosts.length}
          </button>
        ) : (
          <>
            {selectedApprovable.length ? (
              <button type="button" className={bulkBtn.primary} onClick={() => void approveSelected()}>
                <Icon d={ICONS.check} className="h-4 w-4" />
                Approve {selectedApprovable.length}
              </button>
            ) : null}
            <button type="button" className={bulkBtn.danger} onClick={() => startRemove(selectedPosts)}>
              <Icon d={ICONS.trash} className="h-4 w-4" />
              Remove {selectedPosts.length}
            </button>
          </>
        )}
      </BulkBar>

      {bulk?.confirm ? (
        <ConfirmDialog
          title={`Approve ${bulk.total} reels?`}
          body={`Approves every reel waiting for review in the current view of @${account.handle}. Their views will count towards the creator's pay.`}
          confirmLabel={`Approve ${bulk.total}`}
          icon={ICONS.check}
          busy={false}
          onCancel={() => setBulk(null)}
          onConfirm={() => void approveAll()}
        />
      ) : null}
    </div>
  );
}
