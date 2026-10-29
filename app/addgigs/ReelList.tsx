"use client";

import { useMemo, useState } from "react";
import { reelTracking, trackingStartLabel, type ReelTracking } from "@/lib/reelTracking";
import { formatCompact, type LinkedSocialAccount, type SocialPost } from "@/lib/socialAnalytics";
import { ConfirmDialog, ICONS, Icon, Spinner, StatusChip, btnGhost, btnIcon, btnPrimary, fieldClass, formatDate, formatRelative, runPool } from "./adminUi";

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
  onReview: (post: SocialPost, status: "approved" | "rejected", note?: string) => Promise<boolean>;
  onEdit: (post: SocialPost) => void;
  /** Resolves with how many pending view claims cite the reel, or null when removing failed. */
  onRemove: (post: SocialPost, reason: string) => Promise<number | null>;
  onRestore: (post: SocialPost) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<StatusView>("tracked");
  const [source, setSource] = useState<SourceView>("all");
  const [period, setPeriod] = useState<PeriodView>("all");
  const [sort, setSort] = useState<SortKey>("review");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const [bulk, setBulk] = useState<{ confirm: boolean; done: number; total: number; running: boolean } | null>(null);
  const [removing, setRemoving] = useState<{ post: SocialPost; reason: string; busy: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const approveAll = async () => {
    const targets = reviewable;
    setBulk({ confirm: false, done: 0, total: targets.length, running: true });
    await runPool(targets, 3, (post) => onReview(post, "approved"), (done) => setBulk((current) => (current ? { ...current, done } : current)));
    setBulk(null);
  };

  const tabs: Array<{ id: StatusView; label: string; hideEmpty?: boolean }> = [
    { id: "tracked", label: "All tracked" },
    { id: "submitted", label: "To review" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "undated", label: "No date", hideEmpty: true },
    { id: "before_link", label: "Before linking", hideEmpty: true },
    { id: "removed", label: "Removed", hideEmpty: true },
  ];

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoving({ ...removing, busy: true });
    const pending = await onRemove(removing.post, removing.reason);
    if (pending === null) return setRemoving((current) => (current ? { ...current, busy: false } : current));
    setRemoving(null);
    setNotice(
      pending
        ? `Reel removed. It's in ${pending} pending view ${pending === 1 ? "claim" : "claims"}, which can no longer be approved as is. Reject or review ${pending === 1 ? "that claim" : "those claims"}.`
        : "Reel removed. It's gone from the creator's Linked page and isn't counted anywhere.",
    );
  };

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
        <div role="status" className="flex items-start justify-between gap-3 rounded-[12px] border border-[#e3e5e1] bg-[#fafbf9] px-3 py-2.5 text-[12.5px] leading-5 text-[#3b443e]">
          <span>{notice}</span>
          <button type="button" className="shrink-0 font-semibold text-[#6b746e] hover:text-[#1a201c]" onClick={() => setNotice(null)}>
            Dismiss
          </button>
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
                  setStatus(tab.id);
                  setShown(PAGE);
                  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[999px] px-3 text-[12px] font-semibold transition ${
                  active ? "bg-[#1f2b24] text-[#fff]" : "bg-[#f3f4f2] text-[#4b544e] hover:bg-[#e9ebe8]"
                }`}
              >
                {tab.label}
                <span className={`rounded-[999px] px-1.5 text-[10.5px] tabular-nums ${active ? "bg-[#fff]/20" : warn ? "bg-[#fdecc8] text-[#9a5b00]" : "bg-[#fff] text-[#6b746e]"}`}>{counts[tab.id]}</span>
              </button>
            );
          })}
      </div>

      {/* Search, filters and sort */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="relative block min-w-0">
          <span className="sr-only">Search reels</span>
          <Icon d={ICONS.search} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} placeholder="Search caption or link" className={`${fieldClass} h-9 w-full pl-8`} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value as SourceView); setShown(PAGE); }} className={`${fieldClass} h-9 min-w-0 text-[12.5px]`}>
            <option value="all">Any source</option>
            <option value="sync">Found by sync</option>
            <option value="creator">Sent by creator</option>
            <option value="team">Added by team</option>
          </select>
          <select aria-label="Posted" value={period} onChange={(e) => { setPeriod(e.target.value as PeriodView); setShown(PAGE); }} className={`${fieldClass} h-9 min-w-0 text-[12.5px]`}>
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
        <span className="tabular-nums">
          {visible.length} {visible.length === 1 ? "reel" : "reels"} · ▶ {formatCompact(totals.views)} · ♥ {formatCompact(totals.likes)}
          {status !== "before_link" && totals.approvedViews ? <span className="text-[#1f5131]"> · {formatCompact(totals.approvedViews)} approved views</span> : null}
          {filtersOn ? (
            <button type="button" className="ml-2 font-semibold text-[#2b5d4a] hover:underline" onClick={() => { setSource("all"); setPeriod("all"); setQuery(""); }}>
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
          {visible.slice(0, shown).map(({ post, tracking, removed }) => {
            const before = tracking === "before_link" || removed;
            const busy = busyId === post.id;
            return (
              <li key={post.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 ${before ? "bg-[#f7f8f6]" : post.status === "submitted" ? "bg-[#fffaf0]" : ""}`}>
                <div className={`min-w-0 flex-1 basis-56 ${before ? "opacity-70" : ""}`}>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <a href={post.url} target="_blank" rel="noreferrer" className="min-w-0 max-w-full truncate text-[13px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">
                      {post.caption || post.url}
                    </a>
                    {sourceOf(post) === "sync" ? <StatusChip label="Auto" tone="info" /> : sourceOf(post) === "creator" ? <StatusChip label="Creator" tone="neutral" /> : null}
                    {removed ? <StatusChip label="Removed" tone="danger" /> : before ? <StatusChip label="Before linking" tone="neutral" /> : post.status !== "approved" ? <StatusChip label={post.status === "submitted" ? "To review" : "Rejected"} tone={post.status === "submitted" ? "warning" : "danger"} /> : <StatusChip label="Approved" tone="success" />}
                    {tracking === "undated" ? <StatusChip label="No date" tone="warning" /> : null}
                  </div>
                  <div className="text-[11.5px] text-[#8a928c]">
                    {post.postedAt ? `Posted ${formatDate(post.postedAt)}` : "Posting date unknown"}
                    {post.submittedByWorker ? ` · sent by creator ${formatRelative(post.createdAt)}` : sourceOf(post) === "sync" ? ` · found by sync, updated ${formatRelative(post.updatedAt)}` : ` · updated ${formatRelative(post.updatedAt)}`}
                  </div>
                  {removed ? (
                    <div className="mt-0.5 text-[11.5px] text-[#6b746e]">
                      Removed {formatRelative(post.removedAt)}
                      {post.removalReason ? `: ${post.removalReason}` : ""}. Hidden from the creator and not counted.
                    </div>
                  ) : before ? (
                    <div className="mt-0.5 text-[11.5px] text-[#6b746e]">Not tracked: posted before {since}. Its views don&apos;t count towards pay.</div>
                  ) : null}
                  {!before && post.status === "rejected" && post.reviewNote ? <div className="mt-0.5 truncate text-[11.5px] text-[#b42318]">Note: {post.reviewNote}</div> : null}
                </div>
                <div className={`gap-3 text-[12px] tabular-nums text-[#3b443e] ${post.views === undefined && post.likes === undefined && post.comments === undefined ? "hidden" : "flex"} ${before ? "opacity-60" : ""}`}>
                  <span title="Views">▶ {formatCompact(post.views)}</span>
                  <span title="Likes">♥ {formatCompact(post.likes)}</span>
                  <span title="Comments">💬 {formatCompact(post.comments)}</span>
                </div>
                {post.status === "submitted" && !before ? (
                  <div className="flex w-full gap-1.5 sm:w-auto">
                    <button type="button" className={`${btnPrimary} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy || !!bulk?.running} onClick={() => void onReview(post, "approved")}>
                      {busy ? <Spinner /> : <Icon d={ICONS.check} className="h-3.5 w-3.5" />}
                      Approve
                    </button>
                    <button type="button" className={`${btnGhost} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy} onClick={() => setRejecting({ id: post.id, note: "" })}>
                      Reject
                    </button>
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
                        onClick={() => void onReview(post, "rejected", rejecting.note).then((ok) => ok && setRejecting(null))}
                      >
                        Reject reel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex gap-1">
                  {removed ? (
                    <button type="button" className={`${btnGhost} h-8 px-2.5 text-[12px]`} disabled={busy} onClick={() => void onRestore(post).then((ok) => ok && setNotice("Reel restored. It's back in To review."))}>
                      {busy ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} className="h-3.5 w-3.5" />}
                      Restore
                    </button>
                  ) : (
                    <>
                      {!before ? (
                        <button type="button" className={btnIcon} onClick={() => onEdit(post)} aria-label="Update numbers" title="Update numbers">
                          <Icon d={ICONS.refresh} />
                        </button>
                      ) : null}
                      <button type="button" className={btnIcon} disabled={busy} onClick={() => setRemoving({ post, reason: "", busy: false })} aria-label="Remove reel" title="Remove from Reelencer">
                        <Icon d={ICONS.x} />
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
          {status === "submitted" && !filtersOn ? "Nothing waiting for review." : "No reels match these filters."}
        </p>
      )}

      {visible.length > shown ? (
        <button type="button" className={`${btnGhost} h-9 w-full text-[12.5px]`} onClick={() => setShown((count) => count + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
        </button>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="Remove this reel?"
          body={
            <>
              It disappears from @{account.handle}&apos;s Linked page and stops counting everywhere: views, earnings, claims and review queues. Sync won&apos;t add it again and the creator can&apos;t resubmit it. You can restore it from the Removed tab.
            </>
          }
          confirmLabel="Remove reel"
          tone="danger"
          icon={ICONS.x}
          busy={removing.busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        >
          <label className="mt-3 block text-[12px] font-semibold text-[#3b443e]">
            Reason <span className="font-normal text-[#8a928c]">(optional, team only)</span>
            <input
              value={removing.reason}
              maxLength={300}
              onChange={(e) => setRemoving({ ...removing, reason: e.target.value })}
              placeholder="e.g. Duplicate, not for this gig, reposted content"
              className={`${fieldClass} mt-1 h-9 w-full`}
            />
          </label>
        </ConfirmDialog>
      ) : null}

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
