"use client";
import { apiFetch as fetch } from "@/lib/api/client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Icon, PageHeader, buttonClassName, cx } from "@/app/dashboard/dashboardUi";
import { supabase } from "@/lib/supabaseClient";
import { buildPayoutReadiness, describeKycStatus, type KycStatus } from "@/lib/payoutReadiness";
import { formatAmount as formatINR } from "@/lib/money";
import {
  KYC_FREE_WITHDRAWAL_LIMIT_INR,
  MANUAL_WITHDRAWAL_INTERVAL_DAYS,
  MIN_PAYOUT_REQUEST_INR,
  autoWithdrawalDay,
  nextAutoWithdrawalAt,
  nextManualWithdrawalAt,
  payoutKycRequired,
} from "@/lib/payoutPolicy";
import { useSocialAccounts } from "@/lib/useSocialAccounts";
import { usePayoutIdentity } from "@/lib/usePayoutIdentity";
import { summarizePayoutBatches } from "@/lib/creatorEarnings";
import { CREATOR_HOME_HREF } from "@/lib/routes";
import type { KycProfile } from "./KycPanel";
import { KycRow } from "./KycStatusRow";
import PayoutMethodCard, { hasPayoutMethod, payoutMethodLabel, type PayoutMethodConfig } from "./PayoutMethodCard";
import PayoutsSkeleton, { PAYOUT_CARD_CLASS, PAYOUT_CONTAINER_CLASS, PAYOUT_GRID_CLASS, PAYOUT_MAIN_CLASS, PayoutHistoryLoading, Shimmer, WithdrawalScheduleLoading } from "./PayoutLoading";
import DeferredPayoutContent from "./DeferredPayoutContent";

const KycSheet = dynamic(() => import("./KycPanel").then(module => module.KycSheet), {
  loading: () => <div role="status" className="fixed inset-0 z-50 grid place-items-center bg-[#15251d]/30 p-5"><div className="rounded-xl bg-white px-6 py-5 text-sm font-semibold text-[#20352c]">Opening identity verification…</div></div>,
});
const PayoutHistoryCard = dynamic(() => import("./PayoutHistoryCard"), { loading: () => <PayoutHistoryLoading rows={1} /> });

// Matches the server: weekly payouts pick a weekday, monthly payouts a day of the month (1–28).
type UpiSchedule = "Weekly" | "Monthly";
type PayoutDay = string;
type PayoutBatchStatus = "Draft" | "Processing" | "Paid" | "Failed";

type WorkerMetrics = {
  counts?: {
    total?: number;
    approved?: number;
    submitted?: number;
    inProgress?: number;
  };
  money?: {
    earnings?: number;
    pending?: number;
    available?: number;
    committed?: number;
    /** The part of the balance a withdrawal without KYC can include. */
  };
  sla?: {
    met?: number;
    breached?: number;
  };
};

// Payout method (bank account or UPI ID, see PayoutMethodCard) plus the auto-withdrawal settings.
type UpiConfig = PayoutMethodConfig & {
  payoutSchedule: UpiSchedule;
  payoutDay: PayoutDay;
  /** Monthly auto-withdrawal, switched on by the creator; it only acts on dates from `autoWithdrawSince`. */
  autoWithdraw?: boolean;
  autoWithdrawSince?: string;
};

type KycResponse = {
  status?: KycStatus;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  profile?: KycProfile | null;
};

type PayoutItem = {
  id: string;
  workItemId: string;
  workItemTitle?: string;
  reelUrl?: string;
  workerId: string;
  handle: string;
  amountINR: number;
  status: string;
  reason?: string;
};

type PayoutBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: PayoutBatchStatus;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: "UPI" | "Bank";
  items: PayoutItem[];
  notes: string[];
  paymentReference?: string;
  /** "auto" for the monthly automatic withdrawal; manual requests are limited to one every 7 days. */
  origin?: "manual" | "auto";
  /** Where it was sent: a UPI ID or a masked bank account. */
  payTo?: string;
};

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
/** "Auto-withdraws on the 5th of every month". */
function scheduleLabel(schedule: string, day: string) {
  return `Auto-withdraws on the ${ordinal(autoWithdrawalDay(schedule, day))} of every month`;
}
const IST = "Asia/Kolkata";
const shortDate = (value: Date) => value.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST });
const shortDateTime = (value: Date) =>
  value.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST });
/** "in 3d 4h" / "in 5h 20m" / "in 12m". */
function countdown(to: Date, now: number) {
  const minutes = Math.max(1, Math.ceil((to.getTime() - now) / 60_000));
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  return days ? `in ${days}d ${hours}h` : hours ? `in ${hours}h ${mins}m` : `in ${mins}m`;
}
const istMonth = (value: number) => new Date(value + 5.5 * 3_600_000).toISOString().slice(0, 7);

