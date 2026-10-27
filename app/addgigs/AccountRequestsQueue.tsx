"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { REVIEW_TARGET_HOURS, RISK_LABEL, REQUEST_STATUS_LABEL, type AccountRequestRisk, type AdminAccountRequest, type RequestCheck } from "@/lib/accountRequests";
import { accountPlatformFor } from "@/lib/accountSetup";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { isCurrentAdminCacheIdentity } from "@/lib/adminCacheIdentity";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import PlatformGlyph from "../dashboard/PlatformGlyph";
import { Banner, ConfirmDialog, CopyButton, ICONS, Icon, Spinner, StatusChip, btnDanger, btnGhost, btnPrimary, cardClass, fieldClass, formatDateTime, formatRelative, type Tone } from "./adminUi";

// Admin: verification queue for additional accounts creators asked to link. Requests with proven ownership and no
// risk signals are grouped as "Ready to approve" so the queue can be cleared quickly; everything else shows why.

type Filter = "review" | "creator" | "decided";
type Decision = "approve" | "changes" | "reject";
type RequestData = { requests: AdminAccountRequest[]; unavailable: boolean };
const validRequests = (value: unknown): value is RequestData => {
  const data = value as RequestData | null;
  return !!data && typeof data.unavailable === "boolean" && Array.isArray(data.requests)
    && data.requests.every(row => !!row && typeof row.id === "string" && typeof row.handle === "string" && Array.isArray(row.checks) && ["low", "medium", "high", "unknown"].includes(row.risk));
};

const RISK_TONE: Record<AccountRequestRisk, Tone> = { low: "success", medium: "warning", high: "danger", unknown: "neutral" };
const CHECK_TONE: Record<RequestCheck["status"], string> = { pass: "text-[#226b40]", warn: "text-[#9a5b00]", fail: "text-[#b42318]", pending: "text-[#8a928c]" };
const CHECK_ICON: Record<RequestCheck["status"], string> = { pass: ICONS.check, warn: ICONS.alert, fail: ICONS.x, pending: ICONS.clock };

const CHANGE_TEMPLATES = [
  (r: AdminAccountRequest) => `Add ${r.verifyCode} to the bio of @${r.handle}, then tap "Check again".`,
  (r: AdminAccountRequest) => `We couldn't read the bio of @${r.handle}. Make the account public for a moment, then tap "Check again".`,
  () => "The profile link opens a different account. Paste the link from the account's own profile page.",
];
const REJECT_TEMPLATES = [
  () => "This account isn't new or isn't controlled by you.",
  () => "This account is already used for other work.",
  () => "The account doesn't meet the gig's requirements.",
];

const hoursWaiting = (r: AdminAccountRequest, now: number) => (now - Date.parse(r.submittedAt)) / 3_600_000;
const isReady = (r: AdminAccountRequest) => r.status === "pending" && r.risk === "low";

async function adminPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/admin/social-accounts/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || "The change couldn't be saved.");
  return payload as T;
}

