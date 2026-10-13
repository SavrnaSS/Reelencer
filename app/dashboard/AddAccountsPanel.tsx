"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ACCOUNT_REQUEST_LIMITS,
  REQUEST_STATUS_LABEL,
  requestStep,
  type AccountRequestView,
  type CreatorAccountRequests,
  type RequestCheck,
  type RequestEligibleGig,
} from "@/lib/accountRequests";
import { ACCOUNT_LIMITS, accountPlatformFor, validateAccountSetup, type AccountSetupInput } from "@/lib/accountSetup";
import type { AccountEarningsSummary } from "@/lib/creatorEarnings";
import { formatAmount } from "@/lib/money";
import { formatCompact, metricChange, type LinkedSocialAccount } from "@/lib/socialAnalytics";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import { Button, Icon, Skeleton, cx, formatRelative } from "./dashboardUi";
import PlatformGlyph from "./PlatformGlyph";

// "Add more accounts": creators request extra accounts on gigs they're linked on. Three pieces share one request
// controller: the account rail (always shows "+ Add account"), the pitch / verification card, and the add sheet
// (bottom sheet on phones, side drawer on larger screens). Linked accounts earn at the gig's rate.

type Load = { state: "loading" } | { state: "error"; message: string } | ({ state: "ready" } & CreatorAccountRequests);
export type SheetMode = { kind: "new"; sourceAccountId?: string } | { kind: "edit"; id: string } | { kind: "verify"; id: string };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/social-accounts/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || "That didn't go through. Try again.");
  return payload as T;
}

const STATUS_CHIP: Record<AccountRequestView["status"], string> = {
  pending: "bg-[#e8f0fb] text-[#1d4f8f]",
  changes_requested: "bg-[#fdf0d2] text-[#6b4a05]",
  approved: "bg-[#e3f1df] text-[#1f5131]",
  rejected: "bg-[#fde4e1] text-[#8e1f1a]",
  withdrawn: "bg-[#eef0ed] text-[#616a64]",
};
const CHECK_DOT: Record<RequestCheck["status"], string> = { pass: "bg-[#2e7d4f]", warn: "bg-[#d99a06]", fail: "bg-[#c0362c]", pending: "bg-[#b9c0ba]" };
/** Creators see the checks they can act on; duplicate/velocity signals are for the team. */
const CREATOR_CHECKS = new Set<RequestCheck["id"]>(["link", "profile", "ownership"]);
const STEPS = ["Submitted", "Ownership", "Team review", "Linked"];
const EMPTY: AccountSetupInput = { handle: "", profileUrl: "", email: "", password: "", phone: "", notes: "" };
/** Decided requests drop off after this (they stay in the team's history). */
const KEEP_DECIDED_DAYS = 14;
const PITCH_HIDDEN_KEY = "reelencer:add-accounts-pitch-hidden";

const isOpen = (r: AccountRequestView) => r.status === "pending" || r.status === "changes_requested";

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

const NO_ACCOUNTS: LinkedSocialAccount[] = [];

/**
 * Request state plus live account counts. Counts are derived from the accounts and requests on screen (not the
 * server's snapshot of them), so meters and seats update the moment a request is sent, withdrawn or approved.
 */
export function useAccountRequests(accounts: LinkedSocialAccount[] | null) {
  const linkedAccounts = accounts ?? NO_ACCOUNTS;
  const enabled = linkedAccounts.length > 0;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/social-accounts/requests", { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Account requests couldn't be loaded.");
      setLoad({ state: "ready", ...(payload as CreatorAccountRequests) });
      setNow(Date.now());
    } catch (error) {
      setLoad((previous) => (previous.state === "ready" ? previous : { state: "error", message: error instanceof Error ? error.message : "Account requests couldn't be loaded." }));
    }
  }, [enabled]);
  useEffect(() => {
    void refresh();
    // Approvals arrive over the accounts' realtime channel; refresh requests alongside.
    const onChange = () => void refresh();
    window.addEventListener("social-accounts-refreshed", onChange);
    return () => window.removeEventListener("social-accounts-refreshed", onChange);
  }, [refresh]);
  useVisibleRefresh(refresh, enabled ? 30_000 : null);
  const replace = useCallback((request: AccountRequestView) => {
    setLoad((previous) => {
      if (previous.state !== "ready") return previous;
      const exists = previous.requests.some((r) => r.id === request.id);
      return { ...previous, requests: exists ? previous.requests.map((r) => (r.id === request.id ? request : r)) : [request, ...previous.requests] };
    });
  }, []);
  const visible = useMemo(
    () =>
      load.state === "ready"
        ? load.requests.filter((r) => r.status !== "withdrawn" && (isOpen(r) || Date.parse(r.reviewedAt ?? r.createdAt) >= now - KEEP_DECIDED_DAYS * 86_400_000))
        : [],
    [load, now]
  );
  const live = useMemo(() => {
    if (load.state !== "ready" || load.unavailable) return null;
    const linked = linkedAccounts.filter((a) => a.status !== "unlinked");
    const open = load.requests.filter(isOpen);
    const eligible = load.eligible.map((g) => {
      const onGig = linked.filter((a) => a.gigId === g.gigId).length + open.filter((r) => r.gigId === g.gigId).length;
      return { ...g, accountsOnGig: onGig, slotsLeft: Math.max(0, load.limits.perGig - onGig) };
    });
    return { linked: linked.length, review: open.length, used: linked.length + open.length, total: load.limits.total, eligible };
  }, [load, linkedAccounts]);
  const capacity = useMemo(() => {
    if (!live || load.state !== "ready") return null;
    const slots = live.eligible.reduce((sum, g) => sum + g.slotsLeft, 0);
    const totalLeft = Math.max(0, live.total - live.used);
    const blocked = !live.eligible.length
      ? "Accounts can be added once one of your accounts is active."
      : live.review >= load.limits.open
        ? `You can have ${load.limits.open} accounts in review at once.`
        : !slots || !totalLeft
          ? "You've reached the account limit."
          : null;
    return { slots: Math.min(slots, totalLeft), blocked };
  }, [live, load]);
  return { load, refresh, replace, visible, capacity, live };
}
export type AccountRequestsController = ReturnType<typeof useAccountRequests>;

