"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { liveSelfieChallenge } from "@/lib/kycSelfie";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  Avatar,
  Banner,
  BulkBar,
  type BulkProgress,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ICONS,
  Icon,
  Overlay,
  SelectAllCheckbox,
  Spinner,
  StatusChip,
  ViewToggle,
  btnBase,
  btnGhost,
  btnIcon,
  bulkBtn,
  cardClass,
  fieldClass,
  formatDateTime,
  formatRelative,
  runPool,
  statusLabel,
  toneDot,
  toneFor,
  useEscape,
  usePersistedState,
} from "./adminUi";

export type KycEvent = {
  created_at: string;
  status: string;
  note?: string;
};

export type KycRow = {
  id: string;
  submitted_at: string;
  legal_name: string;
  email?: string;
  user_id: string;
  id_type: string;
  id_number: string;
  phone?: string;
  address?: string;
  id_doc_url?: string;
  id_doc_path?: string;
  selfie_url?: string;
  selfie_path?: string;
  status: string;
  events?: KycEvent[];
};

type StatusFilter = "all" | "pending" | "approved" | "rejected";
type Decision = "approved" | "rejected";
type ViewMode = "list" | "cards";
type PatchResult = { ok: boolean; error?: string; mailSent?: boolean; mailRecipient?: string; mailReason?: string };

type Props = {
  rows: KycRow[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  lastSyncAt: string | null;
  onRefresh: (opts?: { preserveFeedback?: boolean }) => Promise<void>;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
};

const REJECT_PRESETS = ["ID details don't match", "Document is blurry or cropped", "Selfie doesn't match ID", "ID is expired", "Wrong document type"];
const VIEW_MODES = ["list", "cards"] as const;

const docsOf = (row: KycRow) => [
  { key: "id", label: "ID document", url: row.id_doc_url, path: row.id_doc_path, file: `id-${row.id}.jpg` },
  { key: "selfie", label: "Selfie", url: row.selfie_url, path: row.selfie_path, file: `selfie-${row.id}.jpg` },
];

async function patchKyc(row: KycRow, decision: Decision, note: string | null, rejectionReason?: string | null): Promise<PatchResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "Your session expired. Sign in again." };
    const res = await fetch("/api/admin/kyc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: row.id,
        submittedAt: row.submitted_at,
        status: decision,
        adminNote: note,
        ...(decision === "rejected" ? { rejectionReason: rejectionReason?.trim() || null } : {}),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: payload?.error || `Failed to ${decision === "approved" ? "approve" : "reject"} KYC` };
    return {
      ok: true,
      mailSent: !!payload?.mailStatus?.sent,
      mailRecipient: payload?.mailStatus?.recipient,
      mailReason: payload?.mailStatus?.sent ? undefined : payload?.mailStatus?.reason,
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update KYC" };
  }
}

