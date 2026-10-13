"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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
  SectionLabel,
  SelectAllCheckbox,
  Spinner,
  StatusChip,
  btnDanger,
  btnGhost,
  btnIcon,
  btnPrimary,
  bulkBtn,
  cardClass,
  fieldClass,
  formatDateTime,
  formatRelative,
  runPool,
  toneDot,
  toneFor,
} from "./adminUi";

export type Assignment = {
  id: string;
  gigId: string;
  workerId: string;
  assignedEmail: string;
  assignedEmails?: string[];
  status: string;
  submittedAt?: string;
  decidedAt?: string;
};

type AssignmentActionResult = {
  fundsReleased?: boolean;
  payoutBatchId?: string;
  payoutStatus?: string;
  earningsReleaseStatus?: string;
};

type CredentialSubmission = {
  id: string;
  handle: string;
  email: string;
  password: string;
  phone?: string;
};

type Props = {
  assignments: Assignment[];
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  gigTitle: (gigId: string) => string | undefined;
  lastRefreshAt: string | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

const FILTERS = ["Submitted", "Assigned", "Pending", "Accepted", "Rejected", "All"] as const;

// Split view from 1024px; below that the detail opens as a full-screen sheet.
const DESKTOP_QUERY = "(min-width: 1024px)";
const subscribeDesktop = (callback: () => void) => {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
};
const readDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

/** Cached credentials belong to one submission: a (re)submission changes submittedAt and invalidates them. */
const submissionKey = (a: Pick<Assignment, "submittedAt">) => a.submittedAt ?? "unsubmitted";

const emailsOf = (a: Assignment) => (a.assignedEmails?.length ? a.assignedEmails : a.assignedEmail ? [a.assignedEmail] : []);

export default function CredentialSubmissionsPanel({ assignments, setAssignments, gigTitle, lastRefreshAt, refreshing, onRefresh }: Props) {
  const [filter, setFilter] = useState<string>("Submitted");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [credsCache, setCredsCache] = useState<Record<string, { key: string; rows: CredentialSubmission[] }>>({});
  const credsCacheRef = useRef(credsCache);
  useEffect(() => {
    credsCacheRef.current = credsCache;
  }, [credsCache]);
  const [loadingCredsId, setLoadingCredsId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [lastSeenSubmittedAt, setLastSeenSubmittedAt] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [releaseTargets, setReleaseTargets] = useState<Assignment[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState<BulkProgress>(null);
  const isDesktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const counts = useMemo(() => {
    const out: Record<string, number> = { All: assignments.length };
    assignments.forEach((a) => {
      out[a.status] = (out[a.status] ?? 0) + 1;
    });
    return out;
  }, [assignments]);

  // Fall back to "All" when the default Submitted queue is empty so the page never looks blank.
  const activeFilter = filter === "Submitted" && !counts.Submitted && assignments.length > 0 && !query ? "All" : filter;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments
      .filter((a) => activeFilter === "All" || a.status === activeFilter)
      .filter((a) =>
        !q ? true : [a.workerId, a.gigId, gigTitle(a.gigId), ...emailsOf(a)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      )
      .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());
  }, [assignments, activeFilter, query, gigTitle]);

  const selectedRef = useRef<string | null>(null);
  const assignmentsRef = useRef(assignments);
  useEffect(() => {
    selectedRef.current = selected?.id ?? null;
    assignmentsRef.current = assignments;
  }, [selected, assignments]);

  // Keep the detail pane in sync with polled data.
  const current = selected ? (assignments.find((a) => a.id === selected.id) ?? selected) : null;
  const selectedIndex = current ? filtered.findIndex((a) => a.id === current.id) : -1;
  const cachedCreds = current ? credsCache[current.id] : undefined;
  const creds = current && cachedCreds && cachedCreds.key === submissionKey(current) ? cachedCreds.rows : undefined;

  const fetchCreds = useCallback(
    async (assignment: Pick<Assignment, "id" | "submittedAt">, { force = false, quiet = false }: { force?: boolean; quiet?: boolean } = {}) => {
      const assignmentId = assignment.id;
      const key = submissionKey(assignment);
      const cached = credsCacheRef.current[assignmentId];
      if (!force && cached && cached.key === key) return cached.rows;
      if (!quiet) setLoadingCredsId(assignmentId);
      try {
        const res = await fetch(`/api/gig-credentials?assignmentId=${encodeURIComponent(assignmentId)}`);
        const data = res.ok ? await res.json() : [];
        const safe = Array.isArray(data) ? (data as CredentialSubmission[]) : [];
        setCredsCache((prev) => ({ ...prev, [assignmentId]: { key, rows: safe } }));
        return safe;
      } catch {
        if (!cached) setCredsCache((prev) => ({ ...prev, [assignmentId]: { key, rows: [] } }));
        return cached?.rows ?? [];
      } finally {
        if (!quiet) setLoadingCredsId((prev) => (prev === assignmentId ? null : prev));
      }
    },
    [],
  );

  // Live: a (re)submission changes the open row's submittedAt, so its accounts reload by themselves.
  const currentId = current?.id;
  const currentKey = current ? submissionKey(current) : null;
  useEffect(() => {
    if (!currentId || currentKey === null) return;
    const cached = credsCacheRef.current[currentId];
    if (cached && cached.key !== currentKey) void fetchCreds({ id: currentId, submittedAt: currentKey === "unsubmitted" ? undefined : currentKey }, { quiet: true });
  }, [currentId, currentKey, fetchCreds]);

  // Live: credential rows changed somewhere (admin live channel). Reload the open submission now; refetch the rest
  // when they're next opened.
  useEffect(() => {
    const onLive = (event: Event) => {
      const kinds = (event as CustomEvent<string[] | null>).detail;
      if (kinds && !kinds.includes("gig_account_credentials") && !kinds.includes("gig_assignments")) return;
      const openId = selectedRef.current;
      setCredsCache((prev) => {
        const next: typeof prev = {};
        for (const [id, entry] of Object.entries(prev)) if (id === openId) next[id] = entry;
        return next;
      });
      if (openId) {
        const row = assignmentsRef.current.find((a) => a.id === openId);
        void fetchCreds({ id: openId, submittedAt: row?.submittedAt }, { force: true, quiet: true });
      }
    };
    window.addEventListener("admin-live", onLive);
    return () => window.removeEventListener("admin-live", onLive);
  }, [fetchCreds]);

  const open = useCallback(
    async (assignment: Assignment, scroll = false) => {
      setSelected(assignment);
      setRevealed({});
      setCopiedAll(false);
      // Queue taps on phones/tablets open the full-screen review sheet.
      if (scroll && !isDesktop) setSheetOpen(true);
      await fetchCreds(assignment);
    },
    [fetchCreds, isDesktop],
  );

  const openAdjacent = useCallback(
    async (dir: -1 | 1) => {
      if (selectedIndex < 0) return;
      const next = filtered[selectedIndex + dir];
      if (next) await open(next);
    },
    [filtered, open, selectedIndex],
  );

  /** PATCHes one assignment with an optimistic update; rolls back on failure. Never touches UI feedback. */
  const patchAssignment = useCallback(
    async (assignment: Assignment, status: string, options?: { releaseFundsNow?: boolean }) => {
      const decidedAt = new Date().toISOString();
      setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, status, decidedAt } : a)));
      try {
        const res = await fetch("/api/gig-assignments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: assignment.id, updates: { status, decidedAt, releaseFundsNow: !!options?.releaseFundsNow } }),
        });
        const payload = (await res.json().catch(() => null)) as (AssignmentActionResult & { status?: string; decidedAt?: string; error?: string }) | null;
        if (!res.ok) throw new Error(payload?.error || "Unable to update submission.");
        const next = { ...assignment, status: payload?.status ?? status, decidedAt: payload?.decidedAt ?? decidedAt };
        setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? next : a)));
        setSelected((prev) => (prev?.id === assignment.id ? next : prev));
        return { ok: true as const, payload };
      } catch (err: unknown) {
        setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? assignment : a)));
        setSelected((prev) => (prev?.id === assignment.id ? assignment : prev));
        return { ok: false as const, error: err instanceof Error ? err.message : null };
      }
    },
    [setAssignments],
  );

  const updateAssignment = useCallback(
    async (assignment: Assignment, status: string, options?: { releaseFundsNow?: boolean }) => {
      setActionId(assignment.id);
      setNotice(null);
      const result = await patchAssignment(assignment, status, options);
      setActionId((prev) => (prev === assignment.id ? null : prev));
      if (result.ok) {
        setNotice({
          tone: "success",
          text:
            status === "Accepted" && options?.releaseFundsNow
              ? result.payload?.fundsReleased
                ? "Submission approved and the gig amount was credited to the worker's approved earnings wallet."
                : "Submission approved. Wallet credit is being prepared."
              : status === "Accepted"
                ? "Submission approved. Earnings are ready for wallet credit."
                : status === "Pending"
                  ? "Submission kept in managed review."
                  : "Submission returned for correction.",
        });
      } else {
        setNotice({
          tone: "danger",
          text:
            result.error ||
            (status === "Accepted" && options?.releaseFundsNow
              ? "Approval saved failed or payout release is blocked. Check the worker payout method."
              : "Unable to update the submission right now."),
        });
      }
    },
    [patchAssignment],
  );

  const BULK_LABEL: Record<string, string> = { Accepted: "Approving", Rejected: "Rejecting", Pending: "Moving to pending" };

  const bulkUpdate = async (targets: Assignment[], status: string, options?: { releaseFundsNow?: boolean }) => {
    setReleaseTargets(null);
    setNotice(null);
    if (!targets.length) return;
    setBulk({ label: `${options?.releaseFundsNow ? "Approving & releasing funds" : BULK_LABEL[status] ?? "Updating"}…`, done: 0, total: targets.length });
    const results = await runPool(targets, 3, (a) => patchAssignment(a, status, options), (done) => setBulk((prev) => (prev ? { ...prev, done } : prev)));
    const failed = targets.filter((_, i) => !results[i].ok);
    const ok = targets.length - failed.length;
    const released = results.filter((r) => r.ok && r.payload?.fundsReleased).length;
    const verb = status === "Accepted" ? "approved" : status === "Rejected" ? "returned for correction" : "kept pending";
    setNotice(
      failed.length
        ? {
            tone: "danger",
            text: `${ok} ${verb}, ${failed.length} failed (${failed.map((a) => a.workerId).join(", ")}). Failed items are still selected so you can retry.`,
          }
        : {
            tone: "success",
            text: `${ok} submission${ok === 1 ? "" : "s"} ${verb}.${options?.releaseFundsNow ? ` Funds credited for ${released}${released < ok ? `; ${ok - released} still preparing` : ""}.` : ""}`,
          },
    );
    setChecked(new Set(failed.map((a) => a.id)));
    setBulk(null);
  };

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Auto-open the newest submission while watching the Submitted queue.
  useEffect(() => {
    if (filter !== "Submitted") return;
    const newest = assignments
      .filter((a) => a.status === "Submitted" && a.submittedAt)
      .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime())[0];
    if (!newest?.submittedAt) return;
    if (!lastSeenSubmittedAt || new Date(newest.submittedAt).getTime() > new Date(lastSeenSubmittedAt).getTime()) {
      // Announce arrivals after the first load (not the backlog that was already there).
      if (lastSeenSubmittedAt) {
        const title = gigTitle(newest.gigId);
        setNotice({ tone: "success", text: `New submission from ${newest.workerId}${title ? ` for ${title}` : ""}. Opened for review.` });
      }
      setLastSeenSubmittedAt(newest.submittedAt);
      if (!selected || selected.id !== newest.id) void open(newest);
    }
  }, [assignments, filter, lastSeenSubmittedAt, open, selected, gigTitle]);

  // Keyboard review: j/k navigate, a/r/p decide.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current || releaseTargets || actionId || bulk) return;
      const map: Record<string, () => void> = {
        j: () => void openAdjacent(1),
        k: () => void openAdjacent(-1),
        a: () => void updateAssignment(current, "Accepted"),
        r: () => void updateAssignment(current, "Rejected"),
        p: () => void updateAssignment(current, "Pending"),
        x: () => toggleChecked(current.id),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionId, bulk, releaseTargets, current, openAdjacent, updateAssignment]);

  const busy = (!!current && actionId === current.id) || !!bulk;
  const checkedRows = filtered.filter((a) => checked.has(a.id));
  const allChecked = filtered.length > 0 && checkedRows.length === filtered.length;
  const allRevealed = !!creds?.length && creds.every((c) => revealed[c.id]);

  // Cross-check submitted credentials against the emails this worker was assigned (case-insensitive).
  const credCheck = useMemo(() => {
    if (!current || !creds) return null;
    const norm = (v: string) => String(v ?? "").trim().toLowerCase();
    const assigned = emailsOf(current).map(norm);
    const submitted = creds.map((c) => norm(c.email));
    const seen = new Map<string, number>();
    submitted.forEach((e) => seen.set(e, (seen.get(e) ?? 0) + 1));
    return {
      hasAssigned: assigned.length > 0,
      assignedSubmitted: new Set(assigned.filter((e) => submitted.includes(e))),
      credOk: (email: string) => assigned.includes(norm(email)),
      unassigned: creds.filter((c) => assigned.length > 0 && !assigned.includes(norm(c.email))).length,
      missing: assigned.filter((e) => !submitted.includes(e)).length,
      duplicates: [...seen.values()].filter((n) => n > 1).length,
      total: creds.length,
      assignedCount: assigned.length,
    };
  }, [current, creds]);

  const copyAllCreds = async () => {
    if (!creds?.length) return;
    const text = creds.map((c) => [c.handle, c.email, c.password, c.phone].filter(Boolean).join(" | ")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure origin / permissions); individual copy buttons still work.
    }
  };

  const sheetVisible = !isDesktop && sheetOpen && !!current;
  useEffect(() => {
    if (!sheetVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !releaseTargets) setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetVisible, releaseTargets]);

  const renderDetail = (inSheet: boolean) =>
    !current ? null : (
            <article className={inSheet ? cardClass : `${cardClass} overflow-hidden lg:sticky lg:top-[140px]`}>
              <header className="flex flex-wrap items-start gap-3 border-b border-[#eef0ec] px-4 py-4 sm:px-5">
                <Avatar name={current.workerId} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[16px] font-semibold text-[#1a201c]">{current.workerId}</h2>
                    <StatusChip status={current.status} />
                  </div>
                  <div className="truncate text-[12.5px] text-[#616a64]">{gigTitle(current.gigId) ?? `Gig ${current.gigId}`}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[#8a928c]">
                    {current.submittedAt && <span title={formatDateTime(current.submittedAt)}>Submitted {formatRelative(current.submittedAt)}</span>}
                    {current.decidedAt && <span title={formatDateTime(current.decidedAt)}>Reviewed {formatRelative(current.decidedAt)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {selectedIndex >= 0 && (
                    <span className="mr-1 text-[12px] tabular-nums text-[#7a827c]">
                      {selectedIndex + 1} / {filtered.length}
                    </span>
                  )}
                  <button type="button" className={`${btnIcon} border border-[#e3e5e1]`} onClick={() => void openAdjacent(-1)} disabled={selectedIndex <= 0} aria-label="Previous (K)" title="Previous (K)">
                    <Icon d={ICONS.chevronLeft} />
                  </button>
                  <button
                    type="button"
                    className={`${btnIcon} border border-[#e3e5e1]`}
                    onClick={() => void openAdjacent(1)}
                    disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1}
                    aria-label="Next (J)"
                    title="Next (J)"
                  >
                    <Icon d={ICONS.chevronRight} />
                  </button>
                </div>
              </header>

              <div className="space-y-5 p-4 sm:p-5">
                {/* Assigned emails */}
                <div>
                  <SectionLabel>Assigned emails</SectionLabel>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {emailsOf(current).length === 0 ? (
                      <span className="text-[12.5px] text-[#a3aaa5]">None assigned</span>
                    ) : (
                      emailsOf(current).map((email) => {
                        const submitted = credCheck?.assignedSubmitted.has(email.trim().toLowerCase());
                        return (
                        <span
                          key={email}
                          title={credCheck ? (submitted ? "Credentials submitted" : "No credentials for this email yet") : undefined}
                          className={`inline-flex max-w-full items-center gap-1 rounded-[8px] border py-0.5 pl-2 pr-0.5 text-[12.5px] ${
                            !credCheck ? "border-[#e3e5e1] bg-[#fafbf9] text-[#1a201c]" : submitted ? "border-[#c9e3d2] bg-[#f3faf5] text-[#1a201c]" : "border-dashed border-[#e7c9a0] bg-[#fffaf2] text-[#7a5410]"
                          }`}
                        >
                          <Icon d={credCheck && submitted ? ICONS.check : ICONS.mail} className={`h-3.5 w-3.5 shrink-0 ${credCheck && submitted ? "text-[#2e7d4f]" : "text-[#8a928c]"}`} />
                          <span className="truncate">{email}</span>
                          <CopyButton value={email} label="" />
                        </span>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Credentials */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    <SectionLabel>Submitted credentials {creds ? `· ${creds.length}` : ""}</SectionLabel>
                    {!!creds?.length && (
                      <span className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                      <button type="button" onClick={() => void copyAllCreds()} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2b5d4a] hover:underline">
                        <Icon d={copiedAll ? ICONS.check : ICONS.copy} className="h-3.5 w-3.5" />
                        {copiedAll ? "Copied" : "Copy all"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevealed(allRevealed ? {} : Object.fromEntries(creds.map((c) => [c.id, true])))}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2b5d4a] hover:underline"
                      >
                        <Icon d={allRevealed ? ICONS.eyeOff : ICONS.eye} className="h-3.5 w-3.5" />
                        {allRevealed ? "Hide passwords" : "Reveal all"}
                      </button>
                      </span>
                    )}
                  </div>

                  {/* Automatic cross-check: assigned emails vs submitted credentials */}
                  {credCheck && credCheck.total > 0 && credCheck.hasAssigned ? (
                    credCheck.missing || credCheck.unassigned || credCheck.duplicates ? (
                      <div role="status" className="mt-2 flex items-start gap-2 rounded-[12px] border border-[#f0dcb8] bg-[#fffaf2] px-3 py-2.5 text-[12.5px] text-[#7a5410]">
                        <Icon d={ICONS.alert} className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="font-semibold">Check before approving:</span>{" "}
                          {[
                            credCheck.missing ? `${credCheck.missing} assigned email${credCheck.missing === 1 ? " has" : "s have"} no credentials` : "",
                            credCheck.unassigned ? (credCheck.unassigned === 1 ? "1 credential uses an email that wasn't assigned" : `${credCheck.unassigned} credentials use emails that weren't assigned`) : "",
                            credCheck.duplicates ? `${credCheck.duplicates} email${credCheck.duplicates === 1 ? " is" : "s are"} submitted more than once` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    ) : (
                      <div role="status" className="mt-2 flex items-center gap-2 rounded-[12px] border border-[#c9e3d2] bg-[#f3faf5] px-3 py-2.5 text-[12.5px] font-semibold text-[#1f5131]">
                        <Icon d={ICONS.check} className="h-4 w-4 shrink-0" />
                        All {credCheck.total} credentials match the {credCheck.assignedCount} assigned email{credCheck.assignedCount === 1 ? "" : "s"}.
                      </div>
                    )
                  ) : null}

                  {loadingCredsId === current.id && !creds ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {[0, 1].map((i) => (
                        <div key={i} className="h-[120px] animate-pulse rounded-[12px] bg-[#f3f4f1]" />
                      ))}
                    </div>
                  ) : !creds?.length ? (
                    <div className="mt-2 rounded-[12px] border border-dashed border-[#d9ddd8] px-4 py-6 text-center text-[12.5px] text-[#7a827c]">
                      No credentials submitted yet.
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                      {creds.map((cred) => {
                        const show = !!revealed[cred.id];
                        return (
                          <div
                            key={cred.id}
                            className={`rounded-[12px] border bg-[#fafbf9] p-3 ${credCheck?.hasAssigned && !credCheck.credOk(cred.email) ? "border-[#f0dcb8]" : "border-[#e3e5e1]"}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">{cred.handle || "Untitled account"}</span>
                                {credCheck?.hasAssigned ? (
                                  credCheck.credOk(cred.email) ? (
                                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[999px] bg-[#ebf5ee] px-1.5 text-[10.5px] font-semibold leading-[18px] text-[#226b40]" title="Email matches an assigned email">
                                      <Icon d={ICONS.check} className="h-3 w-3" />
                                      Assigned
                                    </span>
                                  ) : (
                                    <span className="shrink-0 rounded-[999px] bg-[#fff2df] px-1.5 text-[10.5px] font-semibold leading-[18px] text-[#9a5b00]" title="This email wasn't assigned to the worker">
                                      Not assigned
                                    </span>
                                  )
                                ) : null}
                              </span>
                              {cred.handle && <CopyButton value={cred.handle} label="" />}
                            </div>
                            <dl className="mt-2 space-y-1.5 text-[12.5px]">
                              <CredRow label="Email" value={cred.email} />
                              <div className="flex items-center gap-2">
                                <dt className="w-[62px] shrink-0 text-[#8a928c]">Password</dt>
                                <dd className="flex min-w-0 flex-1 items-center gap-1">
                                  <code className="truncate font-mono text-[12.5px] text-[#1a201c]">{show ? cred.password : "••••••••••"}</code>
                                  <button
                                    type="button"
                                    onClick={() => setRevealed((prev) => ({ ...prev, [cred.id]: !prev[cred.id] }))}
                                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#616a64] hover:bg-[#ebeeea]"
                                    aria-label={show ? "Hide password" : "Show password"}
                                  >
                                    <Icon d={show ? ICONS.eyeOff : ICONS.eye} className="h-3.5 w-3.5" />
                                  </button>
                                  <CopyButton value={cred.password} label="" />
                                </dd>
                              </div>
                              {cred.phone && <CredRow label="Phone" value={cred.phone} />}
                            </dl>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Decision bar */}
              <footer
                className={`border-t border-[#eef0ec] bg-[#fafbf9] px-4 py-3.5 sm:px-5 ${
                  inSheet ? "sticky bottom-0 z-10 rounded-b-[16px] bg-[#fafbf9]/95 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur" : ""
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <button type="button" className={btnDanger} disabled={busy} onClick={() => void updateAssignment(current, "Rejected")}>
                      <Icon d={ICONS.x} />
                      Reject
                    </button>
                    <button type="button" className={btnGhost} disabled={busy} onClick={() => void updateAssignment(current, "Pending")}>
                      <Icon d={ICONS.pause} />
                      Keep pending
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
                    <button type="button" className={btnGhost} disabled={busy} onClick={() => void updateAssignment(current, "Accepted")}>
                      {busy ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.check} />}
                      Approve only
                    </button>
                    <button type="button" className={btnPrimary} disabled={busy} onClick={() => setReleaseTargets([current])}>
                      <Icon d={ICONS.wallet} />
                      Approve &amp; pay
                    </button>
                  </div>
                </div>
                <p className="mt-2.5 hidden text-[11.5px] text-[#8a928c] lg:block">
                  Shortcuts: <Kbd>J</Kbd>/<Kbd>K</Kbd> next/prev · <Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>P</Kbd> pending · <Kbd>X</Kbd> select
                </p>
              </footer>
            </article>
    );

  return (
    <section className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Credential submissions</h1>
          <p className="mt-0.5 text-[13px] text-[#616a64]">Verify submitted account credentials, then approve and release earnings.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden text-[12px] text-[#7a827c] sm:inline" aria-live="polite">
            {refreshing ? "Refreshing…" : lastRefreshAt ? `Refreshed ${formatRelative(lastRefreshAt)} · auto-sync on` : null}
          </span>
          <button type="button" className={btnGhost} onClick={() => void onRefresh()} disabled={refreshing}>
            <Icon d={ICONS.refresh} className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className={`${cardClass} px-2 py-2`}>
        <div className="dashboard-chip-scroller flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter by status">
          {FILTERS.map((status) => {
            const active = activeFilter === status;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFilter(status);
                  setChecked(new Set());
                }}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold transition ${
                  active ? "bg-[#1f2b24] text-[#fff]" : "text-[#4b544e] hover:bg-[#f1f3f0]"
                }`}
              >
                {status !== "All" && <span className={`h-1.5 w-1.5 rounded-full ${toneDot(toneFor(status))}`} />}
                {status}
                <span className={`rounded-[999px] px-1.5 text-[11px] leading-[18px] tabular-nums ${active ? "bg-[#fff]/20" : "bg-[#eef0ed]"}`}>
                  {counts[status] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {notice && (
        <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Queue */}
        <div className={`${cardClass} min-w-0 p-3`}>
          <div className="flex items-center gap-2.5 px-2 pb-2.5">
            {filtered.length > 0 && (
              <SelectAllCheckbox
                checked={allChecked}
                indeterminate={checkedRows.length > 0}
                onChange={() => setChecked(allChecked ? new Set() : new Set(filtered.map((a) => a.id)))}
                label="Select all submissions"
              />
            )}
            <h2 className="text-[14px] font-semibold text-[#1a201c]">
              Queue <span className="font-normal text-[#7a827c]">· {checkedRows.length ? `${checkedRows.length} of ${filtered.length} selected` : filtered.length}</span>
            </h2>
          </div>
          <label className="relative block px-1 pb-3">
            <span className="sr-only">Search submissions</span>
            <span className="pointer-events-none absolute left-3.5 top-[18px] -translate-y-1/2 text-[#8a928c]">
              <Icon d={ICONS.search} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search worker, gig or email"
              className={`${fieldClass} h-9 pl-9`}
            />
          </label>

          {filtered.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <div className="text-[13.5px] font-semibold text-[#1a201c]">{query ? "No matches" : `No ${activeFilter === "All" ? "" : activeFilter.toLowerCase() + " "}submissions`}</div>
              <p className="mt-1 text-[12.5px] text-[#7a827c]">{query ? "Try another worker ID, gig or email." : "New submissions appear here automatically."}</p>
            </div>
          ) : (
            <ul className="space-y-1.5 lg:max-h-[68vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
              {filtered.map((a) => {
                const active = current?.id === a.id;
                const isNew = !!a.submittedAt && !!lastRefreshAt && new Date(a.submittedAt).getTime() > new Date(lastRefreshAt).getTime();
                const emails = emailsOf(a);
                return (
                  <li
                    key={a.id}
                    className={`flex items-start gap-2.5 rounded-[12px] border pl-3 transition ${
                      active
                        ? "border-[#1f2b24] bg-[#f7f8f6] shadow-[inset_3px_0_0_#1f2b24]"
                        : checked.has(a.id)
                          ? "border-[#c9e3d2] bg-[#f5faf6]"
                          : "border-transparent hover:border-[#e3e5e1] hover:bg-[#fafbf9]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(a.id)}
                      onChange={() => toggleChecked(a.id)}
                      aria-label={`Select ${a.workerId}`}
                      className="mt-[18px] h-4 w-4 shrink-0 cursor-pointer rounded"
                    />
                    <button
                      type="button"
                      onClick={() => void open(a, true)}
                      aria-current={active ? "true" : undefined}
                      className="min-w-0 flex-1 py-2.5 pr-3 text-left"
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar name={a.workerId} className="mt-0.5 size-8 text-[11.5px]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">{a.workerId}</span>
                            {isNew && <span className="rounded-[999px] bg-[#2e7d4f] px-1.5 text-[10.5px] font-bold uppercase leading-[16px] text-[#fff]">New</span>}
                          </div>
                          <div className="truncate text-[12.5px] text-[#616a64]">{gigTitle(a.gigId) ?? a.gigId}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <StatusChip status={a.status} />
                            <span className="text-[11.5px] text-[#8a928c]">
                              {emails.length} email{emails.length === 1 ? "" : "s"}
                              {a.submittedAt ? ` · ${formatRelative(a.submittedAt)}` : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div id="credential-detail" className="hidden min-w-0 lg:block">
          {!isDesktop ? null : !current ? (
            <EmptyState icon={ICONS.lock} title="No submission selected" body="Pick a submission from the queue to inspect credentials and decide." />
          ) : (
            renderDetail(false)
          )}
        </div>
      </div>

      {sheetVisible
        ? createPortal(
            <div role="dialog" aria-modal="true" aria-label="Submission details" className="ops-dashboard-skin fixed inset-0 z-[55] flex flex-col bg-[#f6f7f5] text-slate-900 lg:hidden">
              <div className="flex items-center justify-between gap-2 border-b border-[#e3e5e1] bg-[#fff]/95 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur sm:px-5">
                <button type="button" onClick={() => setSheetOpen(false)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13.5px] font-semibold text-[#1a201c] hover:bg-[#f1f3f0]">
                  <Icon d={ICONS.chevronLeft} />
                  Queue
                </button>
                <span className="text-[12px] text-[#7a827c]">{filtered.length} in this queue</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 sm:px-5 sm:pt-5">{renderDetail(true)}</div>
            </div>,
            document.body,
          )
        : null}

      <BulkBar count={checkedRows.length} total={filtered.length} onSelectAll={() => setChecked(new Set(filtered.map((a) => a.id)))} onClear={() => setChecked(new Set())} progress={bulk}>
        <button type="button" className={bulkBtn.danger} disabled={!!bulk || !!actionId} onClick={() => void bulkUpdate(checkedRows, "Rejected")}>
          <Icon d={ICONS.x} />
          Reject
        </button>
        <button type="button" className={bulkBtn.ghost} disabled={!!bulk || !!actionId} onClick={() => void bulkUpdate(checkedRows, "Pending")}>
          <Icon d={ICONS.pause} />
          <span className="truncate">Pending</span>
        </button>
        <button type="button" className={bulkBtn.ghost} disabled={!!bulk || !!actionId} onClick={() => void bulkUpdate(checkedRows, "Accepted")}>
          <Icon d={ICONS.check} />
          Approve
        </button>
        <button type="button" className={bulkBtn.primary} disabled={!!bulk || !!actionId} onClick={() => setReleaseTargets(checkedRows)}>
          <Icon d={ICONS.wallet} />
          <span className="truncate">
            <span className="sm:hidden">Pay</span>
            <span className="hidden sm:inline">Approve &amp; pay</span>
          </span>
        </button>
      </BulkBar>

      {releaseTargets && (
        <ConfirmDialog
          icon={ICONS.wallet}
          title={releaseTargets.length === 1 ? "Approve and release funds?" : `Approve and release funds for ${releaseTargets.length} submissions?`}
          body={
            releaseTargets.length === 1 ? (
              <>
                The gig amount will be credited to <span className="font-semibold text-[#1a201c]">{releaseTargets[0].workerId}</span>&apos;s approved earnings wallet. This
                can&apos;t be undone from here.
              </>
            ) : (
              <>Each worker&apos;s gig amount will be credited to their approved earnings wallet. This can&apos;t be undone from here.</>
            )
          }
          confirmLabel={releaseTargets.length === 1 ? "Approve & release" : `Release ${releaseTargets.length} payouts`}
          busy={!!actionId || !!bulk}
          onCancel={() => setReleaseTargets(null)}
          onConfirm={async () => {
            if (releaseTargets.length === 1) {
              await updateAssignment(releaseTargets[0], "Accepted", { releaseFundsNow: true });
              setReleaseTargets(null);
            } else {
              await bulkUpdate(releaseTargets, "Accepted", { releaseFundsNow: true });
            }
          }}
        >
          {releaseTargets.length > 1 && (
            <div className="mt-3 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {releaseTargets.map((a) => (
                <span key={a.id} className="rounded-[999px] bg-[#f1f3f0] px-2 py-0.5 text-[12px] text-[#1a201c]">
                  {a.workerId}
                </span>
              ))}
            </div>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}

function CredRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-[62px] shrink-0 text-[#8a928c]">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-[#1a201c]">{value || "—"}</span>
        {value && <CopyButton value={value} label="" />}
      </dd>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[18px] items-center justify-center rounded-[4px] border border-[#d9ddd8] bg-[#fff] px-1 font-mono text-[10.5px] text-[#4b544e]">
      {children}
    </kbd>
  );
}