/* ------------------------------------------------------------------ */
/* Account rail                                                        */
/* ------------------------------------------------------------------ */

/** Ring around a request's icon showing how far verification has come (Submitted → Ownership → Review → Linked). */
function ProgressRing({ step, tone, children }: { step: number; tone: string; children: ReactNode }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, (step + 1) / STEPS.length);
  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e3e5e1" strokeWidth="2.5" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c * progress} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#4b544e]">{children}</span>
    </span>
  );
}

/** What the creator should do (or wait for) next on a request in verification. */
function nextAction(request: AccountRequestView) {
  if (request.status === "changes_requested") return { label: "Fix requested", tone: "#d99a06", text: "text-[#8a5a00]" };
  const owned = request.checks.find((c) => c.id === "ownership")?.status === "pass";
  return owned ? { label: "Team reviewing", tone: "#2a78d6", text: "text-[#1d4f8f]" } : { label: "Add code to bio", tone: "#d99a06", text: "text-[#8a5a00]" };
}

/** Linked accounts, accounts in verification, and an always-present "+ Add account" entry point. */
export function AccountsRail({
  accounts,
  selectedId,
  onSelect,
  controller,
  onOpenSheet,
  earnings,
}: {
  accounts: LinkedSocialAccount[];
  selectedId: string;
  onSelect: (id: string) => void;
  controller: AccountRequestsController;
  onOpenSheet: (mode: SheetMode) => void;
  earnings?: AccountEarningsSummary | null;
}) {
  const pending = controller.visible.filter(isOpen);
  const blocked = controller.capacity?.blocked ?? null;
  const earnedBy = new Map((earnings?.breakdown ?? []).map((row) => [row.accountId, row]));
  const totalFollowers = accounts.reduce((sum, a) => sum + (metricChange(a.snapshots, "followers").value ?? 0), 0);
  const chip =
    "group relative flex min-h-[60px] w-[min(15.5rem,70vw)] shrink-0 snap-start items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2e7d4f]/45 sm:w-auto sm:min-w-[14.5rem]";
  const seatsLabel = controller.capacity && !blocked ? `${controller.capacity.slots} ${controller.capacity.slots === 1 ? "seat" : "seats"} open` : blocked ? "Limit reached" : "Earn on more accounts";

  return (
    <section aria-label="Your accounts" className="rounded-2xl border border-[#ebedea] bg-white p-2 sm:p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-1.5 pb-2 pt-1">
        <p className="text-[12.5px] font-semibold text-[#1a201c]">
          {accounts.length} linked
          {pending.length ? <span className="font-medium text-[#7a827c]"> · {pending.length} in verification</span> : null}
        </p>
        <p className="text-[11.5px] text-[#7a827c]">
          <span className="font-semibold tabular-nums text-[#3b443e]">{formatCompact(totalFollowers)}</span> followers
          {earnings?.approved ? (
            <>
              {" · "}
              <span className="font-semibold tabular-nums text-[#1f5131]">{rupees(earnings.approved)}</span> approved
            </>
          ) : null}
        </p>
      </div>

      {/* Phones: a scrolling row (right edge fades, next chip peeks in) with "Add" pinned beside it.
          Larger screens: everything wraps, and "Add" is the last chip. */}
      <div className="flex items-stretch gap-2">
      <div
        role="toolbar"
        aria-label="Switch account"
        className="dashboard-chip-scroller -my-1 flex min-w-0 flex-1 snap-x snap-mandatory scroll-px-0.5 gap-2 overflow-x-auto px-0.5 py-1 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] sm:my-0 sm:flex-wrap sm:overflow-visible sm:p-0 sm:[mask-image:none]"
      >
        {accounts.map((account) => {
          const active = account.id === selectedId;
          const followers = metricChange(account.snapshots, "followers");
          const earned = earnedBy.get(account.id);
          const paused = account.status !== "active";
          return (
            <button
              key={account.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(account.id)}
              className={cx(chip, active ? "border-[#1f2b24] bg-[#1f2b24] text-white shadow-[0_6px_18px_-8px_rgba(31,43,36,0.6)]" : "border-[#e3e5e1] bg-[#fafbf9] text-[#1a201c] hover:border-[#cfd5cf] hover:bg-white")}
            >
              <span className={cx("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", active ? "bg-white/10" : "bg-white text-[#2b5d4a] ring-1 ring-[#e3e5e1]")}>
                <PlatformGlyph platform={accountPlatformFor(account.platform)} className="h-5 w-5" />
                <span className={cx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2", active ? "border-[#1f2b24]" : "border-white", paused ? "bg-[#d99a06]" : "bg-[#4caf6e]")} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-semibold">@{account.handle}</span>
                  {paused ? <span className="shrink-0 rounded-full bg-[#fdf0d2] px-1.5 text-[10px] font-semibold text-[#6b4a05]">Paused</span> : null}
                </span>
                <span className={cx("mt-0.5 flex items-center gap-1.5 text-[11.5px] tabular-nums", active ? "text-white/70" : "text-[#7a827c]")}>
                  {followers.value !== undefined ? `${formatCompact(followers.value)} followers` : account.platform}
                  {followers.change ? (
                    <span className={cx("font-semibold", followers.change > 0 ? (active ? "text-[#9fd8ae]" : "text-[#1f5131]") : active ? "text-[#f3aaa3]" : "text-[#8e1f1a]")}>
                      {followers.change > 0 ? "+" : "−"}
                      {formatCompact(Math.abs(followers.change))}
                    </span>
                  ) : null}
                </span>
              </span>
              {earned && earned.approved + earned.pending > 0 ? (
                <span className={cx("shrink-0 text-right text-[11px] leading-4", active ? "text-white/70" : "text-[#7a827c]")}>
                  <span className={cx("block text-[12.5px] font-semibold tabular-nums", active ? "text-white" : "text-[#1f5131]")}>{rupees(earned.approved)}</span>
                  earned
                </span>
              ) : null}
            </button>
          );
        })}

        {pending.map((request) => {
          const action = nextAction(request);
          return (
            <button
              key={request.id}
              type="button"
              onClick={() => onOpenSheet(request.status === "changes_requested" ? { kind: "edit", id: request.id } : { kind: "verify", id: request.id })}
              className={cx(chip, "border-dashed border-[#cfd5cf] bg-white text-[#1a201c] hover:border-[#9aa29c] hover:bg-[#fafbf9]")}
              aria-label={`@${request.handle}: ${REQUEST_STATUS_LABEL[request.status]}, ${action.label}`}
            >
              <ProgressRing step={requestStep(request)} tone={action.tone}>
                <PlatformGlyph platform={accountPlatformFor(request.platform)} className="h-[18px] w-[18px]" />
              </ProgressRing>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-[#3b443e]">@{request.handle}</span>
                <span className={cx("mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium", action.text)}>
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden" style={{ background: action.tone }} />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: action.tone }} />
                  </span>
                  {action.label}
                </span>
              </span>
              <Icon.ChevronRight className="h-4 w-4 shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#4b544e]" />
            </button>
          );
        })}

        {controller.load.state === "loading" ? (
          <Skeleton className="hidden h-[60px] w-[13.5rem] shrink-0 rounded-xl sm:block" />
        ) : (
          <div className="hidden sm:contents">
          <button
            type="button"
            onClick={() => onOpenSheet({ kind: "new" })}
            aria-disabled={!!blocked}
            title={blocked ?? undefined}
            className={cx(
              chip,
              "min-w-[11rem] border-dashed sm:min-w-[11.5rem]",
              blocked ? "border-[#e3e5e1] bg-[#fafbf9] text-[#9aa29c]" : "border-[#9cc3a7] bg-[#f4f9f2] text-[#1f5131] hover:border-[#2e7d4f] hover:bg-[#ebf5e8]"
            )}
          >
            <span
              className={cx(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[20px] font-semibold leading-none transition",
                blocked ? "bg-white ring-1 ring-[#e3e5e1]" : "bg-[#1f2b24] text-white group-hover:scale-105"
              )}
              aria-hidden="true"
            >
              +
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold">Add account</span>
              <span className="mt-0.5 block text-[11.5px] opacity-80">{seatsLabel}</span>
            </span>
          </button>
          </div>
        )}
      </div>

      {/* Phones: always-visible add button */}
      {controller.load.state === "loading" ? (
        <Skeleton className="w-16 shrink-0 rounded-xl sm:hidden" />
      ) : (
        <button
          type="button"
          onClick={() => onOpenSheet({ kind: "new" })}
          aria-disabled={!!blocked}
          aria-label={`Add account, ${seatsLabel}`}
          className={cx(
            "relative flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/45 focus-visible:ring-offset-1 sm:hidden",
            blocked ? "border border-dashed border-[#e3e5e1] bg-[#fafbf9] text-[#9aa29c]" : "bg-[#1f2b24] text-white shadow-[0_6px_16px_-8px_rgba(31,43,36,0.7)]"
          )}
        >
          <span className="text-[22px] font-semibold leading-none" aria-hidden="true">+</span>
          Add
          {controller.capacity && !blocked ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#4caf6e] px-1 text-[10.5px] font-bold text-white ring-2 ring-white" aria-hidden="true">
              {controller.capacity.slots}
            </span>
          ) : null}
        </button>
      )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pitch + verification card                                           */
/* ------------------------------------------------------------------ */

function money(value: number) {
  return formatAmount(value, "₹");
}

/** What the creator's accounts on this gig have earned so far, approved and in review kept apart. */
function gigEarnings(gig: RequestEligibleGig | undefined, accounts: LinkedSocialAccount[], earnings: AccountEarningsSummary | null) {
  if (!gig || !earnings) return null;
  const ids = new Set(accounts.filter((a) => a.gigId === gig.gigId && a.status !== "unlinked").map((a) => a.id));
  const rows = earnings.breakdown.filter((row) => ids.has(row.accountId));
  if (!rows.length) return null;
  const approved = rows.reduce((sum, row) => sum + row.approved, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  return approved + pending > 0 ? { approved, pending, accounts: rows.length } : null;
}

/** Whole rupees once amounts are large enough that paise are noise. */
const rupees = (value: number) => (value >= 100 ? `₹${Math.round(value).toLocaleString("en-IN")}` : money(value));

const PITCH_STEPS = [
  { title: "Submit", detail: "username & login" },
  { title: "Verify", detail: "code in the bio" },
  { title: "Earn", detail: "once the team links it" },
];

function PitchCard({
  gig,
  accounts,
  requests,
  earnings,
  onAdd,
  onHide,
}: {
  gig: RequestEligibleGig;
  accounts: LinkedSocialAccount[];
  requests: AccountRequestView[];
  earnings: AccountEarningsSummary | null;
  onAdd: () => void;
  onHide: () => void;
}) {
  const earned = gigEarnings(gig, accounts, earnings);
  // Seats on this gig: linked accounts, then requests in review, then open seats.
  const seats = [
    ...accounts.filter((a) => a.gigId === gig.gigId && a.status !== "unlinked").map((a) => ({ key: a.id, handle: a.handle, state: "linked" as const })),
    ...requests.filter((r) => r.gigId === gig.gigId && isOpen(r)).map((r) => ({ key: r.id, handle: r.handle, state: "review" as const })),
  ].slice(0, ACCOUNT_REQUEST_LIMITS.perGig);
  const open = Math.max(0, ACCOUNT_REQUEST_LIMITS.perGig - seats.length);
  const platform = accountPlatformFor(gig.platform);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#cfe3d4] bg-white">
      {/* Soft brand wash, stronger on the left where the message is */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,#e6f2e3_0%,rgba(255,255,255,0)_55%)]" aria-hidden="true" />
      <button type="button" onClick={onHide} className="absolute right-2.5 top-2.5 z-10 rounded-lg p-1.5 text-[#7a827c] transition hover:bg-[#f1f3f0] hover:text-[#1a201c]" aria-label="Hide this suggestion">
        <Icon.Close className="h-3.5 w-3.5" />
      </button>

      <div className="relative grid gap-5 p-4 sm:p-5 @[680px]/addacc:grid-cols-[minmax(0,1fr)_auto] @[680px]/addacc:items-center @[1000px]/addacc:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] @[1000px]/addacc:gap-8">
        {/* Message */}
        <div className="min-w-0 pr-8 @[680px]/addacc:pr-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1f2b24] text-white">
              <Icon.ArrowUp className="h-3.5 w-3.5" />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2b5d4a]">Grow your earnings</p>
          </div>
          <h3 className="mt-2.5 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-[#1a201c] sm:text-[17px]">Earn on more accounts for this gig</h3>
          <p className="mt-1 text-[12.5px] leading-5 text-[#4b544e]">
            Every verified {platform.label} account earns <span className="font-semibold text-[#1a201c]">{gig.payoutPhrase ?? "at the gig's rate"}</span> on its own.
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[#7a827c]" title={gig.gigTitle}>
            {gig.gigTitle ?? "Content Posting gig"}
            {gig.company ? ` · ${gig.company}` : ""}
          </p>
          {earned ? (
            <dl className="mt-3 inline-flex flex-wrap items-stretch overflow-hidden rounded-lg bg-white text-[12px] ring-1 ring-[#e3ebe1]">
              <div className="px-3 py-1.5">
                <dt className="text-[10.5px] text-[#7a827c]">{earned.accounts === 1 ? `@${seats[0]?.handle ?? "account"} approved` : "Approved"}</dt>
                <dd className="font-semibold tabular-nums text-[#1f5131]">{rupees(earned.approved)}</dd>
              </div>
              {earned.pending > 0 ? (
                <div className="border-l border-[#e3ebe1] px-3 py-1.5">
                  <dt className="text-[10.5px] text-[#7a827c]">In review</dt>
                  <dd className="font-semibold tabular-nums text-[#1a201c]">{rupees(earned.pending)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        {/* How it works: stepper with a connecting line */}
        <ol className="relative grid grid-cols-3 gap-2 @[680px]/addacc:col-span-2 @[1000px]/addacc:col-span-1" aria-label="How it works">
          <span className="absolute left-[16.66%] right-[16.66%] top-4 h-px bg-[#cfe3d4]" aria-hidden="true" />
          {PITCH_STEPS.map((step, index) => (
            <li key={step.title} className="relative flex flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[12.5px] font-semibold text-[#1f5131] ring-1 ring-[#9cc3a7]">{index + 1}</span>
              <span className="mt-1.5 text-[12px] font-semibold text-[#1a201c]">{step.title}</span>
              <span className="text-[11px] leading-4 text-[#7a827c]">{step.detail}</span>
            </li>
          ))}
        </ol>

        {/* Seats + action */}
        <div className="flex flex-col gap-3 @[680px]/addacc:row-start-1 @[680px]/addacc:col-start-2 @[680px]/addacc:items-end @[1000px]/addacc:col-start-3">
          <div className="flex items-center justify-between gap-3 @[680px]/addacc:justify-end">
            <ul className="flex -space-x-1.5" aria-label={`${seats.length} of ${ACCOUNT_REQUEST_LIMITS.perGig} accounts on this gig`}>
              {seats.map((seat) => (
                <li key={seat.key} title={`@${seat.handle}${seat.state === "review" ? " (in review)" : ""}`} className={cx("relative flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold uppercase ring-2 ring-white", seat.state === "linked" ? "bg-[#1f2b24] text-white" : "bg-[#e8f0fb] text-[#1d4f8f]")}>
                  {seat.handle.slice(0, 1)}
                  {seat.state === "review" ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#2a78d6] ring-2 ring-white" aria-hidden="true" /> : null}
                </li>
              ))}
              {Array.from({ length: open }, (_, i) => (
                <li key={`open-${i}`}>
                  <button type="button" onClick={onAdd} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-[#9cc3a7] bg-white text-[16px] font-semibold leading-none text-[#2b5d4a] ring-2 ring-white transition hover:border-[#2e7d4f] hover:bg-[#f4f9f2]" aria-label="Add an account to this seat">
                    +
                  </button>
                </li>
              ))}
            </ul>
            <span className="text-right text-[11.5px] leading-4 text-[#616a64]">
              <span className="block font-semibold text-[#1a201c]">{open} {open === 1 ? "seat" : "seats"} open</span>
              {seats.length} of {ACCOUNT_REQUEST_LIMITS.perGig} on this gig
            </span>
          </div>
          <Button variant="primary" size="lg" onClick={onAdd} className="w-full @[680px]/addacc:w-auto">
            <span aria-hidden="true" className="text-[16px] leading-none">+</span> Add an account
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AddAccountsPanel({
  controller,
  accounts,
  earnings,
  onOpenSheet,
}: {
  controller: AccountRequestsController;
  accounts: LinkedSocialAccount[];
  earnings: AccountEarningsSummary | null;
  onOpenSheet: (mode: SheetMode) => void;
}) {
  const { load, visible, capacity, replace, refresh } = controller;
  const [pitchHidden, setPitchHidden] = useState(false);
  useEffect(() => {
    // Read after hydration so server and client render the same first frame.
    queueMicrotask(() => {
      try {
        setPitchHidden(window.localStorage.getItem(PITCH_HIDDEN_KEY) === "1");
      } catch {
        /* Storage unavailable: show the pitch. */
      }
    });
  }, []);
  const hidePitch = () => {
    setPitchHidden(true);
    try {
      window.localStorage.setItem(PITCH_HIDDEN_KEY, "1");
    } catch {
      /* Per-browser preference only. */
    }
  };

  if (load.state !== "ready" || load.unavailable) return null;
  const best = [...(controller.live?.eligible ?? [])].sort((a, b) => b.slotsLeft - a.slotsLeft)[0];
  const showPitch = !pitchHidden && !!capacity && !capacity.blocked && !visible.some(isOpen);
  if (!showPitch && !visible.length) return null;

  return (
    <section aria-label="Add more accounts" className="@container/addacc space-y-3">
      {showPitch && best ? (
        <PitchCard gig={best} accounts={accounts} requests={visible} earnings={earnings} onAdd={() => onOpenSheet({ kind: "new", sourceAccountId: best.sourceAccountId })} onHide={hidePitch} />
      ) : null}

      {visible.length ? (
        <div className="rounded-2xl border border-[#ebedea] bg-white">
          <div className="flex flex-col gap-2 border-b border-[#ebedea] px-4 py-3 @[560px]/addacc:flex-row @[560px]/addacc:items-center @[560px]/addacc:justify-between sm:px-5">
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-[#1a201c]">Account verification</h3>
              <p className="text-[12px] text-[#7a827c]">{visible.filter(isOpen).length ? "The team usually verifies within a day." : "Recent decisions"}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              {controller.live ? <SlotMeter linked={controller.live.linked} review={controller.live.review} total={controller.live.total} /> : null}
              {capacity && !capacity.blocked ? (
                <span className="hidden @[560px]/addacc:block">
                  <Button size="sm" onClick={() => onOpenSheet({ kind: "new" })}>
                    + Add
                  </Button>
                </span>
              ) : null}
            </div>
          </div>
          <ul className="grid gap-3 p-2.5 @[900px]/addacc:grid-cols-2 sm:p-4">
            {visible.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                onChange={(next) => {
                  replace(next);
                  if (next.status === "withdrawn") void refresh();
                }}
                onEdit={() => onOpenSheet({ kind: "edit", id: request.id })}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Account allowance across all gigs: linked (green), in review (blue), free (grey). Animates as counts change. */
function SlotMeter({ linked, review, total }: { linked: number; review: number; total: number }) {
  const used = Math.min(total, linked + review);
  const free = Math.max(0, total - used);
  const parts = [linked ? `${linked} linked` : null, review ? `${review} in review` : null, `${free} free`].filter(Boolean).join(" · ");
  return (
    <span className="flex min-w-0 items-center gap-2" title={parts}>
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-1.5 w-3.5 rounded-full transition-colors duration-500",
              i < linked ? "bg-[#2e7d4f]" : i < used ? "bg-[#2a78d6] motion-safe:animate-pulse" : "bg-[#dfe5dd]"
            )}
          />
        ))}
      </span>
      {/* Announced politely when counts change (submit, approval, withdrawal). */}
      <span className="whitespace-nowrap text-[11px] tabular-nums text-[#7a827c]" aria-live="polite">
        <span className="font-semibold text-[#3b443e]">{used}</span> of {total} accounts
        <span className="sr-only">: {parts}</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Request card                                                        */
/* ------------------------------------------------------------------ */

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[#9cc3a7] bg-white px-3 py-1.5 font-mono text-[15px] font-semibold tracking-[0.08em] text-[#1f5131] transition hover:bg-[#f4f9f2]"
      aria-label={`Copy code ${code}`}
    >
      {code}
      <span className="font-sans text-[11px] font-semibold tracking-normal text-[#2b5d4a]">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Steps({ request }: { request: AccountRequestView }) {
  const step = requestStep(request);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Verification progress">
      {STEPS.map((label, index) => {
        const done = index < step || (index === step && request.status === "approved");
        const current = index === step && request.status !== "approved";
        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              className={cx(
                "h-1.5 rounded-full",
                done ? "bg-[#2e7d4f]" : current ? (request.status === "rejected" ? "bg-[#c0362c]" : request.status === "changes_requested" ? "bg-[#d99a06]" : "bg-[#8dbf98]") : "bg-[#e3e5e1]"
              )}
            />
            <span className={cx("truncate text-[10.5px]", done || current ? "font-semibold text-[#3b443e]" : "text-[#9aa29c]")} aria-current={current ? "step" : undefined}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Code + "Check again" + the checks the creator can act on. Shared by the card and the sheet's verify step. */
function OwnershipBox({ request, onChange }: { request: AccountRequestView; onChange: (r: AccountRequestView) => void }) {
  const platform = accountPlatformFor(request.platform);
  const owned = request.checks.find((c) => c.id === "ownership")?.status === "pass";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const waiting = !owned && (request.status === "pending" || request.status === "changes_requested");
  // Parents pass inline handlers; a ref keeps the background timer from restarting on every re-render.
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  const recheck = useCallback(async (silent = false) => {
    if (!silent) {
      setBusy(true);
      setMessage(null);
    }
    try {
      const { request: next } = await post<{ request: AccountRequestView }>({ action: "recheck", id: request.id });
      changeRef.current(next);
      const found = next.checks.find((c) => c.id === "ownership")?.status === "pass";
      if (!silent || found) setMessage(found ? "Code found. The team will verify it shortly." : "Not found yet. Bio changes can take a minute to show.");
    } catch (e) {
      // Background checks hit the server cooldown when another tab just checked; only manual checks report it.
      if (!silent) setMessage(e instanceof Error ? e.message : "Couldn't check right now.");
    } finally {
      if (!silent) setBusy(false);
    }
  }, [request.id]);
  // Keep checking in the background while the code isn't found, so ownership confirms itself once the bio is saved.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) void recheck(true);
    }, (ACCOUNT_REQUEST_LIMITS.recheckSeconds + 5) * 1000);
    return () => window.clearInterval(timer);
  }, [waiting, recheck]);
  return (
    <div className="space-y-2.5">
      <div className={cx("rounded-lg p-3", owned ? "bg-[#f4f9f2]" : "bg-[#f7f8f6]")}>
        <p className="text-[12px] font-semibold text-[#3b443e]">{owned ? "Ownership confirmed" : "Prove it's yours"}</p>
        <p className="mt-0.5 text-[12px] text-[#616a64]">{owned ? "Keep the code in the bio until the account is linked." : `Add this code anywhere in the ${platform.label} bio, save, then check again.`}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CopyCode code={request.verifyCode} />
          {!owned ? (
            <Button size="sm" onClick={() => void recheck()} disabled={busy}>
              {busy ? "Checking…" : "Check again"}
            </Button>
          ) : null}
        </div>
        {waiting ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#7a827c]">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8dbf98] opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2e7d4f]" />
            </span>
            Checking automatically every minute while this page is open
          </p>
        ) : null}
        {message ? <p role="status" className="mt-2 text-[12px] text-[#4b544e]">{message}</p> : null}
      </div>
      <ul className="space-y-1.5 px-0.5" aria-label="Automatic checks">
        {request.checks
          .filter((c) => CREATOR_CHECKS.has(c.id))
          .map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-[12px]">
              <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", CHECK_DOT[check.status])} aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-semibold text-[#3b443e]">{check.label}</span>
                <span className="text-[#616a64]"> · {check.detail}</span>
              </span>
            </li>
          ))}
        {request.checkedAt ? <li className="text-[11px] text-[#9aa29c]">Checked {formatRelative(request.checkedAt)}</li> : null}
      </ul>
    </div>
  );
}

function RequestCard({ request, onChange, onEdit }: { request: AccountRequestView; onChange: (r: AccountRequestView) => void; onEdit: () => void }) {
  const platform = accountPlatformFor(request.platform);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = isOpen(request);
  const withdraw = async () => {
    setBusy(true);
    try {
      await post({ action: "withdraw", id: request.id });
      onChange({ ...request, status: "withdrawn" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't withdraw it.");
      setBusy(false);
    }
  };
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-[#ebedea] bg-white p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ed] text-[#2b5d4a]">
            <PlatformGlyph platform={platform} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <a href={request.profileUrl} target="_blank" rel="noreferrer noopener" className="block truncate text-[14px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">
              @{request.handle}
            </a>
            <p className="truncate text-[12px] text-[#7a827c]">{request.gigTitle ?? "Content Posting gig"}</p>
          </div>
        </div>
        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_CHIP[request.status])}>{REQUEST_STATUS_LABEL[request.status]}</span>
      </div>
      <Steps request={request} />
      {request.reviewNote && (request.status === "changes_requested" || request.status === "rejected") ? (
        <div className={cx("rounded-lg px-3 py-2 text-[12.5px]", request.status === "rejected" ? "bg-[#fdf2f1] text-[#5c1a16]" : "bg-[#fdf8ec] text-[#5f4a1c]")}>
          <span className="font-semibold">Team note: </span>
          {request.reviewNote}
        </div>
      ) : null}
      {open ? <OwnershipBox request={request} onChange={onChange} /> : request.status === "approved" ? <p className="text-[12.5px] text-[#1f5131]">Linked. Reels on @{request.handle} now count towards your earnings. You can remove the code from the bio.</p> : null}
      {error ? <p role="alert" className="text-[12px] text-[#8e1f1a]">{error}</p> : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[#9aa29c]">{open ? `Sent ${formatRelative(request.submittedAt)}` : `Reviewed ${formatRelative(request.reviewedAt)}`}</span>
        {open ? (
          <span className="flex gap-2">
            <Button size="sm" variant="plain" onClick={() => void withdraw()} disabled={busy}>
              {busy ? "Withdrawing…" : "Withdraw"}
            </Button>
            {request.status === "changes_requested" ? (
              <Button size="sm" variant="primary" onClick={onEdit}>
                Edit and resubmit
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-[#3b443e]">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-[11.5px] text-[#b42318]">{error}</p> : hint ? <p className="mt-1 text-[11.5px] text-[#8a928c]">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-[#d9ddd8] bg-white px-3 text-[14px] text-[#1a201c] outline-none transition placeholder:text-[#a3aaa4] focus:border-[#2e7d4f] focus:ring-2 focus:ring-[#2e7d4f]/20 aria-[invalid=true]:border-[#e5a49d] sm:h-10 sm:text-[13.5px]";

function RequestForm({ gigs, initialSourceId, editing, onDone, onCancel }: { gigs: RequestEligibleGig[]; initialSourceId?: string; editing?: AccountRequestView; onDone: (r: AccountRequestView) => void; onCancel: () => void }) {
  const uid = useId();
  const openGigs = gigs.filter((g) => g.slotsLeft > 0);
  const [sourceId, setSourceId] = useState(editing?.sourceAccountId ?? (openGigs.find((g) => g.sourceAccountId === initialSourceId) ?? openGigs[0])?.sourceAccountId ?? "");
  const gig = gigs.find((g) => g.sourceAccountId === sourceId);
  const platform = accountPlatformFor(editing?.platform ?? gig?.platform);
  const [values, setValues] = useState<AccountSetupInput>(
    editing ? { handle: editing.handle, profileUrl: editing.profileUrl, email: editing.email, password: "", phone: editing.phone ?? "", notes: editing.notes ?? "" } : EMPTY
  );
  const [touched, setTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = useMemo(() => validateAccountSetup(values, platform, { passwordOptional: !!editing }), [values, platform, editing]);
  const set = (key: keyof AccountSetupInput) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const shown = (key: keyof AccountSetupInput) => (touched ? errors[key] : undefined);
  // Typing a username fills the profile link for platforms with a simple profile URL.
  const suggestLink = () => {
    const handle = values.handle.trim().replace(/^@+/, "");
    if (!values.profileUrl.trim() && handle && platform.hosts[0] && /^[\w.]+$/.test(handle)) setValues((v) => ({ ...v, profileUrl: `https://www.${platform.hosts[0]}/${handle}/` }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || (!editing && !sourceId)) return;
    setBusy(true);
    setError(null);
    try {
      const { request } = await post<{ request: AccountRequestView }>(editing ? { action: "resubmit", id: editing.id, ...values } : { action: "submit", sourceAccountId: sourceId, ...values });
      onDone(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="@container/sheet min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
        {editing?.reviewNote ? (
          <p className="rounded-lg bg-[#fdf8ec] px-3 py-2 text-[12.5px] text-[#5f4a1c]">
            <span className="font-semibold">Team note: </span>
            {editing.reviewNote}
          </p>
        ) : null}
        {!editing && gigs.length > 1 ? (
          <fieldset>
            <legend className="text-[12px] font-semibold text-[#3b443e]">Gig</legend>
            <div className="mt-1.5 grid gap-2 @[440px]/sheet:grid-cols-2">
              {gigs.map((g) => {
                const disabled = g.slotsLeft <= 0;
                const active = g.sourceAccountId === sourceId;
                return (
                  <label
                    key={g.sourceAccountId}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#2e7d4f]/40",
                      disabled ? "cursor-not-allowed border-[#ebedea] bg-[#f5f6f4] opacity-60" : active ? "border-[#1f2b24] bg-white ring-1 ring-[#1f2b24]" : "border-[#d9ddd8] bg-white hover:border-[#b9c0ba]"
                    )}
                  >
                    <input type="radio" name={`${uid}-gig`} className="sr-only" checked={active} disabled={disabled} onChange={() => setSourceId(g.sourceAccountId)} />
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef1ed] text-[#2b5d4a]">
                      <PlatformGlyph platform={accountPlatformFor(g.platform)} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{g.gigTitle ?? "Content Posting gig"}</span>
                      <span className="block truncate text-[11.5px] text-[#7a827c]">{g.payoutPhrase ?? g.company ?? g.platform}</span>
                      <span className={cx("mt-1 block text-[11px] font-medium", disabled ? "text-[#9a5b00]" : "text-[#2b5d4a]")}>
                        {disabled ? "Account limit reached" : `${g.accountsOnGig} of ${ACCOUNT_REQUEST_LIMITS.perGig} accounts · ${g.slotsLeft} left`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : !editing && gig ? (
          <div className="flex items-center gap-3 rounded-lg bg-[#f7f8f6] p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#2b5d4a] ring-1 ring-[#e3e5e1]">
              <PlatformGlyph platform={platform} className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{gig.gigTitle ?? "Content Posting gig"}</span>
              <span className="block truncate text-[11.5px] text-[#7a827c]">
                {gig.payoutPhrase ? `${gig.payoutPhrase} · ` : ""}
                {gig.slotsLeft} of {ACCOUNT_REQUEST_LIMITS.perGig} slots left
              </span>
            </span>
          </div>
        ) : null}

        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">The account</p>
          <div className="grid gap-3 @[440px]/sheet:grid-cols-2">
            <Field label={`${platform.label} username`} htmlFor={`${uid}-handle`} error={shown("handle")} hint="Without the @">
              <input id={`${uid}-handle`} autoFocus className={inputClass} value={values.handle} onChange={set("handle")} onBlur={suggestLink} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="yourname" aria-invalid={!!shown("handle")} />
            </Field>
            <Field label="Profile link" htmlFor={`${uid}-url`} error={shown("profileUrl")} hint={platform.hosts[0] ? `Filled from the username; check it opens the account` : undefined}>
              <input id={`${uid}-url`} className={inputClass} value={values.profileUrl} onChange={set("profileUrl")} inputMode="url" autoComplete="off" autoCapitalize="none" placeholder={platform.hosts[0] ? `https://www.${platform.hosts[0]}/yourname/` : "https://"} aria-invalid={!!shown("profileUrl")} />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">Login for the team</p>
          <div className="grid gap-3 @[440px]/sheet:grid-cols-2">
            <Field label="Login email" htmlFor={`${uid}-email`} error={shown("email")}>
              <input id={`${uid}-email`} type="email" className={inputClass} value={values.email} onChange={set("email")} autoComplete="off" autoCapitalize="none" aria-invalid={!!shown("email")} />
            </Field>
            <Field label="Password" htmlFor={`${uid}-password`} error={shown("password")} hint="Encrypted. Only the review team can see it.">
              <div className="relative">
                <input
                  id={`${uid}-password`}
                  type={showPassword ? "text" : "password"}
                  className={cx(inputClass, "pr-16")}
                  value={values.password}
                  onChange={set("password")}
                  autoComplete="new-password"
                  maxLength={ACCOUNT_LIMITS.password}
                  placeholder={editing?.hasPassword ? "Keep saved password" : ""}
                  aria-invalid={!!shown("password")}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11.5px] font-semibold text-[#2b5d4a] hover:bg-[#eef1ed]">
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <Field label="Phone (optional)" htmlFor={`${uid}-phone`} error={shown("phone")}>
              <input id={`${uid}-phone`} type="tel" className={inputClass} value={values.phone} onChange={set("phone")} autoComplete="off" aria-invalid={!!shown("phone")} />
            </Field>
            <Field label="Note (optional)" htmlFor={`${uid}-notes`} error={shown("notes")}>
              <input id={`${uid}-notes`} className={inputClass} value={values.notes} onChange={set("notes")} maxLength={ACCOUNT_LIMITS.notes} placeholder="e.g. 2FA codes go to this email" />
            </Field>
          </div>
        </div>
        {error ? <p role="alert" className="rounded-lg bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-[#8e1f1a]">{error}</p> : null}
      </div>
      <div className="flex gap-2 border-t border-[#ebedea] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-6">
        <Button onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || (!editing && !openGigs.length)} className="flex-[2] sm:flex-none">
          {busy ? "Checking the account…" : editing ? "Resubmit" : "Submit for verification"}
        </Button>
      </div>
    </form>
  );
}

/** Bottom sheet on phones, right-side drawer from `sm` up. */
export function AddAccountSheet({ mode, controller, onClose, onMode }: { mode: SheetMode; controller: AccountRequestsController; onClose: () => void; onMode: (mode: SheetMode) => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { load, replace, refresh, capacity } = controller;
  // Background refreshes re-render the parent with a new onClose; the dialog setup must run once per opening.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      // Keep Tab inside the dialog.
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  const ready = load.state === "ready" && !load.unavailable ? load : null;
  const request = ready && mode.kind !== "new" ? ready.requests.find((r) => r.id === mode.id) : undefined;
  const title = mode.kind === "edit" ? `Update @${request?.handle ?? "account"}` : mode.kind === "verify" ? `Verify @${request?.handle ?? "account"}` : "Add an account";
  const subtitle =
    mode.kind === "verify"
      ? "Prove the account is yours so the team can link it."
      : mode.kind === "edit"
        ? "Fix what the team asked for. Leave the password empty to keep the saved one."
        : "Use a separate account you created yourself. The team verifies it before it's linked.";

  let body: ReactNode;
  if (load.state === "loading") {
    body = (
      <div className="space-y-3 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (load.state === "error" || load.unavailable) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef1ed] text-[#2b5d4a]">
          <Icon.Clipboard className="h-6 w-6" />
        </span>
        <p className="text-[14px] font-semibold text-[#1a201c]">{load.state === "error" ? "Couldn't load account requests" : "Adding accounts is being switched on"}</p>
        <p className="max-w-[40ch] text-[12.5px] text-[#616a64]">{load.state === "error" ? load.message : "This part of Reelencer is almost ready. Check back soon, or message the team if you'd like to add an account now."}</p>
        {load.state === "error" ? (
          <Button size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  } else if (mode.kind === "verify" && request) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <Steps request={request} />
          <OwnershipBox request={request} onChange={replace} />
          <p className="text-[12px] text-[#7a827c]">You can close this. Progress shows on your accounts page and you get an email when the team decides.</p>
        </div>
        <div className="border-t border-[#ebedea] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button variant="primary" fullWidth onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  } else if (mode.kind === "new" && capacity?.blocked) {
    body = <p className="px-6 py-10 text-center text-[13px] text-[#616a64]">{capacity.blocked}</p>;
  } else if (ready) {
    body = (
      <RequestForm
        key={mode.kind === "edit" ? mode.id : "new"}
        gigs={controller.live?.eligible ?? ready.eligible}
        initialSourceId={mode.kind === "new" ? mode.sourceAccountId : undefined}
        editing={mode.kind === "edit" ? request : undefined}
        onCancel={onClose}
        onDone={(next) => {
          replace(next);
          void refresh();
          // Straight to the ownership step: that's the creator's next action.
          onMode({ kind: "verify", id: next.id });
        }}
      />
    );
  }

  // Portal to <body>: dashboard sections animate with transforms, which would trap a fixed overlay inside them.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-stretch sm:justify-end" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#0f1411]/40 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex outline-none max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-12px_40px_-12px_rgba(15,20,17,0.35)] sm:max-h-none sm:h-full sm:w-[min(560px,100vw)] sm:rounded-none sm:rounded-l-2xl sm:shadow-[-24px_0_64px_-24px_rgba(15,20,17,0.35)]"
      >
        <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[#d9ddd8] sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3 border-b border-[#ebedea] px-4 py-3.5 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[16px] font-semibold text-[#1a201c] sm:text-[17px]">
              {title}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[#616a64]">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#616a64] hover:bg-[#f1f3f0]" aria-label="Close">
            <Icon.Close className="h-4 w-4" />
          </button>
        </div>
        {body}
      </div>
    </div>,
    document.body
  );
}