export default function KycReviewPanel({ rows, loading, error, notice, lastSyncAt, onRefresh, setError, setNotice }: Props) {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [view, setView] = usePersistedState<ViewMode>("igops:kyc-view", "list", VIEW_MODES);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ id: string; decision: Decision } | null>(null);
  const [bulk, setBulk] = useState<BulkProgress>(null);
  const [rejectTargets, setRejectTargets] = useState<KycRow[] | null>(null);
  const [approveTargets, setApproveTargets] = useState<KycRow[] | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [timelineRow, setTimelineRow] = useState<KycRow | null>(null);
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);

  const working = !!busy || !!bulk;

  useEscape(!!preview, () => setPreview(null));
  useEscape(!preview && !!timelineRow, () => setTimelineRow(null));
  useEscape(!!rejectTargets && !working, () => setRejectTargets(null));

  const counts = useMemo(() => {
    const out = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
    rows.forEach((row) => {
      const key = row.status?.toLowerCase();
      if (key === "pending" || key === "approved" || key === "rejected") out[key] += 1;
    });
    return out;
  }, [rows]);

  // Land on "All" when the default pending queue is empty so the page never looks blank.
  const effectiveFilter: StatusFilter = filter === "pending" && counts.pending === 0 && rows.length > 0 && !query ? "all" : filter;

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => effectiveFilter === "all" || row.status?.toLowerCase() === effectiveFilter)
      .filter((row) =>
        !q
          ? true
          : [row.legal_name, row.email, row.user_id, row.id_number, row.phone, row.address, row.id_type]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        const diff = new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
        return sort === "newest" ? diff : -diff;
      });
  }, [rows, effectiveFilter, query, sort]);

  // Selection is scoped to what's on screen; hidden rows never get acted on.
  const selectedRows = visibleRows.filter((row) => selected.has(row.id));
  const allVisibleSelected = visibleRows.length > 0 && selectedRows.length === visibleRows.length;

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () => setSelected(new Set(visibleRows.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const decideOne = async (row: KycRow, decision: Decision, rejectionReason?: string | null): Promise<boolean> => {
    setError(null);
    setNotice(null);
    setBusy({ id: row.id, decision });
    const verb = decision === "approved" ? "approved" : "rejected";
    const result = await patchKyc(row, decision, noteDraft[row.id]?.trim() || null, rejectionReason);
    if (!result.ok) {
      setError(result.error ?? "Failed to update KYC");
    } else {
      if (result.mailSent) setNotice(`${row.legal_name}'s KYC ${verb}. Notification sent to ${result.mailRecipient}.`);
      else if (result.mailReason) setError(`KYC ${verb}, but email notification was not sent: ${result.mailReason}`);
      else setNotice(`${row.legal_name}'s KYC ${verb}.`);
      setNoteDraft((prev) => ({ ...prev, [row.id]: "" }));
      setRejectTargets(null);
    }
    await onRefresh({ preserveFeedback: true });
    setBusy(null);
    return result.ok;
  };

  const decideMany = async (targets: KycRow[], decision: Decision, rejectionReason?: string | null) => {
    const actionable = targets.filter((row) => row.status?.toLowerCase() !== decision);
    const skipped = targets.length - actionable.length;
    const verb = decision === "approved" ? "Approved" : "Rejected";
    setError(null);
    setNotice(null);
    setRejectTargets(null);
    setApproveTargets(null);
    if (!actionable.length) {
      setNotice(`All ${targets.length} selected request${targets.length === 1 ? " is" : "s are"} already ${decision}.`);
      return;
    }
    setBulk({ label: `${decision === "approved" ? "Approving" : "Rejecting"} requests…`, done: 0, total: actionable.length });
    const results = await runPool(
      actionable,
      3,
      (row) => patchKyc(row, decision, noteDraft[row.id]?.trim() || null, rejectionReason),
      (done) => setBulk((prev) => (prev ? { ...prev, done } : prev)),
    );
    const failed = results.map((r, i) => ({ r, row: actionable[i] })).filter(({ r }) => !r.ok);
    const ok = results.filter((r) => r.ok);
    const mailFailed = ok.filter((r) => !r.mailSent && r.mailReason).length;

    const parts = [`${verb} ${ok.length} request${ok.length === 1 ? "" : "s"}`];
    if (ok.length) parts.push(`${ok.length - mailFailed} email${ok.length - mailFailed === 1 ? "" : "s"} sent`);
    if (skipped) parts.push(`${skipped} already ${decision}, skipped`);
    if (ok.length) setNotice(`${parts.join(" · ")}.`);
    if (failed.length || mailFailed) {
      const lines = [
        failed.length ? `${failed.length} failed: ${failed.map(({ row, r }) => `${row.legal_name} (${r.error})`).join(", ")}` : "",
        mailFailed ? `${mailFailed} notification email${mailFailed === 1 ? "" : "s"} not sent` : "",
      ].filter(Boolean);
      setError(lines.join(". ") + ".");
    }
    setNoteDraft((prev) => {
      const next = { ...prev };
      actionable.forEach((row, i) => {
        if (results[i].ok) delete next[row.id];
      });
      return next;
    });
    // Keep only the failures selected so the admin can retry them.
    setSelected(new Set(failed.map(({ row }) => row.id)));
    await onRefresh({ preserveFeedback: true });
    setBulk(null);
  };

  // ── Focused review mode ─────────────────────────────────────────────────────
  // Works over a snapshot of ids (taken when opened) but always reads fresh row data, so a decision
  // refreshing the list never makes the reviewer jump around.
  const [review, setReview] = useState<{ ids: string[]; index: number; caughtUp?: boolean } | null>(null);
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({});
  const [reviewChecks, setReviewChecks] = useState<Record<string, string[]>>({});
  const reviewRow = review && !review.caughtUp ? rows.find((r) => r.id === review.ids[review.index]) ?? null : null;
  const isPending = (row?: KycRow | null) => !!row && row.status?.toLowerCase() === "pending";

  const openReview = (ids: string[], startId?: string) => {
    if (!ids.length) return;
    setReview({ ids, index: Math.max(0, startId ? ids.indexOf(startId) : 0) });
  };
  const stepReview = (delta: number) =>
    setReview((prev) => (prev && !prev.caughtUp ? { ...prev, index: Math.min(prev.ids.length - 1, Math.max(0, prev.index + delta)) } : prev));
  const closeReview = () => setReview(null);

  const decideInReview = async (row: KycRow, decision: Decision) => {
    const ok = await decideOne(row, decision, decision === "rejected" ? reviewReason[row.id] ?? "" : undefined);
    if (!ok || !review) return;
    // Auto-advance to the next request that's still pending (later first, then earlier); otherwise we're done.
    const statusOf = (id: string) => (id === row.id ? decision : rows.find((r) => r.id === id)?.status?.toLowerCase());
    const after = review.ids.findIndex((id, i) => i > review.index && statusOf(id) === "pending");
    const before = review.ids.findIndex((id, i) => i < review.index && statusOf(id) === "pending");
    const next = after >= 0 ? after : before;
    setReview(next >= 0 ? { ...review, index: next } : { ...review, caughtUp: true });
  };

  useEscape(!preview && !rejectTargets && !!review, closeReview);
  useEffect(() => {
    if (!review) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (preview || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key.toLowerCase() === "j") stepReview(1);
      else if (event.key.toLowerCase() === "k") stepReview(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [review, preview]);

  const pendingQueueIds = rows
    .filter((row) => row.status?.toLowerCase() === "pending")
    .sort((a, b) => {
      const diff = new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
      return sort === "newest" ? diff : -diff;
    })
    .map((row) => row.id);

  const filterTabs: { id: StatusFilter; label: string; tone: string }[] = [
    { id: "pending", label: "Pending", tone: toneDot("warning") },
    { id: "approved", label: "Approved", tone: toneDot("success") },
    { id: "rejected", label: "Rejected", tone: toneDot("danger") },
    { id: "all", label: "All requests", tone: toneDot("neutral") },
  ];

  const selectedPendingCount = selectedRows.filter((r) => r.status?.toLowerCase() !== "approved").length;
  const selectedRejectableCount = selectedRows.filter((r) => r.status?.toLowerCase() !== "rejected").length;

  const rowProps = (row: KycRow) => ({
    row,
    selected: selected.has(row.id),
    onToggleSelect: () => toggle(setSelected, row.id),
    busy: busy?.id === row.id ? busy.decision : null,
    disabled: working,
    note: noteDraft[row.id] ?? "",
    onNote: (value: string) => setNoteDraft((prev) => ({ ...prev, [row.id]: value })),
    onApprove: () => void decideOne(row, "approved"),
    onReject: () => {
      setRejectReason("");
      setRejectTargets([row]);
    },
    onTimeline: () => setTimelineRow(row),
    onPreview: (src: string, title: string) => setPreview({ src, title }),
    // Review the visible list in order, starting at this request.
    onReview: () => openReview(visibleRows.map((r) => r.id), row.id),
  });

  return (
    <section className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Identity verification</h1>
          <p className="mt-0.5 text-[13px] text-[#616a64]">Review documents, then approve or reject one request or many at once.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 text-[12px] text-[#7a827c] sm:inline-flex" aria-live="polite">
            {loading && <Spinner className="border-[#7a827c]/30 border-t-[#7a827c]" />}
            {lastSyncAt ? `Synced ${formatRelative(lastSyncAt)}` : loading ? "Syncing…" : null}
          </span>
          <button type="button" className={btnGhost} onClick={() => void onRefresh({ preserveFeedback: true })} disabled={loading}>
            <Icon d={ICONS.refresh} className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden min-[400px]:inline">Refresh</span>
          </button>
          {counts.pending > 0 && (
            <button type="button" onClick={() => openReview(pendingQueueIds)} className={`${btnBase} h-9 bg-[#1f2b24] px-3.5 text-[#fff] hover:bg-[#2b3a31]`}>
              <Icon d={ICONS.shield} className="h-4 w-4" />
              Review {counts.pending} pending
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
      </div>

      {/* Status filters as stat tiles */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
        {filterTabs.map((tab) => {
          const active = effectiveFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setFilter(tab.id);
                clearSelection();
              }}
              aria-pressed={active}
              className={`min-w-0 rounded-[12px] border px-2.5 py-2 text-left transition sm:rounded-[14px] sm:px-4 sm:py-3 ${
                active ? "border-[#1f2b24] bg-[#fff] shadow-[0_0_0_1px_#1f2b24]" : "border-[#e3e5e1] bg-[#fff] hover:border-[#c9cec8]"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#616a64] sm:text-[12px]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tab.tone}`} />
                <span className="truncate">{tab.id === "all" ? <><span className="sm:hidden">All</span><span className="hidden sm:inline">{tab.label}</span></> : tab.label}</span>
              </div>
              <div className="mt-1 text-[19px] font-semibold tabular-nums leading-none text-[#1a201c] sm:text-[24px]">{counts[tab.id]}</div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative order-1 min-w-0 flex-1 basis-full sm:basis-auto">
          <span className="sr-only">Search KYC requests</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a928c]">
            <Icon d={ICONS.search} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone, ID number or user ID"
            className={`${fieldClass} h-10 pl-9`}
          />
        </label>
        <div className="order-2 flex flex-1 items-center gap-2 sm:flex-none">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
            className="h-10 min-w-0 flex-1 rounded-[10px] border bg-[#fff] px-3 text-[13px] font-medium sm:w-[150px] sm:flex-none"
            aria-label="Sort requests"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { id: "list", label: "List", icon: ICONS.rows },
              { id: "cards", label: "Cards", icon: ICONS.cards },
            ]}
          />
        </div>
      </div>

      {/* Feedback */}
      {(error || notice) && (
        <div className="space-y-2">
          {error && (
            <Banner tone="danger" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          )}
          {notice && (
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Banner>
          )}
        </div>
      )}

      {/* Results */}
      {loading && rows.length === 0 ? (
        <div className={`${cardClass} divide-y divide-[#eef0ec]`}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="flex animate-pulse items-center gap-3 px-4 py-3.5">
              <div className="h-4 w-4 rounded bg-[#eef0ec]" />
              <div className="size-9 rounded-full bg-[#eef0ec]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 rounded bg-[#eef0ec]" />
                <div className="h-3 w-56 rounded bg-[#f3f4f1]" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={ICONS.shield}
          title={rows.length === 0 ? "No KYC requests yet" : query ? "No matches" : `No ${effectiveFilter} requests`}
          body={
            rows.length === 0
              ? "New verification submissions from workers will appear here."
              : query
                ? "Try a different name, email or ID number."
                : "You're all caught up for this queue."
          }
        />
      ) : (
        <div className={view === "list" ? `${cardClass} overflow-hidden` : "space-y-3"}>
          {/* Selection header */}
          <div
            className={`flex items-center gap-3 px-4 py-2.5 text-[12.5px] text-[#616a64] ${
              view === "list" ? "border-b border-[#eef0ec] bg-[#fafbf9]" : `${cardClass} py-2.5`
            }`}
          >
            <SelectAllCheckbox
              checked={allVisibleSelected}
              indeterminate={selectedRows.length > 0}
              onChange={allVisibleSelected ? clearSelection : selectAllVisible}
              label="Select all visible requests"
            />
            <span className="font-medium">
              {selectedRows.length ? `${selectedRows.length} of ${visibleRows.length} selected` : `${visibleRows.length} request${visibleRows.length === 1 ? "" : "s"}`}
            </span>
            {view === "list" && (
              <div className="ml-auto hidden grid-cols-[minmax(0,1fr)_92px_110px_96px_112px] gap-4 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#8a928c] xl:mr-11 xl:grid xl:w-[640px]">
                <span>Document</span>
                <span>Files</span>
                <span>Submitted</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
            )}
          </div>

          {view === "list" ? (
            <ul className="divide-y divide-[#eef0ec]">
              {visibleRows.map((row) => (
                <KycListRow key={row.id} {...rowProps(row)} expanded={expanded.has(row.id)} onToggleExpand={() => toggle(setExpanded, row.id)} />
              ))}
            </ul>
          ) : (
            visibleRows.map((row) => <KycCard key={row.id} {...rowProps(row)} />)
          )}
        </div>
      )}

      {/* Bulk action bar */}
      <BulkBar count={selectedRows.length} total={visibleRows.length} onSelectAll={selectAllVisible} onClear={clearSelection} progress={bulk}>
        <button
          type="button"
          className={bulkBtn.danger}
          disabled={working || selectedRejectableCount === 0}
          onClick={() => {
            setRejectReason("");
            setRejectTargets(selectedRows);
          }}
        >
          <Icon d={ICONS.x} />
          Reject{selectedRejectableCount ? ` ${selectedRejectableCount}` : ""}
        </button>
        <button type="button" className={bulkBtn.primary} disabled={working || selectedPendingCount === 0} onClick={() => setApproveTargets(selectedRows)}>
          <Icon d={ICONS.check} />
          Approve{selectedPendingCount ? ` ${selectedPendingCount}` : ""}
        </button>
      </BulkBar>

      {/* Bulk approve confirmation */}
      {approveTargets && (
        <ConfirmDialog
          icon={ICONS.check}
          title={`Approve ${approveTargets.filter((r) => r.status?.toLowerCase() !== "approved").length} KYC request${approveTargets.length === 1 ? "" : "s"}?`}
          body={
            <>
              Each worker gets workspace access and an approval email.
              {approveTargets.some((r) => r.status?.toLowerCase() === "approved") && " Requests that are already approved will be skipped."}
            </>
          }
          confirmLabel="Approve & notify"
          busy={working}
          onCancel={() => setApproveTargets(null)}
          onConfirm={() => void decideMany(approveTargets, "approved")}
        >
          <NamesPreview rows={approveTargets} />
        </ConfirmDialog>
      )}

      {/* Reject dialog (single or bulk) */}
      {rejectTargets && (
        <Overlay onClose={() => !working && setRejectTargets(null)} labelledBy="kyc-reject-title">
          <div className="w-full max-w-md rounded-t-[18px] bg-[#fff] p-5 shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] sm:rounded-[18px]">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fdf0ef] text-[#b42318]">
                <Icon d={ICONS.x} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 id="kyc-reject-title" className="text-[15px] font-semibold text-[#1a201c]">
                  {rejectTargets.length === 1 ? `Reject ${rejectTargets[0].legal_name}'s KYC?` : `Reject ${rejectTargets.length} KYC requests?`}
                </h3>
                <p className="mt-0.5 text-[13px] text-[#616a64]">
                  {rejectTargets.length === 1 ? "The worker" : "Each worker"} will be emailed this reason and asked to resubmit.
                </p>
              </div>
            </div>
            {rejectTargets.length > 1 && <NamesPreview rows={rejectTargets} />}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {REJECT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRejectReason(preset)}
                  className={`rounded-[999px] px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${
                    rejectReason === preset ? "bg-[#1f2b24] text-[#fff] ring-[#1f2b24]" : "bg-[#fff] text-[#4b544e] ring-[#d9ddd8] hover:bg-[#f7f8f6]"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              autoFocus
              rows={3}
              maxLength={2000}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              className={`${fieldClass} mt-3 resize-y py-2`}
            />
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={btnGhost} disabled={working} onClick={() => setRejectTargets(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  void (rejectTargets.length === 1 ? decideOne(rejectTargets[0], "rejected", rejectReason) : decideMany(rejectTargets, "rejected", rejectReason))
                }
                className={`${btnBase} h-9 bg-[#b42318] px-4 text-[#fff] hover:bg-[#9a1d14]`}
              >
                {working ? <Spinner /> : null}
                Reject &amp; notify
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Timeline drawer */}
      {timelineRow && (
        <Overlay onClose={() => setTimelineRow(null)} labelledBy="kyc-timeline-title" side>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-[18px] bg-[#fff] shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
            <div className="flex items-center justify-between gap-3 border-b border-[#eef0ec] px-5 py-4">
              <div className="min-w-0">
                <h3 id="kyc-timeline-title" className="text-[15px] font-semibold text-[#1a201c]">
                  KYC timeline
                </h3>
                <p className="truncate text-[12.5px] text-[#616a64]">{timelineRow.legal_name}</p>
              </div>
              <button type="button" onClick={() => setTimelineRow(null)} className={`${btnIcon} size-9`} aria-label="Close timeline">
                <Icon d={ICONS.x} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <Timeline events={timelineRow.events ?? []} />
            </div>
          </div>
        </Overlay>
      )}

      {review &&
        createPortal(
          <KycReviewer
            row={reviewRow}
            caughtUp={!!review.caughtUp}
            position={review.index + 1}
            total={review.ids.length}
            pendingLeft={review.ids.filter((id) => isPending(rows.find((r) => r.id === id))).length}
            busy={reviewRow && busy?.id === reviewRow.id ? busy.decision : null}
            working={working}
            note={reviewRow ? noteDraft[reviewRow.id] ?? "" : ""}
            onNote={(value) => reviewRow && setNoteDraft((prev) => ({ ...prev, [reviewRow.id]: value }))}
            reason={reviewRow ? reviewReason[reviewRow.id] ?? "" : ""}
            onReason={(value) => reviewRow && setReviewReason((prev) => ({ ...prev, [reviewRow.id]: value }))}
            checks={reviewRow ? reviewChecks[reviewRow.id] ?? [] : []}
            onToggleCheck={(item) =>
              reviewRow &&
              setReviewChecks((prev) => {
                const current = prev[reviewRow.id] ?? [];
                return { ...prev, [reviewRow.id]: current.includes(item) ? current.filter((c) => c !== item) : [...current, item] };
              })
            }
            onPrev={() => stepReview(-1)}
            onNext={() => stepReview(1)}
            onClose={closeReview}
            onApprove={() => reviewRow && void decideInReview(reviewRow, "approved")}
            onReject={() => reviewRow && void decideInReview(reviewRow, "rejected")}
            onPreview={(src, title) => setPreview({ src, title })}
          />,
          document.body,
        )}

      {/* Image lightbox */}
      {preview && (
        <Overlay onClose={() => setPreview(null)} labelledBy="kyc-preview-title" dark>
          <div className="flex max-h-full w-full max-w-4xl flex-col items-center gap-3">
            <div className="flex w-full items-center justify-between gap-3 text-[#fff]">
              <span id="kyc-preview-title" className="truncate text-[13.5px] font-semibold">
                {preview.title}
              </span>
              <span className="flex items-center gap-1">
                <a href={preview.src} target="_blank" rel="noreferrer" className="inline-flex size-9 items-center justify-center rounded-[10px] hover:bg-[#fff]/15" aria-label="Open in new tab">
                  <Icon d={ICONS.open} />
                </a>
                <button type="button" onClick={() => setPreview(null)} className="inline-flex size-9 items-center justify-center rounded-[10px] hover:bg-[#fff]/15" aria-label="Close preview">
                  <Icon d={ICONS.x} />
                </button>
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.src} alt={preview.title} className="max-h-[80vh] w-auto max-w-full rounded-[12px] object-contain" />
          </div>
        </Overlay>
      )}
    </section>
  );
}

type RowProps = {
  row: KycRow;
  selected: boolean;
  onToggleSelect: () => void;
  busy: Decision | null;
  disabled: boolean;
  note: string;
  onNote: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onTimeline: () => void;
  onPreview: (src: string, title: string) => void;
  onReview: () => void;
};

/** Compact, scannable row. Expands inline to the full review body. */
function KycListRow(props: RowProps & { expanded: boolean; onToggleExpand: () => void }) {
  const { row, selected, onToggleSelect, busy, disabled, onApprove, onReject, expanded, onToggleExpand, onPreview } = props;
  const status = row.status?.toLowerCase();
  return (
    <li className={selected ? "bg-[#f5faf6]" : expanded ? "bg-[#fcfcfb]" : ""}>
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${row.legal_name}`} className="h-4 w-4 shrink-0 cursor-pointer rounded" />
        <button type="button" onClick={props.onReview} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Open in review mode">
          <Avatar name={row.legal_name} className="size-9 text-[12px]" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">{row.legal_name}</span>
              <span className="xl:hidden">
                <StatusChip status={row.status} />
              </span>
            </span>
            <span className="block truncate text-[12.5px] text-[#616a64]">{row.email || row.phone || row.user_id}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-[#8a928c] xl:hidden">
              {row.id_type} · {row.id_number} · {formatRelative(row.submitted_at)}
            </span>
          </span>
        </button>

        <div className="hidden items-center gap-4 xl:grid xl:w-[640px] xl:grid-cols-[minmax(0,1fr)_92px_110px_96px_112px]">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-[#8a928c]">{row.id_type || "ID"}</span>
            <span className="block truncate font-mono text-[12.5px] text-[#1a201c]">{row.id_number || "—"}</span>
          </span>
          <span className="flex gap-1">
            {docsOf(row).map((doc) =>
              doc.url ? (
                <button
                  key={doc.key}
                  type="button"
                  onClick={() => onPreview(doc.url!, `${row.legal_name} · ${doc.label}`)}
                  className="size-10 overflow-hidden rounded-[8px] border border-[#e3e5e1] bg-[#f3f4f1] transition hover:ring-2 hover:ring-[#2e7d4f]/40"
                  aria-label={`Preview ${doc.label}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ) : (
                <span key={doc.key} className="flex size-10 items-center justify-center rounded-[8px] border border-dashed border-[#d9ddd8] text-[#a3aaa5]" title={`${doc.label} missing`}>
                  <Icon d={ICONS.image} className="h-4 w-4" />
                </span>
              ),
            )}
          </span>
          <span className="text-[12.5px] text-[#4b544e]" title={formatDateTime(row.submitted_at)}>
            {formatRelative(row.submitted_at)}
          </span>
          <span>
            <StatusChip status={row.status} />
          </span>
          <span className="flex justify-end gap-1">
            <QuickActions busy={busy} disabled={disabled} status={status} onApprove={onApprove} onReject={onReject} />
          </span>
        </div>

        <span className="flex items-center gap-1 xl:hidden">
          <span className="hidden sm:flex sm:gap-1">
            <QuickActions busy={busy} disabled={disabled} status={status} onApprove={onApprove} onReject={onReject} />
          </span>
        </span>
        <button type="button" onClick={onToggleExpand} className={btnIcon} aria-label={expanded ? "Collapse" : "Expand"}>
          <Icon d={ICONS.chevronDown} className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[#eef0ec]">
          <KycBody {...props} />
        </div>
      )}
    </li>
  );
}

function QuickActions({ busy, disabled, status, onApprove, onReject }: { busy: Decision | null; disabled: boolean; status: string; onApprove: () => void; onReject: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled || status === "approved"}
        className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#d9ddd8] bg-[#fff] px-2 text-[12px] font-semibold text-[#226b40] transition hover:bg-[#ebf5ee] disabled:cursor-not-allowed disabled:opacity-40"
        title="Approve"
      >
        {busy === "approved" ? <Spinner className="border-[#226b40]/30 border-t-[#226b40]" /> : <Icon d={ICONS.check} className="h-3.5 w-3.5" />}
        <span className="sr-only sm:not-sr-only">Approve</span>
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={disabled || status === "rejected"}
        className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#d9ddd8] bg-[#fff] text-[#b42318] transition hover:bg-[#fdf0ef] disabled:cursor-not-allowed disabled:opacity-40"
        title="Reject"
        aria-label="Reject"
      >
        {busy === "rejected" ? <Spinner className="border-[#b42318]/30 border-t-[#b42318]" /> : <Icon d={ICONS.x} className="h-3.5 w-3.5" />}
      </button>
    </>
  );
}

function KycCard(props: RowProps) {
  const { row, selected, onToggleSelect, busy } = props;
  return (
    <article
      className={`overflow-hidden rounded-[16px] border bg-[#fff] shadow-[0_1px_2px_rgba(26,32,28,0.05)] transition ${
        selected ? "border-[#2e7d4f] shadow-[0_0_0_1px_#2e7d4f]" : busy ? "border-[#b8c9bd]" : "border-[#e3e5e1]"
      }`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#eef0ec] px-4 py-3.5 sm:px-5">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${row.legal_name}`} className="h-4 w-4 shrink-0 cursor-pointer rounded" />
        <Avatar name={row.legal_name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-[#1a201c]">{row.legal_name}</h2>
            <StatusChip status={row.status} />
          </div>
          {row.email && <div className="truncate text-[12.5px] text-[#616a64]">{row.email}</div>}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-[#7a827c]" title={formatDateTime(row.submitted_at)}>
          <Icon d={ICONS.clock} className="h-3.5 w-3.5" />
          Submitted {formatRelative(row.submitted_at)}
        </div>
        <button type="button" onClick={props.onReview} className={`${btnGhost} h-8 px-2.5 text-[12.5px]`}>
          Review
        </button>
      </header>
      <KycBody {...props} />
    </article>
  );
}

/** Details, documents and the decision panel — shared by card view and expanded list rows. */
function KycBody({ row, busy, disabled, note, onNote, onApprove, onReject, onTimeline, onPreview }: RowProps) {
  const status = row.status?.toLowerCase();
  const events = Array.isArray(row.events) ? row.events : [];
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4 p-4 sm:p-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-3">
          <Detail icon={ICONS.id} label={row.id_type || "ID"} value={row.id_number} mono />
          <Detail icon={ICONS.phone} label="Phone" value={row.phone} />
          <Detail icon={ICONS.pin} label="Address" value={row.address} wide />
          <div className="col-span-2 min-w-0">
            <dt className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-[#8a928c]">
              <Icon d={ICONS.user} className="h-3.5 w-3.5" />
              User ID
            </dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-2">
              <code className="truncate font-mono text-[12.5px] text-[#4b544e]">{row.user_id}</code>
              <CopyButton value={row.user_id} />
            </dd>
          </div>
        </dl>

        <div className="grid max-w-[520px] grid-cols-2 gap-2.5 2xl:max-w-none">
          {docsOf(row).map((doc) => (
            <figure key={doc.key} className="min-w-0 overflow-hidden rounded-[12px] border border-[#e3e5e1] bg-[#f7f8f6]">
              {doc.url ? (
                <button
                  type="button"
                  onClick={() => onPreview(doc.url!, `${row.legal_name} · ${doc.label}`)}
                  className="group relative block aspect-[4/3] w-full overflow-hidden bg-[#eef0ec]"
                  aria-label={`Preview ${doc.label}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.url} alt={doc.label} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  <span className="absolute inset-0 flex items-center justify-center bg-[#0f1411]/0 text-[12px] font-semibold text-[#fff] opacity-0 transition group-hover:bg-[#0f1411]/35 group-hover:opacity-100">
                    Preview
                  </span>
                </button>
              ) : (
                <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 text-[12px] text-[#8a928c]">
                  <Icon d={ICONS.image} className="h-5 w-5" />
                  Not uploaded
                </div>
              )}
              <figcaption className="flex items-center justify-between gap-1 border-t border-[#e3e5e1] bg-[#fff] py-1 pl-2.5 pr-1">
                <span className="truncate text-[12px] font-semibold text-[#1a201c]">{doc.label}</span>
                <span className="flex items-center">
                  {doc.url && (
                    <a href={doc.url} target="_blank" rel="noreferrer" className={btnIcon} title="Open in new tab" aria-label={`Open ${doc.label} in new tab`}>
                      <Icon d={ICONS.open} className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {doc.path && (
                    <a
                      href={`/api/kyc/file?path=${encodeURIComponent(doc.path)}&name=${doc.file}`}
                      target="_blank"
                      rel="noreferrer"
                      className={btnIcon}
                      title="Download"
                      aria-label={`Download ${doc.label}`}
                    >
                      <Icon d={ICONS.download} className="h-3.5 w-3.5" />
                    </a>
                  )}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <aside className="flex flex-col gap-4 border-t border-[#eef0ec] bg-[#fafbf9] p-4 sm:p-5 lg:border-l lg:border-t-0">
        <div>
          <label htmlFor={`kyc-note-${row.id}`} className="text-[12px] font-semibold text-[#1a201c]">
            Admin note <span className="font-normal text-[#8a928c]">· added to timeline & email</span>
          </label>
          <textarea
            id={`kyc-note-${row.id}`}
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Optional context for this decision"
            className={`${fieldClass} mt-1.5 resize-y py-2`}
          />
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" disabled={disabled || status === "approved"} onClick={onApprove} className={`${btnBase} h-10 bg-[#1f2b24] px-3 text-[#fff] hover:bg-[#2b3a31]`}>
              {busy === "approved" ? <Spinner /> : <Icon d={ICONS.check} />}
              {status === "approved" ? "Approved" : "Approve"}
            </button>
            <button
              type="button"
              disabled={disabled || status === "rejected"}
              onClick={onReject}
              className={`${btnBase} h-10 border border-[#f0c6c1] bg-[#fff] px-3 text-[#b42318] hover:bg-[#fdf0ef]`}
            >
              {busy === "rejected" ? <Spinner className="border-[#b42318]/30 border-t-[#b42318]" /> : <Icon d={ICONS.x} />}
              {status === "rejected" ? "Rejected" : "Reject"}
            </button>
          </div>
          {(status === "approved" || status === "rejected") && (
            <p className="mt-2 text-[11.5px] text-[#7a827c]">
              Already {status}. You can still {status === "approved" ? "reject" : "approve"} to reverse it.
            </p>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#1a201c]">Recent activity</span>
            {events.length > 0 && (
              <button type="button" onClick={onTimeline} className="text-[12px] font-semibold text-[#2b5d4a] hover:underline">
                View all ({events.length})
              </button>
            )}
          </div>
          {events.length === 0 ? <p className="mt-1.5 text-[12px] text-[#8a928c]">No activity recorded yet.</p> : <Timeline events={events.slice(0, 3)} compact />}
        </div>
      </aside>
    </div>
  );
}

function NamesPreview({ rows }: { rows: KycRow[] }) {
  const shown = rows.slice(0, 6);
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((row) => (
        <span key={row.id} className="inline-flex max-w-full items-center gap-1.5 rounded-[999px] bg-[#f1f3f0] py-0.5 pl-0.5 pr-2 text-[12px] text-[#1a201c]">
          <Avatar name={row.legal_name} className="size-5 text-[9px]" />
          <span className="truncate">{row.legal_name}</span>
        </span>
      ))}
      {rows.length > shown.length && <span className="px-1 py-0.5 text-[12px] text-[#7a827c]">+{rows.length - shown.length} more</span>}
    </div>
  );
}

function Detail({ icon, label, value, mono, wide }: { icon: string; label: string; value?: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-[#8a928c]">
        <Icon d={icon} className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className={`mt-0.5 break-words text-[13.5px] text-[#1a201c] ${mono ? "font-mono text-[13px]" : ""}`}>
        {value?.trim() ? value : <span className="text-[#a3aaa5]">Not provided</span>}
      </dd>
    </div>
  );
}

function Timeline({ events, compact }: { events: KycEvent[]; compact?: boolean }) {
  return (
    <ol className={`relative ${compact ? "mt-2" : ""}`}>
      {events.map((ev, idx) => {
        const last = idx === events.length - 1;
        return (
          <li key={`${ev.created_at}-${idx}`} className={`relative flex gap-3 ${last ? "" : compact ? "pb-2.5" : "pb-4"}`}>
            {!last && <span className="absolute left-[4.5px] top-3 h-full w-px bg-[#e3e5e1]" aria-hidden="true" />}
            <span className={`relative mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ring-[3px] ring-[#fff] ${toneDot(toneFor(ev.status))}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px] font-semibold text-[#1a201c]">{statusLabel(ev.status)}</span>
                <span className="text-[11.5px] text-[#8a928c]">{formatDateTime(ev.created_at)}</span>
              </div>
              {ev.note && <p className={`break-words text-[12.5px] text-[#4b544e] ${compact ? "line-clamp-2" : "mt-0.5"}`}>{ev.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const REVIEW_CHECKS = ["Name matches the ID", "Face matches the selfie", "ID number is readable and matches", "Right document type and not expired"];
/** Live selfies add a check that the photo shows the action the creator was asked to do on camera. */
const reviewChecksFor = (row: KycRow | null | undefined) => {
  const challenge = liveSelfieChallenge(row?.selfie_path);
  return challenge ? [...REVIEW_CHECKS, `Selfie shows the action: ${challenge.text}`] : REVIEW_CHECKS;
};

/**
 * Focused, one-request-at-a-time review: big side-by-side ID vs selfie, details with copy buttons, a reviewer
 * checklist (guidance only, not saved), note + rejection reason, history, and a pinned decision bar.
 * Right-side panel on desktop, full-screen sheet on phones and tablets.
 */
function KycReviewer({
  row,
  caughtUp,
  position,
  total,
  pendingLeft,
  busy,
  working,
  note,
  onNote,
  reason,
  onReason,
  checks,
  onToggleCheck,
  onPrev,
  onNext,
  onClose,
  onApprove,
  onReject,
  onPreview,
}: {
  row: KycRow | null;
  caughtUp: boolean;
  position: number;
  total: number;
  pendingLeft: number;
  busy: Decision | null;
  working: boolean;
  note: string;
  onNote: (value: string) => void;
  reason: string;
  onReason: (value: string) => void;
  checks: string[];
  onToggleCheck: (item: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPreview: (src: string, title: string) => void;
}) {
  const status = row?.status?.toLowerCase();
  const arrowBtn = "grid size-9 place-items-center rounded-[10px] border border-[#d9ddd8] bg-[#fff] text-[#1a201c] transition hover:bg-[#f7f8f6] disabled:cursor-default disabled:opacity-40";
  return (
    <div role="dialog" aria-modal="true" aria-label="KYC review" className="ops-dashboard-skin fixed inset-0 z-[55] flex text-slate-900">
      <button type="button" tabIndex={-1} aria-label="Close review" onClick={onClose} className="hidden flex-1 bg-[#0f1411]/40 backdrop-blur-[1px] lg:block" />
      <div className="flex h-full w-full flex-col bg-[#f6f7f5] shadow-[-24px_0_64px_-24px_rgba(15,20,17,0.45)] lg:max-w-[min(64rem,92vw)]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#e3e5e1] bg-[#fff]/95 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur sm:px-5">
          <button type="button" onClick={onClose} className={`${btnIcon} size-9 shrink-0`} aria-label="Close review">
            <Icon d={ICONS.x} />
          </button>
          {row ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Avatar name={row.legal_name} className="hidden size-9 text-[12px] sm:flex" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#1a201c]">{row.legal_name}</h2>
                  <StatusChip status={row.status} />
                </div>
                <div className="truncate text-[12px] text-[#7a827c]">
                  Submitted {formatRelative(row.submitted_at)} · {pendingLeft} pending in this queue
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1 text-[15px] font-semibold text-[#1a201c]">KYC review</div>
          )}
          {!caughtUp && (
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden text-[12.5px] text-[#616a64] sm:inline">
                <span className="font-semibold tabular-nums text-[#1a201c]">{position}</span> of <span className="tabular-nums">{total}</span>
              </span>
              <button type="button" className={arrowBtn} onClick={onPrev} disabled={position <= 1} aria-label="Previous request">
                <Icon d={ICONS.chevronDown} className="h-4 w-4 rotate-90" />
              </button>
              <button type="button" className={arrowBtn} onClick={onNext} disabled={position >= total} aria-label="Next request">
                <Icon d={ICONS.chevronDown} className="h-4 w-4 -rotate-90" />
              </button>
            </div>
          )}
        </div>

        {caughtUp || !row ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#2e7d4f] text-[#fff]">
                <Icon d={ICONS.check} className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-[18px] font-semibold text-[#1a201c]">{caughtUp ? "All caught up" : "Request not found"}</h3>
              <p className="mt-1 text-[13px] text-[#616a64]">
                {caughtUp ? "No pending KYC requests are left in this queue. Nice work." : "It may have been removed or changed by another admin."}
              </p>
              <button type="button" onClick={onClose} className={`${btnBase} mt-5 h-10 bg-[#1f2b24] px-5 text-[#fff] hover:bg-[#2b3a31]`}>
                Back to the list
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="space-y-4 p-3 sm:p-5">
                {/* Side-by-side comparison */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {docsOf(row).map((doc) => (
                    <figure key={doc.key} className="min-w-0">
                      {doc.url ? (
                        <button
                          type="button"
                          onClick={() => onPreview(doc.url!, `${row.legal_name} · ${doc.label}`)}
                          className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[16px] bg-[#101814] ring-1 ring-[#e3e5e1] transition hover:ring-2 hover:ring-[#2e7d4f]/50"
                          aria-label={`Enlarge ${doc.label}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={doc.url} alt={`${row.legal_name} ${doc.label}`} className="h-full w-full object-contain" />
                          <span className="absolute left-2.5 top-2.5 rounded-full bg-[#000]/60 px-2.5 py-1 text-[11.5px] font-semibold text-[#fff] backdrop-blur-sm">{doc.label}</span>
                          <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-[#fff]/90 px-2.5 py-1 text-[11.5px] font-semibold text-[#1a201c] opacity-90 transition group-hover:opacity-100">
                            <Icon d={ICONS.open} className="h-3.5 w-3.5" />
                            Enlarge
                          </span>
                        </button>
                      ) : (
                        <div className="grid aspect-[4/3] w-full place-items-center rounded-[16px] border border-dashed border-[#d9ddd8] bg-[#fff] text-center">
                          <span>
                            <Icon d={ICONS.image} className="mx-auto h-6 w-6 text-[#a3aaa5]" />
                            <span className="mt-1 block text-[12.5px] font-semibold text-[#7a827c]">{doc.label} not provided</span>
                          </span>
                        </div>
                      )}
                      {doc.key === "selfie" ? (
                        (() => {
                          const challenge = liveSelfieChallenge(row.selfie_path);
                          return challenge ? (
                            <figcaption className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#4b544e]">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#ebf5ee] px-2 py-0.5 font-semibold text-[#226b40] ring-1 ring-inset ring-[#c9e3d2]">● Live camera</span>
                              Action asked: <span className="font-semibold text-[#1a201c]">{challenge.text}</span>
                            </figcaption>
                          ) : (
                            <figcaption className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#9a5b00]">
                              <Icon d={ICONS.alert} className="h-3.5 w-3.5" />
                              Not a live capture (submitted before live selfies were required)
                            </figcaption>
                          );
                        })()
                      ) : null}
                    </figure>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  {/* Details + checklist */}
                  <div className="space-y-4">
                    <section className={`${cardClass} p-4`}>
                      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">Submitted details</h3>
                      {/* Two columns where the card is wide (tablet); one column in the half-width desktop layout. */}
                      <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
                        {[
                          { label: "Legal name", value: row.legal_name },
                          { label: row.id_type || "ID number", value: row.id_number, mono: true, copy: true },
                          { label: "Email", value: row.email, copy: true },
                          { label: "Phone", value: row.phone },
                          { label: "Address", value: row.address, wide: true },
                          { label: "User ID", value: row.user_id, mono: true, copy: true, wide: true },
                          { label: "Submitted", value: formatDateTime(row.submitted_at) },
                        ].map((item) => (
                          <div key={item.label} className={`min-w-0 ${item.wide ? "sm:col-span-2 lg:col-span-1" : ""}`}>
                            <dt className="text-[11.5px] text-[#8a928c]">{item.label}</dt>
                            <dd className="mt-0.5 flex min-w-0 items-center gap-1.5">
                              <span className={`min-w-0 break-words text-[13.5px] font-semibold text-[#1a201c] ${item.mono ? "font-mono text-[13px]" : ""}`}>{item.value || "—"}</span>
                              {item.copy && item.value ? <CopyButton value={item.value} label={`Copy ${item.label}`} /> : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <section className={`${cardClass} p-4`}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">Reviewer checklist</h3>
                        <span className="text-[12px] font-semibold tabular-nums text-[#616a64]">
                          {checks.filter((c) => reviewChecksFor(row).includes(c)).length}/{reviewChecksFor(row).length}
                        </span>
                      </div>
                      <ul className="mt-2.5 space-y-1.5">
                        {reviewChecksFor(row).map((item) => {
                          const done = checks.includes(item);
                          return (
                            <li key={item}>
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={done}
                                onClick={() => onToggleCheck(item)}
                                className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[13px] transition hover:bg-[#f7f8f6] ${done ? "text-[#1a201c]" : "text-[#4b544e]"}`}
                              >
                                <span className={`grid size-5 shrink-0 place-items-center rounded-[6px] border transition ${done ? "border-[#2e7d4f] bg-[#2e7d4f] text-[#fff]" : "border-[#c9cec8] bg-[#fff] text-transparent"}`}>
                                  <Icon d={ICONS.check} className="h-3.5 w-3.5" />
                                </span>
                                {item}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-[11.5px] text-[#8a928c]">Guidance only. It isn&apos;t saved and doesn&apos;t block a decision.</p>
                    </section>
                  </div>

                  {/* Note, rejection reason, history */}
                  <div className="space-y-4">
                    <section className={`${cardClass} p-4`}>
                      <label htmlFor="kyc-review-note" className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">
                        Internal note
                      </label>
                      <textarea
                        id="kyc-review-note"
                        rows={2}
                        maxLength={2000}
                        value={note}
                        onChange={(e) => onNote(e.target.value)}
                        placeholder="Optional. Saved with the decision."
                        className={`${fieldClass} mt-2 resize-y py-2`}
                      />
                      <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">If rejecting, tell them why</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {REJECT_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => onReason(reason === preset ? "" : preset)}
                            className={`rounded-[999px] px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${
                              reason === preset ? "bg-[#1f2b24] text-[#fff] ring-[#1f2b24]" : "bg-[#fff] text-[#4b544e] ring-[#d9ddd8] hover:bg-[#f7f8f6]"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={reason}
                        onChange={(e) => onReason(e.target.value)}
                        placeholder="Reason emailed to the worker (optional)"
                        className={`${fieldClass} mt-2 resize-y py-2`}
                      />
                    </section>

                    <section className={`${cardClass} p-4`}>
                      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">History</h3>
                      <div className="mt-3">
                        <Timeline events={row.events ?? []} compact />
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>

            {/* Pinned decision bar */}
            <div className="border-t border-[#e3e5e1] bg-[#fff]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="hidden text-[12px] text-[#7a827c] sm:block">
                  The worker is emailed either way. <span className="hidden xl:inline">Press J / K to move between requests.</span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={working || status === "rejected"}
                    className={`${btnBase} h-11 border border-[#f1d1cc] bg-[#fff] px-4 text-[#b42318] hover:bg-[#fdf0ef] disabled:opacity-40 sm:h-10`}
                  >
                    {busy === "rejected" ? <Spinner className="border-[#b42318]/30 border-t-[#b42318]" /> : <Icon d={ICONS.x} />}
                    {status === "rejected" ? "Rejected" : "Reject & notify"}
                  </button>
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={working || status === "approved"}
                    className={`${btnBase} h-11 bg-[#1f2b24] px-5 text-[#fff] hover:bg-[#2b3a31] disabled:opacity-40 sm:h-10`}
                  >
                    {busy === "approved" ? <Spinner /> : <Icon d={ICONS.check} />}
                    {status === "approved" ? "Approved" : "Approve & notify"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
