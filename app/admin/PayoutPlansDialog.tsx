"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api/client";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import type { WorkerDirectoryRecord } from "@/lib/adminWorkerDirectory";
import {
  PLAN_LIMITS, PLAN_MODE_LABELS, breakEvenViews, compactViews, comparisonPoints, describePlan, formatINR, planDraftFrom,
  reelPayoutINR, shortPlan, validatePlanDraft, type PayoutPlan, type PayoutPlanMode, type PayoutPlansSnapshot, type PlanDraft,
} from "@/lib/payoutPlans";

// Custom payout plans for selected creators: define the terms, compare them with plain per-1K pay, and assign them.
// The server applies plans only to reels that haven't started earning; money already credited is never rewritten.

const inputCls = "h-10 w-full min-w-0 rounded-xl border border-[#d9ddd8] bg-white px-3 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#9aa29c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 disabled:bg-[#f7f8f6] sm:text-[13.5px]";
const primaryBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1f2b24] px-4 text-[13.5px] font-semibold text-white transition hover:bg-[#2b3a31] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#d9ddd8] bg-white px-4 text-[13.5px] font-semibold text-[#1a201c] transition hover:bg-[#f7f8f6] disabled:opacity-50";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(typeof payload?.error === "string" ? payload.error : typeof payload?.error?.message === "string" ? payload.error.message : "Something went wrong. Please try again.");
  return payload;
}

/** Today's date in India, as yyyy-mm-dd for a date input. Reels are tracked by India day. */
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const shortDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "";

/** Load plans, their creators and view-based gigs. Shared by the directory chips and the dialog. */
export function usePayoutPlans() {
  const [snapshot, setSnapshot] = useState<PayoutPlansSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const payload = await readJson(await apiFetch("/api/admin/payout-plans"));
      setSnapshot({ plans: payload.plans ?? [], members: payload.members ?? [], gigs: payload.gigs ?? [] });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payout plans couldn't load.");
    }
  }, []);
  // Loads on mount and refreshes while the page is visible, so chips follow changes made by other admins.
  useVisibleRefresh(reload, 60_000);
  return { snapshot, error, reload };
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-[#3b443e]">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11.5px] font-medium text-[#b42318]">{error}</span> : hint ? <span className="mt-1 block text-[11.5px] leading-[1.1rem] text-[#7a827c]">{hint}</span> : null}
    </label>
  );
}