function batchTotal(batch: PayoutBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

type PayoutSnapshot = {
  metrics: WorkerMetrics | null;
  batches: PayoutBatch[];
  upi: UpiConfig | null;
  kyc: { status: KycStatus; reason: string | null };
  at: string;
};

/** Reject corrupted device data and unreadable API responses before rendering financial history. */
function isPayoutBatch(value: unknown): value is PayoutBatch {
  if (!value || typeof value !== "object") return false;
  const batch = value as PayoutBatch;
  return typeof batch.id === "string" && typeof batch.cycleLabel === "string" && typeof batch.createdAt === "string" &&
    typeof batch.periodStart === "string" && typeof batch.periodEnd === "string" &&
    ["Draft", "Processing", "Paid", "Failed"].includes(batch.status) && ["UPI", "Bank"].includes(batch.method) &&
    Array.isArray(batch.notes) && batch.notes.every(note => typeof note === "string") &&
    Array.isArray(batch.items) && batch.items.every(item => item && typeof item.id === "string" &&
      typeof item.amountINR === "number" && Number.isFinite(item.amountINR) && item.amountINR >= 0);
}

/** Auth locks and stalled connections must resolve to retry controls rather than a permanent skeleton. */
async function payoutSession() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Session check timed out. Refresh to try again.")), 20_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

const SNAPSHOT_KEY = (userId: string) => `reelencer:payouts:v2:${userId}`;
/** Last good data for this tab session, so a return visit paints instantly and then refreshes in place. */
function readSnapshot(userId: string): PayoutSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(SNAPSHOT_KEY(userId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as PayoutSnapshot;
    const age = Date.now() - Date.parse(snapshot.at);
    if (!Number.isFinite(age) || age < 0 || age > 86_400_000 || !Array.isArray(snapshot.batches) || !snapshot.batches.every(isPayoutBatch) || !snapshot.kyc || !["none", "pending", "approved", "rejected"].includes(snapshot.kyc.status) || typeof snapshot.metrics?.money?.available !== "number" || !Number.isFinite(snapshot.metrics.money.available) || snapshot.metrics.money.available < 0) return null;
    return snapshot;
  } catch {
    return null;
  }
}
function writeSnapshot(userId: string, snapshot: PayoutSnapshot) {
  try {
    window.sessionStorage.setItem(SNAPSHOT_KEY(userId), JSON.stringify(snapshot));
  } catch {
    /* Storage full or blocked: the page still works, just without the instant repaint. */
  }
}

const HISTORY_PAGE = 4;

type SeenState = { kyc: KycStatus; upiVerified: boolean; wallet: number; batches: Record<string, PayoutBatchStatus> };
const seenFrom = (s: { metrics: WorkerMetrics | null; batches: PayoutBatch[]; upi: UpiConfig | null; kyc: { status: KycStatus } }): SeenState => ({
  kyc: s.kyc.status,
  upiVerified: Boolean(s.upi?.verified),
  wallet: Number(s.metrics?.money?.available ?? s.metrics?.money?.earnings ?? 0),
  batches: Object.fromEntries(s.batches.map((b) => [b.id, b.status])),
});

/** The single most important thing that changed since the last read (most consequential first). */
function describeChange(prev: SeenState, next: SeenState, batches: PayoutBatch[], kycReason: string | null): { tone: "success" | "danger"; text: string } | null {
  for (const batch of batches) {
    const before = prev.batches[batch.id];
    if (!before && batch.origin === "auto") {
      return { tone: "success", text: `Your monthly auto-withdrawal of ${formatINR(batchTotal(batch))} was requested. The team reviews it next.` };
    }
    if (!before || before === batch.status) continue;
    const amount = formatINR(batchTotal(batch));
    if (batch.status === "Paid") return { tone: "success", text: `${amount} was paid to your UPI.` };
    if (batch.status === "Failed") return { tone: "danger", text: `Your ${amount} payout wasn't approved${batch.notes?.length ? ` (${batch.notes[batch.notes.length - 1]})` : ""}. The full ${amount} is back in your wallet.` };
    if (batch.status === "Processing") return { tone: "success", text: `Your ${amount} payout was approved and is on its way.` };
  }
  if (prev.kyc !== next.kyc) {
    if (next.kyc === "approved") return { tone: "success", text: "Your identity verification (KYC) was approved." };
    if (next.kyc === "rejected") return { tone: "danger", text: `Your KYC needs a correction${kycReason ? `: ${kycReason}` : "."}` };
  }
  if (!prev.upiVerified && next.upiVerified) return { tone: "success", text: "Your payout UPI was verified." };
  if (next.wallet > prev.wallet + 0.004) return { tone: "success", text: `${formatINR(next.wallet - prev.wallet)} was added to your wallet.` };
  return null;
}

export default function PayoutsPage() {
  const { state, retry } = usePayoutIdentity();
  if (state.state === "error") return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f4f1] p-5">
      <div role="alert" className="w-full max-w-md rounded-xl border border-[#e3e5e1] bg-white p-6 text-[#1a201c]">
        <h1 className="text-xl font-semibold">Payouts unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[#616a64]">{state.message}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className="rounded-xl bg-[#1f2b24] px-4 py-2.5 text-sm font-semibold text-white">Try again</button>
          <Link href="/dashboard?section=wallet" className="rounded-xl border border-[#e3e5e1] px-4 py-2.5 text-sm font-semibold">Back to Wallet</Link>
        </div>
      </div>
    </main>
  );
  if (state.state !== "ready") return <PayoutsSkeleton />;
  return <PayoutsWorkspace key={`${state.userId}:${state.workerId}`} userId={state.userId} workerId={state.workerId} />;
}