function waitLabel(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function RequestRow({
  request,
  now,
  expanded,
  onToggle,
  onChanged,
  onNotice,
}: {
  request: AdminAccountRequest;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onChanged: (next: AdminAccountRequest) => void;
  onNotice: (notice: { tone: "success" | "danger"; text: string }) => void;
}) {
  const platform = accountPlatformFor(request.platform);
  const open = request.status === "pending" || request.status === "changes_requested";
  const hours = hoursWaiting(request, now);
  const overdue = request.status === "pending" && hours >= REVIEW_TARGET_HOURS;
  const owned = request.checks.find((c) => c.id === "ownership")?.status === "pass";
  const missing = request.checks.some(check => check.id === "profile" && check.status === "fail");
  const issues = request.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [note, setNote] = useState("");

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (e) {
      onNotice({ tone: "danger", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };
  const reveal = () => run("reveal", async () => setPassword((await adminPost<{ password: string }>({ action: "reveal", id: request.id })).password));
  const recheck = () => run("recheck", async () => {
    const { request: next } = await adminPost<{ request: AdminAccountRequest }>({ action: "recheck", id: request.id });
    onChanged({ ...request, ...next });
  });
  const decide = (decision: Decision) =>
    run(decision, async () => {
      const { request: next, mailStatus } = await adminPost<{ request: AdminAccountRequest; mailStatus?: { sent: boolean } }>({ action: "review", id: request.id, decision, note: note.trim() || undefined });
      onChanged({ ...request, ...next });
      setDialog(null);
      setNote("");
      const verb = decision === "approve" ? "linked" : decision === "changes" ? "sent back for changes" : "rejected";
      onNotice({ tone: "success", text: `@${request.handle} ${verb}.${mailStatus && !mailStatus.sent ? " The email to the creator couldn't be sent." : ""}` });
    });

  const templates = dialog === "changes" ? CHANGE_TEMPLATES : dialog === "reject" ? REJECT_TEMPLATES : [];

  return (
    <li className={`transition ${expanded ? "bg-[#fafbf9]" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[#fafbf9] sm:px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#eef1ed] text-[#2b5d4a]">
          <PlatformGlyph platform={platform} className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">@{request.handle}</span>
            <StatusChip tone={RISK_TONE[request.risk]} label={RISK_LABEL[request.risk]} />
            {request.revision > 1 ? <span className="text-[11px] text-[#8a928c]">Revision {request.revision}</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-[#7a827c]">
            {request.workerName ?? request.workerCode} · {request.gigTitle ?? request.gigId}
            {issues.length ? <span className="text-[#9a5b00]"> · {issues.map((c) => c.label.toLowerCase()).join(", ")}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {open ? (
            <>
              <span className={`block text-[12.5px] font-semibold tabular-nums ${overdue ? "text-[#b42318]" : "text-[#3b443e]"}`}>{waitLabel(hours)}</span>
              <span className="block text-[10.5px] text-[#8a928c]">{request.status === "pending" ? "waiting" : "on creator"}</span>
            </>
          ) : (
            <StatusChip status={request.status === "approved" ? "approved" : "rejected"} label={REQUEST_STATUS_LABEL[request.status]} />
          )}
        </span>
        <Icon d={expanded ? ICONS.chevronDown : ICONS.chevronRight} className="h-4 w-4 shrink-0 text-[#a3aaa4]" />
      </button>

      {expanded ? (
        <div className="space-y-3 px-3.5 pb-4 sm:px-4">
          <div className="grid gap-3 md:grid-cols-2">
            {/* Automated checks */}
            <div className="rounded-[12px] border border-[#e3e5e1] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-[#3b443e]">Automated checks</p>
                {open ? (
                  <button type="button" className="text-[11.5px] font-semibold text-[#2b5d4a] hover:underline disabled:opacity-50" onClick={() => void recheck()} disabled={busy !== null}>
                    {busy === "recheck" ? "Checking…" : "Run again"}
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-1.5">
                {request.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-2 text-[12px]">
                    <Icon d={CHECK_ICON[check.status]} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${CHECK_TONE[check.status]}`} />
                    <span className="min-w-0">
                      <span className="font-semibold text-[#1a201c]">{check.label}</span>
                      <span className="text-[#616a64]"> · {check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-[#8a928c]">
                Code <span className="font-mono font-semibold text-[#3b443e]">{request.verifyCode}</span>
                {request.checkedAt ? ` · checked ${formatRelative(request.checkedAt)}` : ""}
              </p>
            </div>

            {/* Account and context */}
            <div className="rounded-[12px] border border-[#e3e5e1] bg-white p-3">
              <p className="text-[12px] font-semibold text-[#3b443e]">Account</p>
              <dl className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#7a827c]">Profile</dt>
                  <dd className="min-w-0 truncate">
                    <a href={request.profileUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-[#1f5fa8] hover:underline">
                      Open on {platform.label} <Icon d={ICONS.open} className="h-3 w-3" />
                    </a>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#7a827c]">Verification</dt>
                  <dd className={`min-w-0 truncate font-medium ${owned ? "text-[#226b40]" : "text-[#9a5b00]"}`}>{owned ? "Code found in bio" : "Code not found yet"}</dd>
                </div>
                {/* Older requests were sent with a login; new ones are verified by the bio code only. */}
                {request.email ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#7a827c]">Email</dt>
                  <dd className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-[#1a201c]">{request.email}</span>
                    <CopyButton value={request.email} />
                  </dd>
                </div>
                ) : null}
                {request.hasPassword ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#7a827c]">Password</dt>
                  <dd className="flex min-w-0 items-center gap-1.5">
                    {password !== null ? (
                      <>
                        <span className="truncate font-mono text-[#1a201c]">{password}</span>
                        <CopyButton value={password} />
                      </>
                    ) : (
                      <button type="button" className="font-semibold text-[#2b5d4a] hover:underline disabled:opacity-50" onClick={() => void reveal()} disabled={busy !== null}>
                        {busy === "reveal" ? "Revealing…" : "Reveal (logged)"}
                      </button>
                    )}
                  </dd>
                </div>
                ) : null}
                {request.phone ? (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-[#7a827c]">Phone</dt>
                    <dd className="font-medium text-[#1a201c]">{request.phone}</dd>
                  </div>
                ) : null}
              </dl>
              {request.notes ? <p className="mt-2 rounded-[8px] bg-[#f7f8f6] px-2.5 py-1.5 text-[12px] text-[#3b443e]">“{request.notes}”</p> : null}
              <p className="mt-2 text-[11px] text-[#8a928c]">
                Creator has {request.creatorAccounts} linked {request.creatorAccounts === 1 ? "account" : "accounts"}
                {request.sourceHandle ? ` · requested from @${request.sourceHandle}` : ""} · submitted {formatDateTime(request.submittedAt)}
              </p>
            </div>
          </div>

          {request.reviewNote && !open ? <p className="text-[12px] text-[#616a64]">Note to creator: {request.reviewNote}</p> : null}

          {open ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11.5px] text-[#7a827c]">
                {owned ? "Ownership is proven. Open the profile to confirm the account is fresh and unused, then approve." : "Ownership isn't proven yet. Open the profile and look for the code in the bio, or ask the creator to add it."}
              </p>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" className={btnDanger} onClick={() => setDialog("reject")} disabled={busy !== null}>
                  Reject
                </button>
                <button type="button" className={btnGhost} onClick={() => setDialog("changes")} disabled={busy !== null}>
                  Request changes
                </button>
                <button type="button" className={btnPrimary} onClick={() => (isReady(request) ? void decide("approve") : setDialog("approve"))} disabled={busy !== null || missing} title={missing ? "The creator must correct this profile before it can be linked." : undefined}>
                  {busy === "approve" ? <Spinner /> : <Icon d={ICONS.check} />}
                  Approve and link
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {dialog ? (
        <ConfirmDialog
          title={dialog === "approve" ? `Link @${request.handle}?` : dialog === "changes" ? "Ask for changes" : `Reject @${request.handle}?`}
          body={
            dialog === "approve"
              ? issues.length || !owned
                ? `Automated checks flagged: ${[...issues.map((c) => c.label), ...(owned ? [] : ["ownership not proven"])].join(", ")}. Only approve if you verified the account yourself.`
                : "The account is linked to the creator and starts earning at the gig's rate."
              : dialog === "changes"
                ? "The creator gets an email and can fix the request."
                : "The creator gets an email. They can't submit this account again."
          }
          confirmLabel={dialog === "approve" ? "Approve and link" : dialog === "changes" ? "Send to creator" : "Reject"}
          tone={dialog === "reject" ? "danger" : "primary"}
          icon={dialog === "approve" ? ICONS.check : dialog === "changes" ? ICONS.send : ICONS.x}
          busy={busy === dialog}
          onCancel={() => setDialog(null)}
          onConfirm={() => void decide(dialog)}
        >
          {dialog !== "approve" ? (
            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {templates.map((template, index) => {
                  const text = template(request);
                  return (
                    <button key={index} type="button" onClick={() => setNote(text)} className="rounded-full border border-[#e3e5e1] px-2.5 py-1 text-left text-[11.5px] text-[#3b443e] hover:bg-[#f7f8f6]">
                      {text.length > 52 ? `${text.slice(0, 50)}…` : text}
                    </button>
                  );
                })}
              </div>
              <label className="block">
                <span className="sr-only">Note to the creator</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Note to the creator (required)" className={`${fieldClass} border-[#d9ddd8] py-2`} />
              </label>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </li>
  );
}

export default function AccountRequestsQueue({ adminId, onLinked }: { adminId: string; onLinked?: () => void }) {
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(async (signal: AbortSignal): Promise<RequestData> => {
    const res = await fetch("/api/admin/social-accounts/requests", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const payload = await res.json().catch(() => null);
    if ((res.status === 401 || res.status === 403) && !signal.aborted && isCurrentAdminCacheIdentity(adminId)) window.dispatchEvent(new Event("admin-auth-invalidated"));
    if (!res.ok || !Array.isArray(payload?.requests) || payload.requests.some((row: Partial<AdminAccountRequest> | null) => !row || typeof row.id !== "string" || typeof row.handle !== "string" || !Array.isArray(row.checks) || !["low", "medium", "high", "unknown"].includes(row.risk ?? ""))) {
      throw new Error(payload?.error || "Account requests couldn't be loaded.");
    }
    return { requests: payload.requests, unavailable: payload.unavailable === true };
  }, [adminId]);
  // Requests contain creator contact details; reuse them in memory, never in browser storage.
  const resource = useAdminCachedResource<RequestData>({ scope: adminId, key: "account-requests", load: read, ttlMs: 10_000, maxAgeMs: 5 * 60_000, persist: false, validate: validRequests });
  const { refresh, update } = resource;
  const requests = resource.data?.requests ?? null;
  const unavailable = resource.data?.unavailable === true;
  const error = resource.error?.message ?? null;
  const poll = useCallback(async () => {
    if (!navigator.onLine) return;
    await refresh({ force: false });
    setNow(Date.now());
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      // Header refresh also emits an admin-live event; both signals share one new read.
      timer = setTimeout(() => { timer = undefined; void refresh({ afterCurrent: true }); }, 100);
    };
    // Instant refresh when a creator submits, edits or withdraws a request (admin live channel).
    const onLive = (event: Event) => {
      const kinds = (event as CustomEvent<string[] | null>).detail;
      if ((!kinds || kinds.includes("social_account_requests")) && !document.hidden && navigator.onLine) schedule();
    };
    const manual = schedule;
    window.addEventListener("admin-live", onLive);
    window.addEventListener("admin-refresh", manual);
    window.addEventListener("admin-linked-accounts-refresh", manual);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("admin-live", onLive);
      window.removeEventListener("admin-refresh", manual);
      window.removeEventListener("admin-linked-accounts-refresh", manual);
    };
  }, [refresh]);
  // The review queue is time-sensitive; refresh often while the tab is visible.
  useVisibleRefresh(poll, adminId ? 10_000 : null);

  const groups = useMemo(() => {
    const list = requests ?? [];
    const review = list.filter((r) => r.status === "pending").sort((a, b) => Number(isReady(b)) - Number(isReady(a)) || Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
    return {
      review,
      creator: list.filter((r) => r.status === "changes_requested"),
      decided: list.filter((r) => r.status === "approved" || r.status === "rejected"),
    };
  }, [requests]);
  const stats = useMemo(() => {
    const waits = groups.review.map((r) => hoursWaiting(r, now));
    return {
      ready: groups.review.filter(isReady).length,
      overdue: waits.filter((h) => h >= REVIEW_TARGET_HOURS).length,
      oldest: waits.length ? Math.max(...waits) : 0,
    };
  }, [groups, now]);

  if (unavailable) return <Banner tone="danger">Account requests need the latest database migration. Run npm run db:migrate, then refresh.</Banner>;
  if (requests && !requests.length && !error) return null;

  const visible = groups[filter];
  const replace = (next: AdminAccountRequest) => {
    // Confirmed decisions cancel older reads, so an in-flight poll cannot restore the previous status.
    update(previous => ({ requests: (previous?.requests ?? requests ?? []).map(r => r.id === next.id ? next : r), unavailable: false }));
    if (next.status === "approved") onLinked?.();
  };

  return (
    <section className={`${cardClass} overflow-hidden`} aria-labelledby="account-requests-title">
      <div className="flex flex-col gap-3 border-b border-[#eef0ec] p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0">
          <h2 id="account-requests-title" className="text-[15px] font-semibold text-[#1a201c]">
            Additional account requests
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#616a64]">
            {groups.review.length
              ? `${groups.review.length} to review · ${stats.ready} ready to approve${stats.overdue ? ` · ${stats.overdue} over ${REVIEW_TARGET_HOURS}h` : ""} · oldest ${waitLabel(stats.oldest)}`
              : "Queue is clear. New requests appear here within seconds."}
          </p>
        </div>
        <div className="dashboard-chip-scroller flex gap-1 overflow-x-auto">
          {(
            [
              { id: "review", label: "To review" },
              { id: "creator", label: "Waiting on creator" },
              { id: "decided", label: "Decided" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold transition ${filter === f.id ? "bg-[#1f2b24] text-white" : "text-[#4b544e] hover:bg-[#f1f3f0]"}`}
            >
              {f.label}
              <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${filter === f.id ? "bg-white/20" : f.id === "review" && groups.review.length ? "bg-[#fdf1dc] text-[#9a5b00]" : "bg-[#eef0ed]"}`}>
                {groups[f.id].length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <div className="px-3.5 pt-3 sm:px-4">
          <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Banner>
        </div>
      ) : null}
      {error ? (
        <div className="px-3.5 pt-3 sm:px-4">
          <Banner tone="danger">{error} <button type="button" onClick={() => void refresh()} className="font-semibold underline underline-offset-2">Try again</button></Banner>
        </div>
      ) : null}

      {requests === null && !error ? (
        <div className="grid place-items-center py-8">
          <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" />
        </div>
      ) : requests === null ? null : visible.length ? (
        <ul className="divide-y divide-[#eef0ec]">
          {filter === "review" && stats.ready ? (
            <li className="bg-[#f4f9f2] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#226b40]">Ready to approve · ownership proven, no flags</li>
          ) : null}
          {visible.map((request, index) => (
            <FragmentWithDivider key={request.id} show={filter === "review" && stats.ready > 0 && index === stats.ready && index < visible.length}>
              <RequestRow
                request={request}
                now={now}
                expanded={expanded === request.id}
                onToggle={() => setExpanded((id) => (id === request.id ? null : request.id))}
                onChanged={replace}
                onNotice={setNotice}
              />
            </FragmentWithDivider>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-[12.5px] text-[#7a827c]">{filter === "review" ? "Nothing waiting for review." : filter === "creator" ? "No requests are waiting on creators." : "No decisions yet."}</p>
      )}
    </section>
  );
}

function FragmentWithDivider({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <>
      {show ? <li className="bg-[#fafbf9] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#7a827c]">Needs a closer look</li> : null}
      {children}
    </>
  );
}