function Icon({ name, className = "h-4 w-4" }: { name: "plan" | "close" | "plus" | "back" | "users" | "check" | "trash" | "spark"; className?: string }) {
  const paths: Record<string, ReactNode> = {
    plan: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 15l3-3 3 2 4-5M7 8h4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="m14 6-6 6 6 6M8 12h12" />,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  };
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** Plan vs plain per-1K payout across views, with the threshold marked. */
function PayoutChart({ terms, plainRate }: { terms: { mode: PayoutPlanMode; rateINR: number; baseINR: number; thresholdViews: number }; plainRate: number }) {
  const max = Math.max(terms.thresholdViews * 3, 1000);
  const samples = Array.from({ length: 61 }, (_, index) => Math.round((max * index) / 60));
  // Include the points either side of the threshold so the switch shows as a step.
  const xs = [...new Set([...samples, terms.thresholdViews, terms.thresholdViews + 1])].sort((a, b) => a - b);
  const plan = xs.map(v => reelPayoutINR(v, terms));
  const plain = xs.map(v => reelPayoutINR(v, { mode: "cpm", rateINR: plainRate, baseINR: 0, thresholdViews: 0 }));
  const top = Math.max(...plan, ...plain, 1);
  const x = (v: number) => 4 + (v / max) * 92;
  const y = (amount: number) => 56 - (amount / top) * 50;
  const line = (values: number[]) => values.map((amount, index) => `${index ? "L" : "M"}${x(xs[index]).toFixed(2)},${y(amount).toFixed(2)}`).join(" ");
  return (
    <figure className="rounded-xl border border-[#e6ebe5] bg-[#fbfcfa] p-3">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="h-36 w-full sm:h-44" role="img" aria-label={`Payout per reel from 0 to ${compactViews(max)} views: plan compared with ${formatINR(plainRate)} per 1K`}>
        <line x1={x(terms.thresholdViews)} x2={x(terms.thresholdViews)} y1="4" y2="56" stroke="#c9d3cb" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
        <path d={line(plain)} fill="none" stroke="#9aa29c" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line(plan)} fill="none" stroke="#2e7d4f" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-[#616a64]">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-[#2e7d4f]" />This plan</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-0 w-4 border-t-2 border-dashed border-[#9aa29c]" />Standard {formatINR(plainRate)}/1K</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-3 w-0 border-l border-dashed border-[#9aa29c]" />{compactViews(terms.thresholdViews)} threshold</span>
        </span>
        <span className="tabular-nums">0 – {compactViews(max)} views</span>
      </figcaption>
    </figure>
  );
}

type Props = {
  selected: WorkerDirectoryRecord[];
  workers: WorkerDirectoryRecord[];
  snapshot: PayoutPlansSnapshot | null;
  loadError: string | null;
  onReload: () => Promise<void>;
  onClose: () => void;
};

export default function PayoutPlansDialog({ selected, workers, snapshot, loadError, onReload, onClose }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const plans = useMemo(() => snapshot?.plans ?? [], [snapshot]);
  const members = useMemo(() => snapshot?.members ?? [], [snapshot]);
  const gigs = useMemo(() => snapshot?.gigs ?? [], [snapshot]);
  const [activeId, setActiveId] = useState<string>("new");
  const [mobileView, setMobileView] = useState<"list" | "detail">(selected.length ? "detail" : "list");
  const [draft, setDraft] = useState<PlanDraft>(() => planDraftFrom());
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "assign" | "remove" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [appliesFrom, setAppliesFrom] = useState(todayIST);
  const [views, setViews] = useState(15_000);
  const [memberQuery, setMemberQuery] = useState("");
  const initialised = useRef(false);

  const activePlan = plans.find(plan => plan.id === activeId);
  // Open on the selection's current plan, else the newest active plan, else a new one.
  useEffect(() => {
    if (initialised.current || !snapshot) return;
    initialised.current = true;
    const selectedIds = new Set(selected.map(worker => worker.userId).filter(Boolean));
    const current = members.find(member => selectedIds.has(member.workerId))?.planId;
    const start = plans.find(plan => plan.id === current) ?? plans.find(plan => plan.active);
    if (start) { setActiveId(start.id); setDraft(planDraftFrom(start)); setViews(Math.round(Number(start.threshold_views) * 1.5)); }
  }, [snapshot, plans, members, selected]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose, busy]);

  const errors = validatePlanDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const dirty = !activePlan || JSON.stringify(planDraftFrom(activePlan)) !== JSON.stringify(draft);
  const scopedGig = gigs.find(gig => gig.id === draft.gigId);
  // Compare with the scoped gig's rate, else the most common view rate across gigs.
  const typicalRate = useMemo(() => {
    const counts = new Map<number, number>();
    for (const gig of gigs) counts.set(Number(gig.rateINR), (counts.get(Number(gig.rateINR)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 49;
  }, [gigs]);
  const plainRate = scopedGig ? Number(scopedGig.rateINR) : typicalRate;
  const terms = valid ? { mode: draft.mode, rateINR: draft.rateINR.trim() ? Number(draft.rateINR) : plainRate, baseINR: Number(draft.baseINR), thresholdViews: Number(draft.thresholdViews) } : null;
  const plain = (n: number) => reelPayoutINR(n, { mode: "cpm", rateINR: plainRate, baseINR: 0, thresholdViews: 0 });
  const breakEven = terms ? breakEvenViews(terms, plainRate) : null;

  const workerByUser = useMemo(() => new Map(workers.filter(worker => worker.userId).map(worker => [worker.userId!, worker])), [workers]);
  const planById = useMemo(() => new Map(plans.map(plan => [plan.id, plan])), [plans]);
  const memberByWorker = useMemo(() => new Map(members.map(member => [member.workerId, member])), [members]);
  const assignable = selected.filter(worker => worker.userId);
  const noAccount = selected.length - assignable.length;
  const moving = assignable.filter(worker => { const member = memberByWorker.get(worker.userId!); return member && member.planId !== activeId; });
  const alreadyHere = assignable.filter(worker => memberByWorker.get(worker.userId!)?.planId === activeId);
  const onAnyPlan = assignable.filter(worker => memberByWorker.has(worker.userId!));
  const planMembers = members.filter(member => member.planId === activeId).map(member => ({ member, worker: workerByUser.get(member.workerId) }))
    .filter(({ member, worker }) => {
      const query = memberQuery.trim().toLowerCase();
      return !query || [worker?.name, worker?.email, worker?.id, member.email, member.workerCode].some(value => String(value ?? "").toLowerCase().includes(query));
    });

  const choose = (plan?: PayoutPlan) => {
    setActiveId(plan?.id ?? "new");
    setDraft(planDraftFrom(plan));
    setTouched(false);
    setNotice(null);
    if (plan) setViews(Math.round(Number(plan.threshold_views) * 1.5));
    setMobileView("detail");
  };
  const patch = (change: Partial<PlanDraft>) => { setDraft(previous => ({ ...previous, ...change })); setNotice(null); };

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setBusy("save");
    setNotice(null);
    try {
      const payload = await readJson(await apiFetch("/api/admin/payout-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", plan: { ...draft, ...(activePlan ? { id: activePlan.id } : {}) } }) }));
      await onReload();
      if (payload.plan?.id) setActiveId(payload.plan.id);
      setNotice({ tone: "ok", text: activePlan ? "Plan updated. New terms apply to reels that haven't started earning." : "Plan created. Apply it to creators below." });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The plan couldn't be saved." });
    } finally { setBusy(null); }
  };

  const assign = async () => {
    if (!activePlan || !assignable.length) return;
    setBusy("assign");
    setNotice(null);
    try {
      const payload = await readJson(await apiFetch("/api/admin/payout-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign", planId: activePlan.id, workerIds: assignable.map(worker => worker.userId), appliesFrom: `${appliesFrom}T00:00:00+05:30` }) }));
      await onReload();
      const result = payload.result ?? {};
      setNotice({ tone: "ok", text: `${activePlan.name} applied to ${result.assigned ?? assignable.length} ${Number(result.assigned) === 1 ? "creator" : "creators"}${result.moved ? ` (${result.moved} moved from another plan)` : ""}. Reels posted from ${shortDate(`${appliesFrom}T00:00:00+05:30`)} use it.` });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The plan couldn't be applied." });
    } finally { setBusy(null); }
  };

  const remove = async (workerIds: string[], label: string) => {
    if (!workerIds.length) return;
    setBusy("remove");
    setNotice(null);
    try {
      await readJson(await apiFetch("/api/admin/payout-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", workerIds }) }));
      await onReload();
      setNotice({ tone: "ok", text: `${label} moved back to standard pay. Reels already earning keep their plan terms.` });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Couldn't remove the plan." });
    } finally { setBusy(null); }
  };

  const thresholdNumber = Number(draft.thresholdViews) || 10_000;
  const sliderMax = Math.max(thresholdNumber * 5, 1_000);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0f1a13]/45 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
        className="flex h-[100dvh] w-full max-w-[1180px] flex-col overflow-hidden bg-white shadow-[0_24px_60px_-20px_rgba(15,26,19,0.45)] outline-none sm:h-[min(880px,94vh)] sm:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-[#ebedea] px-4 pb-3 pt-4 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf5e6] text-[#2e7d4f]"><Icon name="plan" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.01em] text-[#1a201c]">Payout plans</h2>
            <p className="text-[12.5px] leading-5 text-[#616a64]">Pay chosen creators a fixed amount per reel, with the view rate only kicking in past a view threshold.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#616a64] transition hover:bg-[#f1f3f0] disabled:opacity-40"><Icon name="close" className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Plan list */}
          <aside className={`${mobileView === "detail" ? "hidden lg:flex" : "flex"} h-full min-h-0 flex-col border-[#ebedea] bg-[#fafbf9] lg:border-r`} aria-label="Payout plans">
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a827c]">{plans.length} {plans.length === 1 ? "plan" : "plans"}</p>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3 text-[12.5px] font-semibold text-white transition hover:bg-[#2b3a31]" onClick={() => choose()}><Icon name="plus" />New plan</button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4 sm:px-4">
              {!snapshot && !loadError ? <p role="status" className="px-1 py-6 text-center text-[12.5px] text-[#7a827c]">Loading plans…</p> : null}
              {loadError ? <p role="alert" className="rounded-xl bg-[#fdecea] px-3 py-2.5 text-[12.5px] text-[#8e1f1a]">{loadError}</p> : null}
              {snapshot && !plans.length ? (
                <div className="rounded-2xl border border-dashed border-[#d6dcd5] bg-white px-4 py-6 text-center">
                  <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#eaf5e6] text-[#2e7d4f]"><Icon name="spark" className="h-5 w-5" /></span>
                  <p className="mt-2 text-[13px] font-semibold text-[#1a201c]">No plans yet</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#7a827c]">Create one, for example ₹200 per reel up to 10K views, then the standard rate.</p>
                </div>
              ) : null}
              {activeId === "new" ? (
                <button type="button" aria-current="true" className="w-full rounded-2xl border border-[#1f2b24] bg-white p-3 text-left shadow-[0_1px_0_#1f2b2410]" onClick={() => setMobileView("detail")}>
                  <span className="text-[13px] font-semibold text-[#1a201c]">{draft.name.trim() || "New plan"}</span>
                  <span className="mt-0.5 block text-[11.5px] text-[#7a827c]">Draft · not saved</span>
                </button>
              ) : null}
              {plans.map(plan => {
                const current = plan.id === activeId;
                const terms = { mode: plan.mode, rateINR: Number(plan.rate_inr ?? (gigs.find(gig => gig.id === plan.gig_id)?.rateINR ?? typicalRate)), baseINR: Number(plan.base_inr), thresholdViews: Number(plan.threshold_views) };
                return (
                  <button key={plan.id} type="button" aria-current={current} onClick={() => choose(plan)}
                    className={`w-full rounded-2xl border bg-white p-3 text-left transition ${current ? "border-[#1f2b24] shadow-[0_1px_0_#1f2b2410]" : "border-[#e3e7e2] hover:border-[#c9d3cb]"}`}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-[#1a201c]">{plan.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${plan.active ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#f1f3f0] text-[#616a64]"}`}>{plan.active ? "Active" : "Paused"}</span>
                    </span>
                    <span className="mt-1 block text-[12px] font-medium tabular-nums text-[#2f4b3a]">{shortPlan(terms)}{plan.rate_inr == null ? <span className="font-normal text-[#7a827c]"> · gig rate</span> : null}</span>
                    <span className="mt-1 block truncate text-[11.5px] text-[#7a827c]">{plan.gigTitle ? `Only ${plan.gigTitle}` : "All view-based gigs"}</span>
                    <span className="mt-2 grid grid-cols-3 gap-1 border-t border-[#f0f2ef] pt-2 text-[11px] text-[#616a64]">
                      <span><b className="block text-[12.5px] tabular-nums text-[#1a201c]">{plan.memberCount}</b>creators</span>
                      <span><b className="block text-[12.5px] tabular-nums text-[#1a201c]">{plan.reels}</b>reels</span>
                      <span><b className="block truncate text-[12.5px] tabular-nums text-[#1a201c]">{formatINR(Number(plan.creditedINR))}</b>credited</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Plan detail */}
          <section className={`${mobileView === "list" ? "hidden lg:block" : "block"} h-full min-h-0 overflow-y-auto`} aria-label="Plan details">
            <div className="mx-auto max-w-[820px] space-y-5 px-4 py-4 sm:px-6 sm:py-5">
              <button type="button" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2b5d4a] lg:hidden" onClick={() => setMobileView("list")}><Icon name="back" />All plans</button>

              {selected.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#f3f7f1] px-3 py-2.5 text-[12.5px] text-[#2f4b3a]">
                  <Icon name="users" />
                  <span><b>{selected.length}</b> {selected.length === 1 ? "creator" : "creators"} selected{onAnyPlan.length ? ` · ${onAnyPlan.length} already on a plan` : ""}</span>
                </div>
              ) : null}

              {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2.5 text-[12.5px] leading-5 ${notice.tone === "error" ? "bg-[#fdecea] text-[#8e1f1a]" : "bg-[#e9f5ec] text-[#1f5131]"}`}>{notice.text}</p> : null}

              {/* Terms */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#1a201c]">{activePlan ? "Plan terms" : "Create a plan"}</h3>
                    <p className="text-[12px] text-[#7a827c]">{activePlan ? `Last changed ${shortDate(activePlan.updated_at)}` : "Set the base pay and when the view rate starts."}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-[#3b443e]">
                    <input type="checkbox" className="peer sr-only" checked={draft.active} onChange={event => patch({ active: event.target.checked })} />
                    <span className="relative h-5 w-9 rounded-full bg-[#d9ddd8] transition peer-checked:bg-[#2e7d4f] peer-focus-visible:ring-2 peer-focus-visible:ring-[#2e7d4f]/30 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" aria-hidden="true" />
                    {draft.active ? "Active" : "Paused"}
                  </label>
                </div>

                <Field label="Plan name" error={touched ? errors.name : undefined}>
                  <input className={inputCls} value={draft.name} maxLength={PLAN_LIMITS.name} placeholder="e.g. Premium creators" onChange={event => patch({ name: event.target.value })} />
                </Field>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Base pay per reel" hint="Paid when a reel is approved" error={touched ? errors.baseINR : undefined}>
                    <span className="relative block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] text-[#7a827c]">₹</span>
                      <input className={`${inputCls} pl-7 tabular-nums`} inputMode="decimal" value={draft.baseINR} onChange={event => patch({ baseINR: event.target.value })} /></span>
                  </Field>
                  <Field label="View threshold" hint={Number(draft.thresholdViews) > 0 ? `${compactViews(Number(draft.thresholdViews))} views` : "Whole views"} error={touched ? errors.thresholdViews : undefined}>
                    <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={draft.thresholdViews} onChange={event => patch({ thresholdViews: event.target.value.replace(/[^\d]/g, "") })} />
                  </Field>
                  <Field label="Rate per 1K views" hint={draft.rateINR.trim() ? "Custom rate for this plan" : `Empty uses the gig's rate${scopedGig ? ` (${formatINR(plainRate)})` : ""}`} error={touched ? errors.rateINR : undefined}>
                    <span className="relative block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] text-[#7a827c]">₹</span>
                      <input className={`${inputCls} pl-7 tabular-nums`} inputMode="decimal" value={draft.rateINR} placeholder={`Gig rate (${formatINR(plainRate)})`} onChange={event => patch({ rateINR: event.target.value })} /></span>
                  </Field>
                </div>

                <fieldset>
                  <legend className="mb-1.5 text-[12.5px] font-semibold text-[#3b443e]">After the threshold</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["all", "beyond"] as const).map(mode => {
                      const example = { mode, rateINR: terms?.rateINR ?? plainRate, baseINR: Number(draft.baseINR) || 200, thresholdViews: thresholdNumber };
                      const at = Math.round(thresholdNumber * 1.5);
                      return (
                        <label key={mode} className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 transition ${draft.mode === mode ? "border-[#2e7d4f] bg-[#f3f9f1] ring-1 ring-[#2e7d4f]/30" : "border-[#e3e7e2] hover:border-[#c9d3cb]"}`}>
                          <input type="radio" name={`${id}-mode`} className="mt-0.5 h-4 w-4 accent-[#2e7d4f]" checked={draft.mode === mode} onChange={() => patch({ mode })} />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-[#1a201c]">{PLAN_MODE_LABELS[mode].title}</span>
                            <span className="mt-0.5 block text-[11.5px] leading-[1.1rem] text-[#616a64]">{PLAN_MODE_LABELS[mode].hint}</span>
                            <span className="mt-1.5 inline-block rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#2f4b3a] ring-1 ring-[#e3e7e2]">{compactViews(at)} views → {formatINR(reelPayoutINR(at, example))}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Applies to" hint="Limit the plan to one gig, or use it on every gig that pays per 1K views">
                    <select className={inputCls} value={draft.gigId} onChange={event => patch({ gigId: event.target.value })}>
                      <option value="">All view-based gigs</option>
                      {gigs.map(gig => <option key={gig.id} value={gig.id}>{gig.title} · {gig.company} ({formatINR(Number(gig.rateINR))}/1K)</option>)}
                    </select>
                  </Field>
                  <Field label="Internal note (optional)" error={touched ? errors.description : undefined}>
                    <input className={inputCls} value={draft.description} maxLength={PLAN_LIMITS.description} placeholder="Why these creators get this plan" onChange={event => patch({ description: event.target.value })} />
                  </Field>
                </div>

                {terms ? <p className="rounded-xl border border-[#e3e7e2] bg-[#fbfcfa] px-3 py-2.5 text-[12.5px] leading-5 text-[#3b443e]"><b className="text-[#1a201c]">Creators see:</b> {describePlan(terms)}.</p> : null}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11.5px] leading-[1.1rem] text-[#7a827c]">Changes apply to reels that haven&apos;t started earning. Money already credited is never changed.</p>
                  <button type="button" className={`${primaryBtn} w-full shrink-0 sm:w-auto`} disabled={busy !== null || (!!activePlan && !dirty)} onClick={() => void save()}>
                    {busy === "save" ? "Saving…" : activePlan ? (dirty ? "Save changes" : "Saved") : "Create plan"}
                  </button>
                </div>
              </div>

              {/* Calculator */}
              {terms ? (
                <div className="space-y-3 border-t border-[#ebedea] pt-5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#1a201c]">Payout preview</h3>
                      <p className="text-[12px] text-[#7a827c]">Compared with the standard {formatINR(plainRate)} per 1K views{scopedGig ? ` on ${scopedGig.title}` : ""}.</p>
                    </div>
                    {breakEven !== null && breakEven > 0 ? <p className="rounded-full bg-[#fff6e0] px-2.5 py-1 text-[11px] font-semibold text-[#7a4f00]">Standard pays more from {compactViews(breakEven)} views{terms.mode === "all" ? ` until ${compactViews(terms.thresholdViews)}` : ""}</p> : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <label className="block min-w-0">
                      <span className="sr-only">Views on one reel</span>
                      <input type="range" min={0} max={sliderMax} step={Math.max(100, Math.round(sliderMax / 200))} value={Math.min(views, sliderMax)} onChange={event => setViews(Number(event.target.value))} className="w-full accent-[#2e7d4f]" />
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#616a64]">
                      <input className={`${inputCls} w-32 tabular-nums`} inputMode="numeric" aria-label="Views on one reel" value={String(views)} onChange={event => setViews(Math.min(2_000_000_000, Number(event.target.value.replace(/[^\d]/g, "")) || 0))} />
                      views
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-[#eef6ef] px-3 py-2.5"><p className="text-[11px] font-medium text-[#3b5a47]">This plan</p><p className="mt-1 break-words text-[17px] font-semibold tabular-nums text-[#1a201c] sm:text-[20px]">{formatINR(reelPayoutINR(views, terms))}</p></div>
                    <div className="rounded-xl bg-[#f4f5f3] px-3 py-2.5"><p className="text-[11px] font-medium text-[#616a64]">Standard</p><p className="mt-1 break-words text-[17px] font-semibold tabular-nums text-[#1a201c] sm:text-[20px]">{formatINR(plain(views))}</p></div>
                    {(() => {
                      const diff = Math.round((reelPayoutINR(views, terms) - plain(views)) * 100) / 100;
                      return <div className={`rounded-xl px-3 py-2.5 ${diff > 0 ? "bg-[#e3f1df]" : diff < 0 ? "bg-[#fdecea]" : "bg-[#f4f5f3]"}`}><p className="text-[11px] font-medium text-[#616a64]">Difference</p><p className={`mt-1 break-words text-[17px] font-semibold tabular-nums sm:text-[20px] ${diff > 0 ? "text-[#1f5131]" : diff < 0 ? "text-[#8e1f1a]" : "text-[#1a201c]"}`}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{formatINR(Math.abs(diff))}</p></div>;
                    })()}
                  </div>

                  <PayoutChart terms={terms} plainRate={plainRate} />

                  <div className="overflow-x-auto rounded-xl border border-[#e6ebe5]">
                    <table className="w-full min-w-[320px] text-left text-[12px]">
                      <thead className="bg-[#fafbf9] text-[11px] uppercase tracking-[0.06em] text-[#7a827c]"><tr><th className="px-3 py-2 font-semibold">Views</th><th className="px-3 py-2 text-right font-semibold">Plan</th><th className="px-3 py-2 text-right font-semibold">Standard</th><th className="px-3 py-2 text-right font-semibold">Difference</th></tr></thead>
                      <tbody>
                        {comparisonPoints(terms.thresholdViews).map(point => {
                          const planned = reelPayoutINR(point, terms), standard = plain(point), diff = Math.round((planned - standard) * 100) / 100;
                          return <tr key={point} className={`border-t border-[#f0f2ef] tabular-nums ${point === terms.thresholdViews ? "bg-[#fbfcf6]" : ""}`}>
                            <td className="px-3 py-2 font-medium text-[#1a201c]">{point.toLocaleString("en-IN")}{point === terms.thresholdViews ? <span className="ml-1.5 text-[10.5px] font-semibold text-[#7a827c]">threshold</span> : null}</td>
                            <td className="px-3 py-2 text-right font-semibold text-[#1a201c]">{formatINR(planned)}</td>
                            <td className="px-3 py-2 text-right text-[#616a64]">{formatINR(standard)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${diff > 0 ? "text-[#1f5131]" : diff < 0 ? "text-[#b42318]" : "text-[#7a827c]"}`}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{formatINR(Math.abs(diff))}</td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* Creators */}
              {activePlan ? (
                <div className="space-y-3 border-t border-[#ebedea] pt-5">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#1a201c]">Creators on this plan</h3>
                    <p className="text-[12px] text-[#7a827c]">A creator can be on one plan at a time. Their reels that already started earning keep the terms they started with.</p>
                  </div>

                  {selected.length ? (
                    <div className="space-y-3 rounded-2xl border border-[#d8e6d7] bg-[#f6faf4] p-3 sm:p-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-end">
                        <div className="min-w-0 text-[12.5px] leading-5 text-[#2f4b3a]">
                          <p className="font-semibold text-[#1a201c]">Apply to {assignable.length} selected {assignable.length === 1 ? "creator" : "creators"}</p>
                          <ul className="mt-1 space-y-0.5 text-[12px] text-[#4d5a51]">
                            {alreadyHere.length ? <li>{alreadyHere.length} already on this plan (their start date will update)</li> : null}
                            {moving.length ? <li>{moving.length} will move from {[...new Set(moving.map(worker => planById.get(memberByWorker.get(worker.userId!)!.planId)?.name ?? "another plan"))].join(", ")}</li> : null}
                            {noAccount ? <li className="text-[#8a5300]">{noAccount} without a sign-in account can&apos;t be added</li> : null}
                          </ul>
                        </div>
                        <Field label="For reels posted from" hint="India time">
                          <input type="date" className={inputCls} value={appliesFrom} onChange={event => setAppliesFrom(event.target.value || todayIST())} />
                        </Field>
                      </div>
                      {!activePlan.active ? <p className="text-[12px] font-medium text-[#8a5300]">Turn this plan on and save before applying it.</p> : null}
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        {onAnyPlan.length ? <button type="button" className={secondaryBtn} disabled={busy !== null} onClick={() => void remove(onAnyPlan.map(worker => worker.userId!), `${onAnyPlan.length} selected ${onAnyPlan.length === 1 ? "creator" : "creators"}`)}><Icon name="trash" />Remove selected from plans</button> : null}
                        <button type="button" className={primaryBtn} disabled={busy !== null || !assignable.length || !activePlan.active || dirty} onClick={() => void assign()}><Icon name="check" />{busy === "assign" ? "Applying…" : `Apply ${activePlan.name}`}</button>
                      </div>
                      {dirty && activePlan.active ? <p className="text-right text-[11.5px] text-[#7a827c]">Save your changes to the terms first.</p> : null}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-[#d6dcd5] px-3 py-3 text-[12.5px] leading-5 text-[#616a64]">To add creators, select them in the Workers directory (filters help), then choose <b>Payout plan</b> in the selection bar.</p>
                  )}

                  {members.some(member => member.planId === activeId) ? (
                    <>
                      <input className={inputCls} type="search" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="Search creators on this plan" aria-label="Search creators on this plan" />
                      <ul className="divide-y divide-[#f0f2ef] overflow-hidden rounded-xl border border-[#e6ebe5]">
                        {planMembers.map(({ member, worker }) => (
                          <li key={member.workerId} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef2ed] text-[11.5px] font-semibold text-[#2f4b3a]" aria-hidden="true">{(worker?.name || member.email || "?").trim().slice(0, 1).toUpperCase()}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{worker?.name || member.email || member.workerCode}</span>
                              <span className="block truncate text-[11.5px] text-[#7a827c]">{worker?.id || member.workerCode} · reels from {shortDate(member.appliesFrom)}</span>
                            </span>
                            <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#8e1f1a] transition hover:bg-[#fdecea] disabled:opacity-40" disabled={busy !== null} aria-label={`Remove ${worker?.name || member.email} from ${activePlan.name}`} onClick={() => void remove([member.workerId], worker?.name || "Creator")}><Icon name="trash" /><span className="hidden sm:inline">Remove</span></button>
                          </li>
                        ))}
                        {!planMembers.length ? <li className="px-3 py-4 text-center text-[12.5px] text-[#7a827c]">No creators match.</li> : null}
                      </ul>
                    </>
                  ) : <p className="text-[12.5px] text-[#7a827c]">No creators on this plan yet.</p>}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