function PayoutsWorkspace({ userId, workerId }: { userId: string; workerId: string }) {
  // The workspace mounts only after /api/me verifies the owner. Restore their display data on its first paint.
  const [snapshot] = useState(() => readSnapshot(userId));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(snapshot?.metrics ?? null);
  const [upi, setUpi] = useState<UpiConfig | null>(snapshot?.upi ?? null);
  const [kycStatus, setKycStatus] = useState<KycStatus>(snapshot?.kyc.status ?? "none");
  const [kycRejectionReason, setKycRejectionReason] = useState<string | null>(snapshot?.kyc.reason ?? null);
  const [kycDetails, setKycDetails] = useState<{ submittedAt?: string | null; reviewedAt?: string | null; profile?: KycProfile | null }>({});
  const [kycSheetOpen, setKycSheetOpen] = useState(false);
  const [batches, setBatches] = useState<PayoutBatch[]>(snapshot?.batches ?? []);
  const [requesting, setRequesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [upiEditorOpen, setUpiEditorOpen] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const autoSwitchRef = useRef<HTMLButtonElement | null>(null);
  const loadInFlightRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  // Which sections have real data (fresh or from this session's snapshot); each renders as soon as its own is in.
  const [ready, setReady] = useState({ metrics: !!snapshot, batches: !!snapshot, upi: !!snapshot, kyc: !!snapshot });
  const [fromSnapshot, setFromSnapshot] = useState(!!snapshot);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [historyRequested, setHistoryRequested] = useState(false);
  const [verified, setVerified] = useState({ metrics: false, batches: false, upi: false, kyc: false });
  const [failures, setFailures] = useState({ metrics: false, batches: false, upi: false, kyc: false });
  // What the creator last saw (this session or their previous visit), to announce what changed since.
  const seenRef = useRef<SeenState | null>(snapshot ? seenFrom(snapshot) : null);
  // Briefly highlights a card when it changes in real time (e.g. UPI verified by the team).
  const [flash, setFlash] = useState<"upi" | "kyc" | null>(null);
  const flashTimer = useRef<number | null>(null);
  const flashSection = useCallback((key: "upi" | "kyc") => {
    setFlash(key);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4000);
  }, []);
  const upiSectionRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const socialAccounts = useSocialAccounts(true, userId);

  const loadPayoutData = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const current = () => !controller.signal.aborted && loadControllerRef.current === controller;
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    const issues: string[] = [];
    const fresh: Partial<PayoutSnapshot> = {};
    const mark = (key: keyof typeof ready) => setReady((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    const settled = (key: keyof typeof ready, success: boolean) => {
      if (!current()) return;
      mark(key);
      setVerified(prev => ({ ...prev, [key]: success }));
      setFailures(prev => ({ ...prev, [key]: !success }));
    };
    const read = (url: string, headers?: HeadersInit) => fetch(url, { headers, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });

    try {
      const { data } = await payoutSession();
      if (!current()) return;
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again to view payouts.");
      const authHeaders = { Authorization: `Bearer ${token}` };

      await Promise.all([
        // Earnings metrics.
        (async () => {
          try {
            const res = await read(`/api/metrics/worker?workerId=${encodeURIComponent(workerId)}`, authHeaders);
            if (!res.ok) throw new Error();
            const json = (await res.json()) as WorkerMetrics;
            if (!current()) return;
            if (typeof json?.money?.available !== "number" || !Number.isFinite(json.money.available) || json.money.available < 0) throw new Error();
            fresh.metrics = json;
            setMetrics(json);
            settled("metrics", true);
          } catch {
            issues.push("wallet balance");
            settled("metrics", false);
          }
        })(),
        // Payout cycles.
        (async () => {
          try {
            const res = await read(`/api/payoutbatches?workerId=${encodeURIComponent(workerId)}`, authHeaders);
            if (!res.ok) throw new Error();
            const json = await res.json();
            if (!current()) return;
            if (!Array.isArray(json) || !json.every(isPayoutBatch)) throw new Error();
            fresh.batches = json;
            setBatches(fresh.batches);
          } catch {
            issues.push("payout batches");
          } finally {
            settled("batches", Boolean(fresh.batches));
          }
        })(),
        // UPI.
        (async () => {
          try {
            if (!authHeaders) throw new Error("Not authenticated");
            const res = await read("/api/upi", authHeaders);
            if (!res.ok) throw new Error();
            fresh.upi = (await res.json()) ?? null;
            if (!current()) return;
            setUpi(fresh.upi ?? null);
          } catch {
            issues.push("UPI status");
          } finally {
            settled("upi", fresh.upi !== undefined);
          }
        })(),
        // KYC.
        (async () => {
          try {
            if (!authHeaders) throw new Error("Not authenticated");
            const res = await read("/api/kyc", authHeaders);
            if (!res.ok) throw new Error();
            const json = (await res.json().catch(() => ({}))) as KycResponse;
            if (!current()) return;
            if (!json.status || !["none", "pending", "approved", "rejected"].includes(json.status)) throw new Error();
            fresh.kyc = { status: (json.status ?? "none") as KycStatus, reason: json.rejectionReason ?? null };
            setKycStatus(fresh.kyc.status);
            setKycRejectionReason(fresh.kyc.reason);
            setKycDetails({ submittedAt: json.submittedAt ?? null, reviewedAt: json.reviewedAt ?? null, profile: json.profile ?? null });
          } catch {
            issues.push("KYC status");
          } finally {
            settled("kyc", Boolean(fresh.kyc));
          }
        })(),
      ]);

      if (!current()) return;
      if (!issues.length) {
        setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        setFromSnapshot(false);
      }
      if (issues.length > 0) setError(`Some payout data could not be refreshed: ${issues.join(", ")}.`);
      // Announce the most important change since the last complete read.
      if (!issues.length && fresh.metrics && fresh.batches && fresh.kyc) {
        const next = seenFrom({ metrics: fresh.metrics, batches: fresh.batches, upi: fresh.upi ?? null, kyc: fresh.kyc });
        const change = seenRef.current ? describeChange(seenRef.current, next, fresh.batches, fresh.kyc.reason) : null;
        if (change) setNotice(change);
        if (seenRef.current && seenRef.current.upiVerified !== next.upiVerified) flashSection("upi");
        if (seenRef.current && seenRef.current.kyc !== next.kyc) flashSection("kyc");
        seenRef.current = next;
      }
      // Only cache a complete, successful read.
      if (!issues.length && fresh.metrics && fresh.batches && fresh.kyc) {
        writeSnapshot(userId, { metrics: fresh.metrics, batches: fresh.batches, upi: fresh.upi ?? null, kyc: fresh.kyc, at: new Date().toISOString() });
      }
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "Unable to load payout data.");
      setReady({ metrics: true, batches: true, upi: true, kyc: true });
      setVerified({ metrics: false, batches: false, upi: false, kyc: false });
      setFailures({ metrics: true, batches: true, upi: true, kyc: true });
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        loadInFlightRef.current = false;
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }
  }, [userId, workerId, flashSection]);

  useEffect(() => {
    void loadPayoutData("initial");
    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      loadInFlightRef.current = false;
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [loadPayoutData]);

  // Live updates: the server broadcasts a content-free "changed" signal on this user's private payouts topic
  // whenever their cycles, wallet credits, UPI or KYC change (migration 202610110001). We then re-read through the
  // authenticated API. Polling stays as a slower safety net and backs off while the live channel is healthy.
  const [liveState, setLiveState] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let live = false;
    const scheduleRefresh = () => {
      if (refreshTimer || disposed) return;
      // Coalesce bursts (a payout touches the cycle and every item in it).
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!document.hidden) void loadPayoutData("refresh");
      }, 400);
    };
    const connect = async () => {
      try {
        const { data } = await payoutSession();
        const session = data.session;
        if (disposed || !session) return;
        await supabase.realtime.setAuth(session.access_token);
        if (disposed) return;
        channel = supabase
          .channel(`payouts:${session.user.id}`, { config: { private: true } })
          .on("broadcast", { event: "changed" }, scheduleRefresh)
          .subscribe((status) => {
            if (disposed) return;
            live = status === "SUBSCRIBED";
            setLiveState(live ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
            // Catch anything that changed while we were connecting.
            if (live) scheduleRefresh();
          });
      } catch {
        if (!disposed) setLiveState("offline");
      }
    };
    void connect();

    const onWake = () => {
      if (!document.hidden && navigator.onLine) scheduleRefresh();
    };
    const onOffline = () => setLiveState("offline");
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("offline", onOffline);
    // Claims and reel reviews arrive on the accounts channel; they change the money strip too.
    window.addEventListener("view-payout-claims-updated", onWake);
    window.addEventListener("social-accounts-refreshed", onWake);

    // Safety net: every 10s without a live channel, every 60s with one.
    let ticks = 0;
    const intervalId = window.setInterval(() => {
      ticks += 1;
      if (document.hidden || !navigator.onLine) return;
      if (!live || ticks % 6 === 0) void loadPayoutData("refresh");
    }, 10_000);

    return () => {
      disposed = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("view-payout-claims-updated", onWake);
      window.removeEventListener("social-accounts-refreshed", onWake);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadPayoutData, workerId]);

  // Deep link from other pages (e.g. an Email Creator gig): /payouts?verify=kyc opens the KYC sheet once KYC is known.
  useEffect(() => {
    if (!ready.kyc || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("verify") !== "kyc") return;
    url.searchParams.delete("verify");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (kycStatus !== "approved") queueMicrotask(() => setKycSheetOpen(true));
  }, [ready.kyc, kycStatus]);

  // Ticks once a minute so the weekly limit unlocks and countdowns stay current without a refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const lastManualAt = useMemo(
    () => batches.filter((batch) => batch.origin !== "auto" && batch.status !== "Failed").map((batch) => batch.createdAt).sort().at(-1) ?? null,
    [batches]
  );
  const nextManualAt = useMemo(() => nextManualWithdrawalAt(lastManualAt, now), [lastManualAt, now]);
  const autoDay = autoWithdrawalDay(upi?.payoutSchedule, upi?.payoutDay);
  const autoDoneThisMonth = batches.some((batch) => batch.origin === "auto" && istMonth(Date.parse(batch.createdAt)) === istMonth(now));
  const autoOn = upi?.autoWithdraw === true;
  const nextAutoAt = useMemo(() => nextAutoWithdrawalAt(autoDay, autoDoneThisMonth, now, upi?.autoWithdrawSince), [autoDay, autoDoneThisMonth, now, upi?.autoWithdrawSince]);
  const autoIsToday = shortDate(nextAutoAt) === shortDate(new Date(now));

  const approvedEarnings = metrics?.money?.available ?? 0;
  // Everything the wallet has been credited: available, in a payout or paid out. Past the limit, KYC is required.
  const lifetimeCredited = approvedEarnings + (metrics?.money?.committed ?? 0);
  const processingBatch = useMemo(() => batches.find((batch) => batch.status === "Processing" || batch.status === "Draft") ?? null, [batches]);
  const kycMeta = useMemo(() => describeKycStatus(kycStatus, kycRejectionReason), [kycStatus, kycRejectionReason]);
  const payoutReadiness = useMemo(
    () =>
      buildPayoutReadiness({
        kycStatus,
        kycRejectionReason,
        upiVerified: Boolean(upi?.verified),
        hasActiveBatch: Boolean(processingBatch),
        eligibleItemCount: approvedEarnings > 0 ? 1 : 0,
        eligibleAmount: approvedEarnings,
        minimumAmount: MIN_PAYOUT_REQUEST_INR,
        lifetimeCredited,
        nextManualAt,
      }),
    [approvedEarnings, kycStatus, kycRejectionReason, processingBatch, upi?.verified, lifetimeCredited, nextManualAt]
  );
  // The identity check appears only after confirmed lifetime wallet credits pass the policy limit.
  const kycBlocking = payoutReadiness.kycRequired;
  const showKycCheck = verified.metrics && Number.isFinite(lifetimeCredited) && payoutKycRequired(false, lifetimeCredited);
  const kycLimitLabel = formatINR(KYC_FREE_WITHDRAWAL_LIMIT_INR);
  const payoutSummary = useMemo(() => summarizePayoutBatches(batches), [batches]);
  const requestBlockedReason = payoutReadiness.primaryBlocker?.detail ?? null;
  const thresholdGap = Math.max(0, MIN_PAYOUT_REQUEST_INR - approvedEarnings);

  const requestPayout = async () => {
    if (!workerId) return;
    if (!coreReady || !payoutReadiness.ready) {
      setNotice({ tone: "danger", text: payoutReadiness.primaryBlocker?.detail || "Payout request is blocked." });
      return;
    }
    setRequesting(true);
    setNotice(null);
    try {
      const { data } = await payoutSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/payoutbatches/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workerId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Unable to request payout.");
      const amount = Number(payload?.amount);
      setNotice({
        tone: "success",
        text: `${Number.isFinite(amount) && amount > 0 ? `${formatINR(amount)} payout requested.` : "Payout request submitted."} The team reviews it in the next payout cycle.`,
      });
      await loadPayoutData("refresh");
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof Error ? err.message : "Unable to request payout." });
    } finally {
      setRequesting(false);
    }
  };


  const kycOk = kycStatus === "approved";
  const hasMethod = hasPayoutMethod(upi);
  const upiOk = hasMethod && Boolean(upi?.verified);
  const minimumOk = approvedEarnings >= MIN_PAYOUT_REQUEST_INR;
  const noActiveBatch = !processingBatch;
  const reel = socialAccounts.earnings;
  const reelLoading = socialAccounts.load.state === "loading";
  const reelError = socialAccounts.load.state === "error" ? socialAccounts.load.message : socialAccounts.load.state === "ready" ? socialAccounts.load.refreshError : undefined;
  // Reel wallet totals when linked accounts exist; otherwise the wallet's own approved/pending totals.
  const creditedTotal = reel?.accountCount ? reel.approved : metrics?.money?.earnings;
  const pendingTotal = reel?.accountCount ? reel.pending : metrics?.money?.pending;

  // Auto-withdrawal switch and day: applied at once (optimistically), rolled back if the server refuses.
  const saveAutoWithdrawal = async (enabled: boolean, day: number) => {
    if (!upi || !hasPayoutMethod(upi) || savingAuto) return;
    const previous = upi;
    setUpi({ ...upi, autoWithdraw: enabled, payoutSchedule: "Monthly", payoutDay: String(day), autoWithdrawSince: enabled ? new Date().toISOString() : undefined });
    setSavingAuto(true);
    try {
      const { data } = await payoutSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session has expired. Sign in again to change auto-withdrawal.");
      const res = await fetch("/api/upi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoWithdraw: enabled, autoDay: day }),
      });
      const next = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(next?.error || "We couldn't save your auto-withdrawal setting. Please try again.");
      setUpi(next);
      const first = nextAutoWithdrawalAt(day, autoDoneThisMonth, Date.now(), next.autoWithdrawSince);
      // Say what will actually happen, including anything that would hold the first payout back.
      const waitingFor = payoutReadiness.kycRequired
        ? " Payouts are paused until your KYC is approved, so it starts once it is."
        : !upiOk
          ? " It starts once your payout details are verified."
          : "";
      setNotice({
        tone: "success",
        text: !enabled
          ? "Auto-withdrawal is off. You can still withdraw yourself once every 7 days."
          : previous.autoWithdraw
            ? `Auto-withdrawal day changed to the ${ordinal(day)}. Next withdrawal: ${shortDate(first)}.${waitingFor}`
            : `Auto-withdrawal is on. On the ${ordinal(day)} of every month, starting ${shortDate(first)}, we'll request your available balance once it's ${formatINR(MIN_PAYOUT_REQUEST_INR)} or more.${waitingFor}`,
      });
    } catch (err) {
      setUpi(previous);
      setNotice({
        tone: "danger",
        text: `${enabled && !previous.autoWithdraw ? "Auto-withdrawal wasn't turned on" : !enabled ? "Auto-withdrawal wasn't turned off" : "Your auto-withdrawal day wasn't changed"}. ${
          err instanceof Error && err.message ? err.message : "Please try again."
        }`,
      });
    } finally {
      setSavingAuto(false);
    }
  };
  const focusAutoSwitch = () => {
    autoSwitchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    autoSwitchRef.current?.focus({ preventScroll: true });
  };

  const openUpiEditor = () => {
    setUpiEditorOpen(true);
    requestAnimationFrame(() => upiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const showHistory = () => {
    setHistoryRequested(true);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  type CheckKey = "kyc" | "upi" | "min" | "batch";
  type CheckAction = { label: string; href?: string; onClick?: () => void };
  const actionFor = (key: CheckKey): CheckAction | null => {
    if (key === "kyc") return kycOk ? null : { label: kycStatus === "pending" ? "View status" : kycStatus === "rejected" ? "Fix KYC" : "Verify now", onClick: () => setKycSheetOpen(true) };
    if (key === "upi") return upiOk ? null : { label: hasMethod ? "View details" : "Add details", onClick: openUpiEditor };
    if (key === "min") return minimumOk ? null : { label: "View earnings", href: "/dashboard?section=accounts" };
    return noActiveBatch ? null : { label: "View cycle", onClick: showHistory };
  };
  const allReadinessChecks: Array<{ key: CheckKey; ok: boolean; title: string; detail: string }> = [
    { key: "kyc", ok: kycOk || !kycBlocking, title: "Identity verified (KYC)", detail: kycOk ? kycMeta.label : kycMeta.description },
    {
      key: "upi",
      ok: upiOk,
      title: upi?.bank ? "Payout bank account verified" : "Payout method verified",
      detail: hasMethod ? `${payoutMethodLabel(upi)}${upiOk ? "" : " · waiting for verification"}` : "Add a bank account or UPI ID to receive payouts.",
    },
    {
      key: "min",
      ok: minimumOk,
      title: minimumOk ? `${formatINR(MIN_PAYOUT_REQUEST_INR)} minimum reached` : `Reach ${formatINR(MIN_PAYOUT_REQUEST_INR)} to withdraw`,
      detail: minimumOk ? "Your wallet balance meets the minimum." : `${formatINR(thresholdGap)} more in your wallet needed.`,
    },
    {
      key: "batch",
      ok: noActiveBatch && !nextManualAt,
      title: !noActiveBatch ? "A payout is in progress" : nextManualAt ? "Weekly manual withdrawal used" : "No payout in progress",
      detail: !noActiveBatch
        ? `A ${processingBatch?.status.toLowerCase()} cycle is already active.`
        : nextManualAt
          ? `Next one opens ${shortDateTime(nextManualAt)} (${countdown(nextManualAt, now)}).`
          : `You can withdraw manually once every ${MANUAL_WITHDRAWAL_INTERVAL_DAYS} days.`,
    },
  ];
  const readinessChecks = allReadinessChecks.filter((check) => check.key !== "kyc" || showKycCheck || (!verified.metrics && !failures.metrics));
  const checkReady: Record<CheckKey, boolean> = { kyc: ready.kyc && verified.metrics, upi: ready.upi, min: ready.metrics, batch: ready.batches };
  const coreReady = verified.kyc && verified.upi && verified.metrics && verified.batches;
  const hasFailures = Object.values(failures).some(Boolean);
  const checksDone = readinessChecks.filter((c) => c.ok && checkReady[c.key]).length;
  const minimumProgress = Math.min(100, Math.round((approvedEarnings / MIN_PAYOUT_REQUEST_INR) * 100));
  // The first unmet check drives the balance card's "Next step".
  const blockerCode = payoutReadiness.primaryBlocker?.code ?? "";
  const nextKey: CheckKey | null = payoutReadiness.ready
    ? null
    : blockerCode.startsWith("kyc")
      ? "kyc"
      : blockerCode.startsWith("upi")
        ? "upi"
        : blockerCode === "active_batch" || blockerCode === "weekly_limit"
          ? "batch"
          : "min";
  const nextCheck = nextKey ? readinessChecks.find((c) => c.key === nextKey) : null;
  const nextAction = nextKey ? actionFor(nextKey) : null;

  // Same card as the dashboard (dashboardUi Card).
  const card = PAYOUT_CARD_CLASS;
  const actionBtn =
    "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border border-[#dfe7dc] bg-white px-3 text-[12px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]/50";
  const renderAction = (action: CheckAction, className = actionBtn) =>
    action.href ? (
      <Link href={action.href} className={className}>
        {action.label} <span aria-hidden>→</span>
      </Link>
    ) : (
      <button type="button" onClick={action.onClick} className={className}>
        {action.label} <span aria-hidden>→</span>
      </button>
    );

  return (
    <div className="min-h-screen bg-[#f3f4f1] text-[#1a201c] [font-family:var(--font-geist-sans)]">
      {/* Same top bar as the dashboard: back to Wallet, section identity, live status and the main action. */}
      <header className="sticky top-0 z-20 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className={cx(PAYOUT_CONTAINER_CLASS, "flex h-[60px] items-center justify-between gap-3 md:h-[68px]")}>
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <Link
              href="/dashboard?section=wallet"
              aria-label="Back to Wallet"
              title="Back to Wallet"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e3e5e1] bg-white text-[#4b544e] transition hover:bg-[#f3f4f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
            >
              <Icon.ChevronLeft className="h-5 w-5" />
            </Link>
            <span
              aria-hidden="true"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe9da] bg-[linear-gradient(160deg,#f3f9ef,#e6f2e0)] text-[#2e7d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(34,45,37,0.06)] md:flex"
            >
              <Icon.Wallet className="h-[19px] w-[19px]" />
            </span>
            <div className="min-w-0">
              <div className="hidden truncate text-[11.5px] font-semibold text-[#7a877f] md:block">Wallet</div>
              <h1 className="truncate text-[16px] font-semibold text-[#20352c] md:text-[20px] md:leading-tight md:tracking-[-0.02em]">Payouts</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void loadPayoutData("refresh"); void socialAccounts.refresh(); }}
              disabled={refreshing || !workerId}
              aria-label="Refresh payouts"
              aria-busy={refreshing}
              title={liveState === "live" ? "Updates appear instantly · tap to refresh" : liveState === "offline" ? "Live updates unavailable; checking every 10 seconds" : "Connecting to live updates"}
              className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#e3e5e1] bg-white text-[12px] font-semibold text-[#4b544e] transition hover:bg-[#f3f4f1] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 disabled:cursor-default sm:w-auto sm:px-3"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cx("h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true">
                <path d="M16 10a6 6 0 0 1-10.4 4.1M4 10a6 6 0 0 1 10.4-4.1" />
                <path d="M14.6 3.2v2.9h-2.9M5.4 16.8v-2.9h2.9" />
              </svg>
              <span className="hidden whitespace-nowrap sm:inline">
                {refreshing ? "Refreshing…" : fromSnapshot ? "Saved data" : hasFailures ? "Refresh needed" : lastUpdatedAt ? `Updated ${lastUpdatedAt}` : "Loading…"}
              </span>
              <span
                className={cx(
                  "absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white sm:static sm:h-2 sm:w-2 sm:border-0",
                  refreshing ? "animate-pulse bg-[#d99a06]" : liveState === "live" ? "bg-[#2e7d4f]" : "bg-[#d99a06]"
                )}
                aria-hidden="true"
              />
              <span className="sr-only">{liveState === "live" ? "Live" : liveState === "offline" ? "Auto-refresh" : "Connecting"}</span>
            </button>
            <Link href={CREATOR_HOME_HREF} className={buttonClassName("primary", "md", "h-10 max-sm:hidden")}>
              My jobs
            </Link>
          </div>
        </div>
      </header>

      <main className={PAYOUT_MAIN_CLASS}>
        <PageHeader
          title="Payouts"
          description="Withdraw from your wallet and manage where your payouts go."
          meta={workerId ? <span className="rounded-md bg-[#eceeeb] px-1.5 py-0.5 font-mono text-[11px] text-[#4b544e]">{workerId}</span> : null}
        />

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-[#f1dea6] bg-[#fff8e1] px-4 py-3 text-[13px] font-semibold text-[#7a5200]">
            {error}
          </div>
        )}
        {notice && (
          <div
            role={notice.tone === "danger" ? "alert" : "status"}
            className={`mt-4 rounded-xl border px-4 py-3 text-[13px] font-semibold ${
              notice.tone === "success" ? "border-[#c6e0b0] bg-[#eef7e6] text-[#2f6a1f]" : "border-[#f6cdc8] bg-[#fdecea] text-[#b42318]"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-[12px] font-semibold underline-offset-2 opacity-80 hover:underline" aria-label="Dismiss">
                Dismiss
              </button>
            </span>
          </div>
        )}

        <div className={PAYOUT_GRID_CLASS}>
          {/* Left column (desktop) */}
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            {/* Balance: what can be withdrawn, the one action that fits, and how money leaves the wallet. */}
            <section aria-labelledby="balance-heading" aria-busy={!ready.metrics} className={`${card} order-1 overflow-hidden`}>
              <div className="p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="balance-heading" className="text-[13px] font-semibold text-[#5f6f65]">
                    Wallet balance
                  </h2>
                  {hasMethod ? (
                    <button
                      type="button"
                      onClick={focusAutoSwitch}
                      title={autoOn ? scheduleLabel(upi.payoutSchedule, upi.payoutDay) : "Monthly auto-withdrawal is off"}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]/50 ${
                        autoOn ? "bg-[#e3f1d6] text-[#2f6a1f] ring-[#c6e0b0] hover:bg-[#d8ecc6]" : "bg-[#f3f4f1] text-[#5f6f65] ring-[#e2e6df] hover:bg-[#eceee9]"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${autoOn ? "bg-[#5e8f35]" : "bg-[#a3aaa4]"}`} aria-hidden />
                      {autoOn ? `Auto on · ${ordinal(autoDay)}` : "Auto off"}
                    </button>
                  ) : null}
                </div>
                {ready.metrics ? (
                  <div className="mt-1 break-words text-[clamp(2rem,8vw,3rem)] font-semibold leading-tight tracking-[-0.04em] text-[#14241c] tabular-nums">
                    {metrics ? formatINR(approvedEarnings) : "Unavailable"}
                  </div>
                ) : (
                  <Shimmer className="mt-2 h-12 w-44 !rounded-xl" />
                )}

                {metrics ? (
                  minimumOk ? (
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[#5f6f65]">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#2f6a1f]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#5e8f35]" aria-hidden />
                        Above the minimum
                      </span>
                    </p>
                  ) : (
                    <div className="mt-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-[#5f6f65]">
                        <span>
                          Minimum to withdraw <span className="font-semibold text-[#1f2e28]">{formatINR(MIN_PAYOUT_REQUEST_INR)}</span>
                        </span>
                        <span className="font-semibold text-[#41695b] tabular-nums">{formatINR(thresholdGap)} to go</span>
                      </div>
                      <div
                        className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2eb]"
                        role="progressbar"
                        aria-valuenow={minimumProgress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Progress to minimum payout"
                      >
                        <div className="h-full rounded-full bg-[#8db35a] transition-[width] duration-700" style={{ width: `${Math.max(minimumProgress, approvedEarnings > 0 ? 3 : 0)}%` }} />
                      </div>
                    </div>
                  )
                ) : !ready.metrics ? <Shimmer className="mt-2 h-4 w-36" /> : null}

                {hasFailures ? (
                  <div role="status" className="mt-5 rounded-lg bg-[#fff8ec] p-3.5 text-[13px] leading-5 text-[#825317] ring-1 ring-inset ring-[#f1dea6]">
                    Some payout details are unavailable. Refresh to verify your balance and requirements before withdrawing.
                  </div>
                ) : !coreReady ? (
                  <div className="mt-5 flex min-h-[94px] items-center gap-3 rounded-lg bg-[#fafbf8] p-3.5 ring-1 ring-inset ring-[#e8eee5]" aria-busy="true">
                    <Shimmer className="hidden h-9 w-9 shrink-0 !rounded-full min-[360px]:block" />
                    <div className="min-w-0 flex-1">
                      <span role="status" className="text-[12.5px] text-[#6f7d74]">Checking payout requirements…</span>
                      <Shimmer className="mt-2 h-4 w-44" />
                      <Shimmer className="mt-2 h-3 w-full" />
                    </div>
                    <Shimmer className="hidden h-10 w-24 shrink-0 !rounded-lg min-[520px]:block" />
                  </div>
                ) : payoutReadiness.ready ? (
                  <div className="mt-5 grid gap-3">
                    <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4">
                      <button
                        type="button"
                        onClick={requestPayout}
                        disabled={requesting || !workerId}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1f2b24] px-5 text-[14px] font-semibold text-white shadow-[0_10px_22px_-14px_rgba(36,78,57,0.9)] transition hover:bg-[#2b3a31] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8db35a]/40 disabled:opacity-60 min-[480px]:w-fit"
                      >
                        {requesting ? "Requesting…" : <span className="tabular-nums">Withdraw {formatINR(payoutReadiness.requestAmount)}</span>}
                        {!requesting && <span aria-hidden>→</span>}
                      </button>
                      {hasMethod ? <span className="min-w-0 truncate text-center text-[12.5px] text-[#6f7d74] min-[480px]:text-left">To {payoutMethodLabel(upi)}{upi?.bank ? " by bank transfer" : " via UPI"}</span> : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-3 rounded-lg bg-[#fffaf0] p-3.5 ring-1 ring-inset ring-[#f1dea6] min-[520px]:flex-row min-[520px]:items-center">
                    <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#8a5a00] ring-1 ring-[#f1dea6] min-[360px]:flex" aria-hidden>
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v7.5H5z" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8a5a00]">
                        Next step · {checksDone}/{readinessChecks.length} ready
                      </p>
                      <p className="mt-0.5 text-[14px] font-semibold text-[#1f2e28]">{nextCheck?.title ?? "Withdrawal is blocked"}</p>
                      {requestBlockedReason ? <p className="mt-0.5 text-[12.5px] leading-5 text-[#6b5a3a]">{requestBlockedReason}</p> : null}
                    </div>
                    {nextAction
                      ? renderAction(
                          nextAction,
                          "inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1f2b24] px-4 text-[13.5px] font-semibold text-white transition hover:bg-[#2b3a31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]/50 min-[520px]:w-auto"
                        )
                      : null}
                  </div>
                )}
              </div>

              {coreReady && !hasFailures ? (
                // How money leaves the wallet: one manual withdrawal a week, plus an automatic one each month.
                <dl className="grid grid-cols-1 divide-y divide-[#e8eee5] border-t border-[#e8eee5] bg-[#f8faf5] min-[440px]:grid-cols-2 min-[440px]:divide-x min-[440px]:divide-y-0" aria-label="Withdrawal schedule">
                  <div className="min-w-0 px-4 py-3.5 sm:px-6">
                    <dt className="flex items-center gap-1.5 text-[12px] font-medium text-[#5f6f65]">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-[#41695b]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5M4 16.5h12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Manual · once a week
                    </dt>
                    <dd className="mt-1 text-[14px] font-semibold text-[#1f2e28]">
                      {!noActiveBatch ? "After this cycle" : nextManualAt ? shortDateTime(nextManualAt) : "Available now"}
                    </dd>
                    <dd className="mt-0.5 text-[12px] leading-5 text-[#6f7d74]">
                      {!noActiveBatch
                        ? `A ${processingBatch?.status.toLowerCase()} payout is open.`
                        : nextManualAt
                          ? `Opens ${countdown(nextManualAt, now)}`
                          : `Then again ${MANUAL_WITHDRAWAL_INTERVAL_DAYS} days later.`}
                    </dd>
                  </div>
                  <div className="min-w-0 px-4 py-3.5 sm:px-6">
                    <dt className="flex items-center justify-between gap-3">
                      <span id="auto-withdraw-label" className="flex items-center gap-1.5 text-[12px] font-medium text-[#5f6f65]">
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-[#41695b]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M16 10a6 6 0 1 1-1.76-4.24M16 3.5V6h-2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Auto · monthly
                      </span>
                      {hasMethod ? (
                        <button
                          ref={autoSwitchRef}
                          type="button"
                          role="switch"
                          aria-checked={autoOn}
                          aria-labelledby="auto-withdraw-label"
                          disabled={savingAuto}
                          onClick={() => void saveAutoWithdrawal(!autoOn, autoDay)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8db35a]/40 disabled:opacity-60 ${
                            autoOn ? "bg-[#41695b]" : "bg-[#cfd8ca]"
                          }`}
                        >
                          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${autoOn ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                        </button>
                      ) : null}
                    </dt>
                    {autoOn ? (
                      <>
                        <dd className="mt-1 text-[14px] font-semibold text-[#1f2e28]" aria-live="polite">
                          {savingAuto ? "Saving…" : autoIsToday ? "Today" : shortDate(nextAutoAt)}
                        </dd>
                        <dd className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-5 text-[#6f7d74]">
                          <label htmlFor="auto-withdraw-day">On the</label>
                          <select
                            id="auto-withdraw-day"
                            value={autoDay}
                            disabled={savingAuto}
                            onChange={(e) => void saveAutoWithdrawal(true, Number(e.target.value))}
                            className="h-8 rounded-[10px] border border-[#dbe3d7] bg-white px-2 text-[13px] font-semibold text-[#1f2e28] outline-none transition focus:border-[#8db35a] focus:ring-2 focus:ring-[#dce78f]/50 disabled:opacity-60"
                          >
                            {MONTH_DAYS.map((day) => (
                              <option key={day} value={day}>
                                {ordinal(Number(day))}
                              </option>
                            ))}
                          </select>
                          <span>of every month{upiOk ? `, from ${formatINR(MIN_PAYOUT_REQUEST_INR)}` : " once your UPI ID is verified"}.</span>
                        </dd>
                      </>
                    ) : (
                      <>
                        <dd className="mt-1 text-[14px] font-semibold text-[#1f2e28]">{savingAuto ? "Saving…" : "Off"}</dd>
                        <dd className="mt-0.5 text-[12px] leading-5 text-[#6f7d74]">
                          {hasMethod ? "Turn it on and we'll withdraw your available balance for you every month, on a day you choose." : "Add a bank account or UPI ID to use monthly auto-withdrawal."}
                        </dd>
                      </>
                    )}
                  </div>
                </dl>
              ) : !hasFailures ? <WithdrawalScheduleLoading /> : null}

              {hasMethod ? null : ready.upi ? (
                <p className="border-t border-[#e8eee5] px-4 py-3 text-[12.5px] text-[#5f6f65] sm:px-6">
                  Payouts go to your bank account or UPI ID.{" "}
                  <button type="button" onClick={openUpiEditor} className="font-semibold text-[#41695b] underline underline-offset-2">
                    Add one now
                  </button>
                </p>
              ) : null}
            </section>

            {/* Wallet overview: where earnings stand, without repeating the withdrawable balance above. */}
            <section aria-labelledby="overview-heading" aria-busy={!ready.metrics || !ready.batches} className={`${card} order-3 p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="overview-heading" className="text-[14px] font-semibold text-[#1a201c]">Wallet overview</h2>
                  <p className="mt-0.5 text-[13px] text-[#5f6f65]">Your earnings from review to payout.</p>
                </div>
                <Link href="/dashboard?section=accounts" className={actionBtn}>
                  Accounts <span aria-hidden>→</span>
                </Link>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3" aria-live="polite">
                <OverviewStat
                  label="Credited"
                  dot="bg-[#5e8f35]"
                  value={creditedTotal !== undefined ? formatINR(creditedTotal) : "–"}
                  caption={reel?.approvedReels !== undefined ? `${reel.approvedReels} ${reel.approvedReels === 1 ? "reel" : "reels"} credited` : "Approved earnings"}
                  loading={creditedTotal === undefined && (reelLoading || !ready.metrics)}
                />
                <OverviewStat
                  label="In review"
                  dot="bg-[#d9a520]"
                  value={pendingTotal !== undefined ? formatINR(pendingTotal) : "–"}
                  caption={reel?.pendingReels !== undefined ? `${reel.pendingReels} ${reel.pendingReels === 1 ? "reel" : "reels"} · estimate` : "Estimate until reviewed"}
                  loading={pendingTotal === undefined && (reelLoading || !ready.metrics)}
                />
                <OverviewStat
                  label="In payout"
                  dot="bg-[#4f8fd6]"
                  value={failures.batches && !batches.length ? "–" : formatINR(payoutSummary.pending)}
                  caption={payoutSummary.liveBatches ? `${payoutSummary.liveBatches} open ${payoutSummary.liveBatches === 1 ? "cycle" : "cycles"}` : "No open cycle"}
                  loading={!ready.batches}
                />
                <OverviewStat
                  label="Paid out"
                  dot="bg-[#41695b]"
                  value={failures.batches && !batches.length ? "–" : formatINR(payoutSummary.credited)}
                  caption={`Lifetime · ${batches.length} ${batches.length === 1 ? "cycle" : "cycles"}`}
                  loading={!ready.batches}
                />
              </dl>
              {reel && reel.accountCount > 1 ? (
                <details className="group mt-3 rounded-lg ring-1 ring-inset ring-[#e8eee5]">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-[13px] font-semibold text-[#41695b] [&::-webkit-details-marker]:hidden">
                    By account ({reel.accountCount})
                    <span className="transition-transform group-open:rotate-180" aria-hidden>▾</span>
                  </summary>
                  <ul className="divide-y divide-[#eef2eb] border-t border-[#eef2eb]">
                    {reel.breakdown.map((row) => (
                      <li key={row.accountId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5 text-[13px]">
                        <span className="min-w-0 break-words font-semibold">@{row.handle.replace(/^@/, "")}</span>
                        <span className="tabular-nums text-[#4d5f55]">
                          {formatINR(row.approved)} <span className="text-[#8a958e]">· {formatINR(row.pending)} in review</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="mt-3 text-[12px] leading-5 text-[#6f7d74]">
                Credited includes money already paid out or in a payout. In-review amounts are estimates until the team reviews new views.
                {reel?.missingCounts ? <span className="text-[#8a5300]"> {reel.missingCounts} {reel.missingCounts === 1 ? "reel is" : "reels are"} waiting for a view count.</span> : null}
                {reelError ? <span className="text-[#8a5300]"> {reel ? "Showing the last saved earnings. " : ""}{reelError}</span> : null}
              </p>
            </section>

            {/* History */}
            <section ref={historyRef} aria-labelledby="history-heading" className={`${card} order-5 scroll-mt-24 p-4 sm:p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="history-heading" className="text-[14px] font-semibold text-[#1a201c]">Payout history</h2>
                  <p className="mt-0.5 text-[13px] text-[#5f6f65]">Track your withdrawals and included earnings.</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#f0f4ec] px-3 py-1 text-[12px] font-bold text-[#41695b]">{ready.batches ? batches.length : "…"}</span>
              </div>

              <div className="mt-4 grid gap-3">
                {!ready.batches &&
                  Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="rounded-xl border border-[#e4ebe1] bg-[#fbfcf9] p-4" aria-busy="true">
                      <Shimmer className="h-4 w-40" />
                      <Shimmer className="mt-2 h-3 w-56 max-w-full" />
                      <Shimmer className="mt-4 h-6 w-24" />
                    </div>
                  ))}
                {ready.batches && failures.batches && !batches.length ? <p role="status" className="text-sm text-[#825317]">Payout history could not be loaded. Refresh to try again.</p> : null}
                {ready.batches && !failures.batches && batches.length === 0 && (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-[#d9e3d6] bg-[#f8fbf5] px-5 py-8 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#41695b] ring-1 ring-[#e2e8de]" aria-hidden>
                      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M3.5 6h13v9.5h-13zM3.5 6l9-2.5V6M13 10.5h1.5" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div className="mt-3 text-[15px] font-semibold">No payouts yet</div>
                    <p className="mx-auto mt-1 max-w-sm text-[13px] leading-6 text-[#5f6f65]">
                      Your first cycle appears here once you request a payout. {payoutReadiness.ready ? "You're ready now." : `${checksDone} of ${readinessChecks.length} requirements done.`}
                    </p>
                  </div>
                )}
                {ready.batches && batches.length > 0 ? (
                  <DeferredPayoutContent eager={historyRequested} fallback={<PayoutHistoryLoading rows={Math.min(historyLimit, batches.length)} />}>
                    <div className="grid gap-3">{batches.slice(0, historyLimit).map((batch) => <PayoutHistoryCard key={batch.id} batch={batch} />)}</div>
                  </DeferredPayoutContent>
                ) : null}
                {ready.batches && batches.length > historyLimit ? (
                  <button
                    type="button"
                    onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE * 2)}
                    className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-[#dfe7dc] bg-white text-[13.5px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]"
                  >
                    Show {Math.min(HISTORY_PAGE * 2, batches.length - historyLimit)} more of {batches.length - historyLimit}
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          {/* Right column (desktop) */}
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            {/* Readiness checklist */}
            <section aria-labelledby="ready-heading" className={`${card} order-2 p-4 transition-shadow duration-500 sm:p-5 ${flash === "kyc" || flash === "upi" ? "!ring-2 !ring-[#8db35a] shadow-[0_0_0_6px_rgba(141,179,90,0.18)]" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 id="ready-heading" className="text-[14px] font-semibold text-[#1a201c]">Ready to request?</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${
                    payoutReadiness.ready ? "bg-[#e3f1d6] text-[#2f6a1f]" : "bg-[#fff4d6] text-[#8a5a00]"
                  }`}
                >
                  {hasFailures ? "Needs refresh" : coreReady ? `${checksDone}/${readinessChecks.length} done` : "Checking…"}
                </span>
              </div>
              <div className={cx("mt-3 grid gap-1", readinessChecks.length === 4 ? "grid-cols-4" : "grid-cols-3")} aria-hidden>
                {readinessChecks.map((check, index) => (
                  <span key={check.key} className={`h-1.5 rounded-full transition-colors duration-500 ${!coreReady ? "motion-safe:animate-pulse bg-[#eef1ea]" : index < checksDone ? "bg-[#8db35a]" : "bg-[#ece6d2]"}`} />
                ))}
              </div>
              <ul className="mt-3 grid gap-2">
                {readinessChecks.map((check) => {
                  if (!checkReady[check.key]) {
                    return (
                      <li key={check.key} className={cx("flex items-start gap-3 rounded-lg bg-[#f8faf5] px-3 py-2.5", check.key === "kyc" ? "min-h-[96px]" : "min-h-[64px]")} aria-busy="true">
                        <Shimmer className="mt-0.5 h-6 w-6 !rounded-full" />
                        <span className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                          <Shimmer className="h-3.5 w-40 max-w-full" />
                          <Shimmer className="h-3 w-56 max-w-full" />
                        </span>
                      </li>
                    );
                  }
                  if (failures[check.key === "min" ? "metrics" : check.key === "batch" ? "batches" : check.key]) return <li key={check.key} className="rounded-xl bg-[#fff8ec] px-3 py-3 text-[13px] text-[#825317]">{check.title}: verification unavailable. Refresh to try again.</li>;
                  if (check.key === "kyc") {
                    return (
                      <KycRow
                        key="kyc"
                        kyc={{ status: kycStatus, reason: kycRejectionReason, ...kycDetails }}
                        highlighted={nextKey === "kyc"}
                        live={liveState === "live"}
                        onOpen={() => setKycSheetOpen(true)}
                        need={{ required: kycBlocking, limitLabel: kycLimitLabel, earnedLabel: formatINR(lifetimeCredited) }}
                      />
                    );
                  }
                  const action = actionFor(check.key);
                  const isNext = check.key === nextKey;
                  return (
                    <li
                      key={check.key}
                      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition ${
                        check.ok ? "bg-[#f4f8f0]" : isNext ? "bg-[#fffaf0] ring-1 ring-inset ring-[#f1dea6]" : "bg-[#f8faf5]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          check.ok ? "bg-[#8db35a] text-white" : "border-2 border-[#e0c98a] bg-white text-[#8a5a00]"
                        }`}
                        aria-hidden
                      >
                        {check.ok ? (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
                          </svg>
                        ) : (
                          <span className="text-[12px] font-black leading-none">!</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">{check.ok ? "Done: " : "To do: "}</span>
                        <span className={`block text-[14px] font-semibold ${check.ok ? "text-[#4d5f55]" : ""}`}>{check.title}</span>
                        <span className="block break-words text-[12px] leading-5 text-[#5f6f65]">{check.detail}</span>
                      </span>
                      {action ? <span className="mt-0.5">{renderAction(action)}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Payout method: bank account or UPI ID */}
            <PayoutMethodCard
              config={upi}
              ready={ready.upi}
              failed={failures.upi}
              locked={Boolean(processingBatch)}
              live={liveState === "live"}
              autoLabel={autoOn && upi ? scheduleLabel(upi.payoutSchedule, upi.payoutDay) : "Auto-withdrawal off"}
              editorOpen={upiEditorOpen}
              setEditorOpen={setUpiEditorOpen}
              highlighted={flash === "upi"}
              sectionRef={upiSectionRef}
              className={`${card} order-4 scroll-mt-24 p-4 transition-shadow duration-500 sm:p-5`}
              getToken={async () => (await payoutSession()).data.session?.access_token}
              onSaved={(next, message) => {
                setUpi(next as UpiConfig);
                setNotice({ tone: "success", text: message });
                void loadPayoutData("refresh");
              }}
            />

            {/* Guidance */}
            <details className={`${card} group order-6 p-4 sm:p-5`} open={ready.batches && batches.length === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <h2 className="text-[14px] font-semibold text-[#1a201c]">How payouts work</h2>
                <span className="text-[#7a8a80] transition-transform group-open:rotate-180" aria-hidden>
                  ▾
                </span>
              </summary>
              <ol className="relative mt-3 grid gap-3">
                <span className="absolute bottom-3 left-3 top-3 w-px bg-[#dfe7dc]" aria-hidden />
                {[
                  { title: "Earn", text: "Approved reels and work become payout-eligible after the team's review." },
                  { title: "Review", text: "Reel approval credits reviewed earnings to your wallet automatically. New views still need review." },
                  { title: "Withdraw", text: `From ${formatINR(MIN_PAYOUT_REQUEST_INR)} with a verified UPI ID: withdraw yourself once every ${MANUAL_WITHDRAWAL_INTERVAL_DAYS} days, or switch on auto-withdrawal to have it sent every month on a day you choose.` },
                  { title: "Verify once", text: `Once your earnings pass ${kycLimitLabel} in total, payouts pause until you verify your identity. It's a one-time check.` },
                  { title: "Get paid", text: "The team approves the cycle and marks it paid to your UPI." },
                ].map((step, index) => (
                  <li key={step.title} className="relative flex items-start gap-3 text-[13px] leading-5 text-[#4d5f55]">
                    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#41695b] text-[12px] font-bold text-white ring-4 ring-white">{index + 1}</span>
                    <span className="pt-0.5">
                      <span className="font-semibold text-[#20352c]">{step.title}.</span> {step.text}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </div>
      </main>

      {kycSheetOpen ? (
        <KycSheet
          kyc={{ status: kycStatus, reason: kycRejectionReason, ...kycDetails }}
          onClose={() => setKycSheetOpen(false)}
          onSubmitted={(next) => {
            // Show "In review" immediately; the server's broadcast then confirms it and later delivers the decision.
            setKycStatus(next.status);
            setKycRejectionReason(null);
            setKycDetails({ submittedAt: next.submittedAt, reviewedAt: null, profile: next.profile });
            if (seenRef.current) seenRef.current = { ...seenRef.current, kyc: "pending" };
            setKycSheetOpen(false);
            setNotice({ tone: "success", text: "KYC submitted. It shows as in review here and updates the moment the team decides." });
            void loadPayoutData("refresh");
          }}
        />
      ) : null}
    </div>
  );
}

function OverviewStat({ label, value, caption, dot, loading }: { label: string; value: string; caption: string; dot: string; loading?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#f8faf5] px-3.5 py-3 ring-1 ring-inset ring-[#e8eee5]">
      <dt className="flex items-center gap-1.5 text-[12px] font-medium text-[#5f6f65]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 break-words text-[clamp(1.1rem,4.6vw,1.4rem)] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
        {loading ? <Shimmer className="h-6 w-20" /> : value}
      </dd>
      <dd className="mt-0.5 truncate text-[11.5px] text-[#6f7d74]">{loading ? "\u00a0" : caption}</dd>
    </div>
  );
}
