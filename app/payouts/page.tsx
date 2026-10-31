"use client";
import { apiFetch as fetch } from "@/lib/api/client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { supabase } from "@/lib/supabaseClient";
import { buildPayoutReadiness, describeKycStatus, type KycStatus } from "@/lib/payoutReadiness";
import { formatAmount as formatINR } from "@/lib/money";
import { MIN_PAYOUT_REQUEST_INR } from "@/lib/payoutPolicy";
import { useSocialAccounts } from "@/lib/useSocialAccounts";
import { usePayoutIdentity } from "@/lib/usePayoutIdentity";
import { summarizePayoutBatches } from "@/lib/creatorEarnings";
import ReelEarningsSummary from "@/app/dashboard/ReelEarningsSummary";
import { MetricTile } from "@/app/dashboard/dashboardUi";
import { CREATOR_HOME_HREF } from "@/lib/routes";
import { KycRow, KycSheet, type KycProfile } from "./KycPanel";
import PayoutHistoryCard from "./PayoutHistoryCard";

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
  };
  sla?: {
    met?: number;
    breached?: number;
  };
};

type UpiConfig = {
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  updatedAt?: string;
  payoutSchedule: UpiSchedule;
  payoutDay: PayoutDay;
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
  origin?: "manual" | "auto";
};

const DEFAULT_UPI: UpiConfig = {
  upiId: "",
  verified: false,
  payoutSchedule: "Weekly",
  payoutDay: "Fri",
};

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEK_DAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
/** "Weekly on Fridays" / "Monthly on the 5th". */
function scheduleLabel(schedule: string, day: string) {
  return schedule === "Monthly" ? `Monthly on the ${ordinal(Number(day) || 1)}` : `Weekly on ${WEEK_DAY_NAMES[day] ?? day}s`;
}
const sinceLabel = (value?: string | null) => {
  const t = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) return null;
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function batchTotal(batch: PayoutBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

function isValidUpi(upi: string) {
  const text = String(upi ?? "").trim();
  return text.length >= 5 && text.length <= 100 && /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(text);
}

/** Each section loads independently after the signed-in account is verified. */
function PayoutsSkeleton() {
  return (
    <div className="min-h-screen bg-[#f6f7f2]" aria-busy="true" aria-label="Loading payouts">
      <div className="h-[60px] border-b border-[#e6ebe2] bg-[#fcfdf9] sm:h-[68px]" />
      <div className="mx-auto w-full max-w-6xl px-3.5 pt-6 sm:px-6 lg:px-8">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-[#e7efe5]" />
        <div className="mt-2 h-4 w-56 animate-pulse rounded-full bg-[#edf3eb]" />
        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-[16px] bg-white/80 ring-1 ring-[#e6ebe2]" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Pulse placeholder used inside sections while their own data loads. */
function Shimmer({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-[#e8eee5] ${className}`} aria-hidden />;
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
    if (!before || before === batch.status) continue;
    const amount = formatINR(batchTotal(batch));
    if (batch.status === "Paid") return { tone: "success", text: `${amount} was paid to your UPI.` };
    if (batch.status === "Failed") return { tone: "danger", text: `Your ${amount} payout was not approved${batch.notes?.length ? `: ${batch.notes[batch.notes.length - 1]}` : "."}` };
    if (batch.status === "Processing") return { tone: "success", text: `Your ${amount} payout was approved and is being processed.` };
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
      <div role="alert" className="w-full max-w-md rounded-2xl border border-[#e3e5e1] bg-white p-6 text-[#1a201c]">
        <h1 className="text-xl font-semibold">Payouts unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[#616a64]">{state.message}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className="rounded-xl bg-[#244e39] px-4 py-2.5 text-sm font-semibold text-white">Try again</button>
          <Link href="/dashboard?section=wallet" className="rounded-xl border border-[#e3e5e1] px-4 py-2.5 text-sm font-semibold">Back to Wallet</Link>
        </div>
      </div>
    </main>
  );
  if (state.state !== "ready") return <PayoutsSkeleton />;
  return <PayoutsWorkspace key={`${state.userId}:${state.workerId}`} userId={state.userId} workerId={state.workerId} />;
}

function PayoutsWorkspace({ userId, workerId }: { userId: string; workerId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(null);
  const [upi, setUpi] = useState<UpiConfig | null>(null);
  const [kycStatus, setKycStatus] = useState<KycStatus>("none");
  const [kycRejectionReason, setKycRejectionReason] = useState<string | null>(null);
  const [kycDetails, setKycDetails] = useState<{ submittedAt?: string | null; reviewedAt?: string | null; profile?: KycProfile | null }>({});
  const [kycSheetOpen, setKycSheetOpen] = useState(false);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [upiEditorOpen, setUpiEditorOpen] = useState(false);
  const [upiDraft, setUpiDraft] = useState<UpiConfig>(DEFAULT_UPI);
  const [savingUpi, setSavingUpi] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  // Which sections have real data (fresh or from this session's snapshot); each renders as soon as its own is in.
  const [ready, setReady] = useState({ metrics: false, batches: false, upi: false, kyc: false });
  const [fromSnapshot, setFromSnapshot] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [verified, setVerified] = useState({ metrics: false, batches: false, upi: false, kyc: false });
  const [failures, setFailures] = useState({ metrics: false, batches: false, upi: false, kyc: false });
  // What the creator last saw (this session or their previous visit), to announce what changed since.
  const seenRef = useRef<SeenState | null>(null);
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
    if (mode === "initial") {
      // Paint the last snapshot from this session immediately; fresh data replaces it section by section.
      const snapshot = readSnapshot(userId);
      if (snapshot) {
        setMetrics(snapshot.metrics);
        setBatches(snapshot.batches);
        setUpi(snapshot.upi);
        setKycStatus(snapshot.kyc.status);
        setKycRejectionReason(snapshot.kyc.reason);
        setReady({ metrics: true, batches: true, upi: true, kyc: true });
        setFromSnapshot(true);
        seenRef.current = seenFrom(snapshot);
      }
    } else setRefreshing(true);
    setError(null);

    const issues: string[] = [];
    const fresh: Partial<PayoutSnapshot> = {};
    const mark = (key: keyof typeof ready) => setReady((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    const settled = (key: keyof typeof ready, success: boolean) => {
      mark(key);
      setVerified(prev => ({ ...prev, [key]: success }));
      setFailures(prev => ({ ...prev, [key]: !success }));
    };
    const read = (url: string, headers?: HeadersInit) => fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });

    try {
      const { data } = await payoutSession();
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

      setLastUpdatedAt(new Date().toLocaleTimeString());
      setFromSnapshot(false);
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
      setError(err instanceof Error ? err.message : "Unable to load payout data.");
      setReady({ metrics: true, batches: true, upi: true, kyc: true });
      setVerified({ metrics: false, batches: false, upi: false, kyc: false });
      setFailures({ metrics: true, batches: true, upi: true, kyc: true });
    } finally {
      loadInFlightRef.current = false;
      setRefreshing(false);
    }
  }, [userId, workerId, flashSection]);

  useEffect(() => { void loadPayoutData("initial"); }, [loadPayoutData]);

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

  useEffect(() => {
    setUpiDraft(upi ?? DEFAULT_UPI);
  }, [upi]);

  const approvedEarnings = metrics?.money?.available ?? 0;
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
      }),
    [approvedEarnings, kycStatus, kycRejectionReason, processingBatch, upi?.verified]
  );
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
      setNotice({ tone: "success", text: "Payout request submitted. Admin review will continue in the next payout cycle." });
      await loadPayoutData("refresh");
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof Error ? err.message : "Unable to request payout." });
    } finally {
      setRequesting(false);
    }
  };

  const saveAndVerifyUpi = async () => {
    setUpiError(null);
    if (!isValidUpi(upiDraft.upiId)) {
      setUpiError("Enter a valid UPI ID like name@okhdfcbank.");
      return;
    }

    setSavingUpi(true);
    try {
      const { data } = await payoutSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const upiChanged = upiDraft.upiId.trim() !== (upi?.upiId ?? "");
      const payload = { upiId: upiDraft.upiId.trim(), payoutSchedule: upiDraft.payoutSchedule, payoutDay: upiDraft.payoutDay };

      const res = await fetch("/api/upi", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const next = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(next?.error || "Unable to update UPI configuration.");

      setUpi(next);
      setUpiDraft(next);
      setUpiEditorOpen(false);
      setNotice({
        tone: "success",
        text: upiChanged ? "UPI saved. The team will verify it, and this page updates the moment they do." : `Payout schedule updated: ${scheduleLabel(next.payoutSchedule, next.payoutDay).toLowerCase()}.`,
      });
      await loadPayoutData("refresh");
    } catch (err) {
      setUpiError(err instanceof Error ? err.message : "Unable to update UPI configuration.");
    } finally {
      setSavingUpi(false);
    }
  };

  const kycOk = kycStatus === "approved";
  const upiOk = Boolean(upi?.verified);
  const minimumOk = approvedEarnings >= MIN_PAYOUT_REQUEST_INR;
  const noActiveBatch = !processingBatch;
  const reel = socialAccounts.earnings;

  const openUpiEditor = () => {
    setUpiDraft(upi ?? DEFAULT_UPI);
    setUpiError(null);
    setUpiEditorOpen(true);
    requestAnimationFrame(() => upiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const showHistory = () => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  type CheckKey = "kyc" | "upi" | "min" | "batch";
  type CheckAction = { label: string; href?: string; onClick?: () => void };
  const actionFor = (key: CheckKey): CheckAction | null => {
    if (key === "kyc") return kycOk ? null : { label: kycStatus === "pending" ? "View status" : kycStatus === "rejected" ? "Fix KYC" : "Verify now", onClick: () => setKycSheetOpen(true) };
    if (key === "upi") return upiOk ? null : { label: upi?.upiId ? "Edit UPI" : "Add UPI", onClick: openUpiEditor };
    if (key === "min") return minimumOk ? null : { label: "View earnings", href: "/dashboard?section=accounts" };
    return noActiveBatch ? null : { label: "View cycle", onClick: showHistory };
  };
  const readinessChecks: Array<{ key: CheckKey; ok: boolean; title: string; detail: string }> = [
    { key: "kyc", ok: kycOk, title: "Identity verified (KYC)", detail: kycOk ? kycMeta.label : kycMeta.description },
    {
      key: "upi",
      ok: upiOk,
      title: "Payout UPI verified",
      detail: upi?.upiId ? `${upi.upiId}${upiOk ? "" : " · waiting for verification"}` : "Add a UPI ID to receive payouts.",
    },
    {
      key: "min",
      ok: minimumOk,
      title: `${formatINR(MIN_PAYOUT_REQUEST_INR)} minimum reached`,
      detail: minimumOk ? "Your wallet balance meets the minimum." : `${formatINR(thresholdGap)} more in your wallet needed.`,
    },
    {
      key: "batch",
      ok: noActiveBatch,
      title: noActiveBatch ? "No payout in progress" : "A payout is in progress",
      detail: noActiveBatch ? "You can open a new request." : `A ${processingBatch?.status.toLowerCase()} cycle is already active.`,
    },
  ];
  const checkReady: Record<CheckKey, boolean> = { kyc: ready.kyc, upi: ready.upi, min: ready.metrics, batch: ready.batches };
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
        : blockerCode === "active_batch"
          ? "batch"
          : "min";
  const nextCheck = nextKey ? readinessChecks.find((c) => c.key === nextKey) : null;
  const nextAction = nextKey ? actionFor(nextKey) : null;

  const inputClass =
    "mt-2 h-12 w-full rounded-[14px] border border-[#dbe3d7] bg-white px-4 text-[16px] font-medium text-[#1f2e28] outline-none transition focus:border-[#8db35a] focus:ring-4 focus:ring-[#dce78f]/40";
  const card = "min-w-0 rounded-2xl border border-[#e3e5e1] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.06)]";
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
    <div className="min-h-screen bg-[#f3f4f1] text-[#1a201c]">

      <header className="sticky top-0 z-20 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto grid h-[60px] w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-3.5 sm:h-[68px] sm:px-6 lg:px-8">
          <Link
            href="/dashboard?section=wallet"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-full border border-[#e2e8de] bg-white px-3.5 text-[13px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]"
          >
            <span aria-hidden>←</span>
            <span className="hidden min-[380px]:inline">Wallet</span>
          </Link>
          <Link href="/" aria-label="Reelencer home" className="flex min-w-0 items-center gap-1.5">
            <BrandLogo className="h-8 w-8" sizes="32px" />
            <span className="hidden font-[Georgia,Times_New_Roman,serif] text-[19px] font-bold text-[#20352c] min-[400px]:inline">Reelencer</span>
          </Link>
          <Link
            href={CREATOR_HOME_HREF}
            className="inline-flex h-10 w-fit items-center justify-self-end rounded-full bg-[#41695b] px-4 text-[13px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(54,88,75,0.8)] transition hover:bg-[#35584b]"
          >
            <span className="sm:hidden">Jobs</span>
            <span className="hidden sm:inline">My jobs</span>
          </Link>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-3.5 pb-[max(3rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.6rem,6vw,2.25rem)] font-semibold leading-tight tracking-[-0.03em]">Payouts</h1>
            <p className="mt-2 text-[13px] leading-5 text-[#616a64]">Withdraw from your wallet and manage your payout settings.</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[#5f6f65]">
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${liveState === "live" ? "text-[#2f6a1f]" : liveState === "offline" ? "text-[#8a6a1f]" : "text-[#6f7d74]"}`}
                title={liveState === "live" ? "Updates appear instantly" : liveState === "offline" ? "Live updates unavailable; checking every 10 seconds" : "Connecting to live updates"}
              >
                <span className="relative flex h-2 w-2" aria-hidden>
                  {liveState === "live" ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#8db35a] opacity-60 motion-safe:animate-ping" /> : null}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${liveState === "live" ? "bg-[#5e8f35]" : liveState === "offline" ? "bg-[#d9a520]" : "bg-[#b9c0ba]"}`} />
                </span>
                {liveState === "live" ? "Live" : liveState === "offline" ? "Auto-refresh" : "Connecting"}
              </span>
              {fromSnapshot || (refreshing && !lastUpdatedAt) ? <span className="text-[#8a6a1f]">Updating…</span> : lastUpdatedAt ? <span>Synced {lastUpdatedAt}</span> : <span>Loading…</span>}
              <span className="hidden sm:inline">· {workerId ? `Worker ID ${workerId}` : "Linking your worker profile…"}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void loadPayoutData("refresh"); void socialAccounts.refresh(); }}
            disabled={refreshing || !workerId}
            aria-label={refreshing ? "Refreshing" : "Refresh"}
            className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full border border-[#dfe7dc] bg-white text-[13px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1] disabled:opacity-50 sm:w-auto sm:px-4"
          >
            <svg viewBox="0 0 24 24" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
            </svg>
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-[16px] border border-[#f1dea6] bg-[#fff8e1] px-4 py-3 text-[13.5px] font-semibold text-[#7a5200]">
            {error}
          </div>
        )}
        {notice && (
          <div
            role={notice.tone === "danger" ? "alert" : "status"}
            className={`mt-4 rounded-[16px] border px-4 py-3 text-[13.5px] font-semibold ${
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

        <div className="mt-5">
          <ReelEarningsSummary summary={reel} loading={socialAccounts.load.state === "loading"} error={socialAccounts.load.state === "error" ? socialAccounts.load.message : socialAccounts.load.state === "ready" ? socialAccounts.load.refreshError : undefined} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Payout summary">
          <MetricTile label="Available balance" value={metrics ? formatINR(approvedEarnings) : "–"} caption={failures.metrics ? "Balance could not be refreshed" : "From approved earnings"} loading={!ready.metrics} />
          <MetricTile label="Paid out" value={failures.batches && !batches.length ? "–" : formatINR(payoutSummary.credited)} caption="Lifetime" loading={!ready.batches} />
          <MetricTile label="Pending withdrawal" value={failures.batches && !batches.length ? "–" : formatINR(payoutSummary.pending)} caption="In open payout cycles" loading={!ready.batches} />
          <MetricTile label="Open payout cycles" value={failures.batches && !batches.length ? "–" : String(payoutSummary.liveBatches)} caption={`${batches.length} cycles in total`} loading={!ready.batches} />
        </div>

        <div className="mt-5 flex flex-col gap-4 sm:gap-5 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
          {/* Left column (desktop) */}
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            {/* Balance */}
            <section aria-labelledby="balance-heading" className="relative order-1 overflow-hidden rounded-2xl bg-[#244e39] p-5 text-white shadow-sm sm:p-6">
              <span className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-[#dce78f]/20 blur-3xl" />
              <div className="relative">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="balance-heading" className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/70">
                    Available to withdraw
                  </h2>
                  {upi?.upiId ? (
                    <span className="truncate rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                      {upi.payoutSchedule} · {upi.payoutDay}
                    </span>
                  ) : null}
                </div>
                {ready.metrics ? (
                  <div className="mt-1 break-words text-[clamp(2.2rem,9vw,3.25rem)] font-semibold leading-tight tracking-[-0.04em] tabular-nums">{metrics ? formatINR(approvedEarnings) : "Unavailable"}</div>
                ) : (
                  <span className="mt-2 block h-12 w-44 animate-pulse rounded-xl bg-white/15" aria-label="Loading balance" />
                )}

                {metrics ? <div className="mt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px] text-white/75">
                    <span>
                      {minimumOk ? "Minimum reached" : <>Minimum to request <span className="font-semibold text-white">{formatINR(MIN_PAYOUT_REQUEST_INR)}</span></>}
                    </span>
                    <span className="font-semibold text-[#dce78f]">{minimumOk ? "100%" : `${formatINR(thresholdGap)} to go`}</span>
                  </div>
                  <div
                    className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-white/15"
                    role="progressbar"
                    aria-valuenow={minimumProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Progress to minimum payout"
                  >
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#c7d870,#dce78f)] transition-[width] duration-700" style={{ width: `${Math.max(minimumProgress, approvedEarnings > 0 ? 3 : 0)}%` }} />
                    {[25, 50, 75].map((mark) => (
                      <span key={mark} className="absolute top-0 h-full w-px bg-[#1b3b30]/40" style={{ left: `${mark}%` }} aria-hidden />
                    ))}
                  </div>
                </div> : null}

                {hasFailures ? <div role="status" className="mt-5 rounded-xl bg-white/10 p-4 text-[13px] leading-5">Some payout details are unavailable. Refresh to verify your balance and requirements before requesting a withdrawal.</div> : !coreReady ? (
                  <div className="mt-5 flex items-center gap-3 rounded-[16px] bg-white/[0.07] p-3.5 ring-1 ring-inset ring-white/10" aria-busy="true">
                    <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/10" />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-3 w-28 animate-pulse rounded-full bg-white/15" />
                      <span className="block h-4 w-48 max-w-full animate-pulse rounded-full bg-white/10" />
                    </span>
                    <span className="text-[12px] text-white/60">Checking requirements…</span>
                  </div>
                ) : payoutReadiness.ready ? (
                  <button
                    type="button"
                    onClick={requestPayout}
                    disabled={requesting || !workerId}
                    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#dce78f] px-6 text-[15px] font-bold text-[#1b3b30] shadow-[0_10px_24px_-12px_rgba(220,231,143,0.9)] transition hover:bg-[#e6ef9f] disabled:opacity-60 min-[480px]:w-auto"
                  >
                    {requesting ? "Requesting…" : "Request payout"}
                    {!requesting && <span aria-hidden>→</span>}
                  </button>
                ) : (
                  <div className="mt-5 flex flex-col gap-3 rounded-[16px] bg-white/[0.07] p-3.5 ring-1 ring-inset ring-white/10 min-[520px]:flex-row min-[520px]:items-center">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10" aria-hidden>
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v7.5H5z" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#dce78f]">Next step · {checksDone}/{readinessChecks.length} ready</p>
                      <p className="mt-0.5 text-[14px] font-semibold">{nextCheck?.title ?? "Payout request is blocked"}</p>
                      {requestBlockedReason ? <p className="mt-0.5 text-[12.5px] leading-5 text-white/70">{requestBlockedReason}</p> : null}
                    </div>
                    {nextAction
                      ? renderAction(
                          nextAction,
                          "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[12px] bg-[#dce78f] px-4 text-[13.5px] font-bold text-[#1b3b30] transition hover:bg-[#e6ef9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        )
                      : null}
                  </div>
                )}

                {upi?.upiId ? null : ready.upi ? (
                  <p className="mt-4 border-t border-white/15 pt-3 text-[12px] text-white/65">
                    Payouts go to your UPI ID.{" "}
                    <button type="button" onClick={openUpiEditor} className="font-semibold text-[#dce78f] underline-offset-2 hover:underline">
                      Add one now
                    </button>
                  </p>
                ) : null}
              </div>
            </section>

            {/* History */}
            <section ref={historyRef} aria-labelledby="history-heading" className={`${card} order-4 scroll-mt-24 p-4 sm:p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="history-heading" className="text-[18px] font-semibold tracking-[-0.02em] sm:text-[20px]">Payout history</h2>
                  <p className="mt-0.5 text-[13px] text-[#5f6f65]">Track your withdrawals and included earnings.</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#f0f4ec] px-3 py-1 text-[12px] font-bold text-[#41695b]">{ready.batches ? batches.length : "…"}</span>
              </div>

              <div className="mt-4 grid gap-3">
                {!ready.batches &&
                  Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="rounded-[18px] border border-[#e4ebe1] bg-[#fbfcf9] p-4" aria-busy="true">
                      <Shimmer className="h-4 w-40" />
                      <Shimmer className="mt-2 h-3 w-56 max-w-full" />
                      <Shimmer className="mt-4 h-6 w-24" />
                    </div>
                  ))}
                {ready.batches && failures.batches && !batches.length ? <p role="status" className="text-sm text-[#825317]">Payout history could not be loaded. Refresh to try again.</p> : null}
                {ready.batches && !failures.batches && batches.length === 0 && (
                  <div className="flex flex-col items-center rounded-[18px] border border-dashed border-[#d9e3d6] bg-[#f8fbf5] px-5 py-8 text-center">
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
                {ready.batches && batches.slice(0, historyLimit).map((batch) => <PayoutHistoryCard key={batch.id} batch={batch} />)}
                {ready.batches && batches.length > historyLimit ? (
                  <button
                    type="button"
                    onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE * 2)}
                    className="inline-flex h-11 w-full items-center justify-center rounded-[14px] border border-[#dfe7dc] bg-white text-[13.5px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]"
                  >
                    Show {Math.min(HISTORY_PAGE * 2, batches.length - historyLimit)} more of {batches.length - historyLimit}
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          {/* Right column (desktop) */}
          <div className="contents lg:sticky lg:top-[88px] lg:flex lg:flex-col lg:gap-5">
            {/* Readiness checklist */}
            <section aria-labelledby="ready-heading" className={`${card} order-2 p-4 transition-shadow duration-500 sm:p-5 ${flash === "kyc" || flash === "upi" ? "!ring-2 !ring-[#8db35a] shadow-[0_0_0_6px_rgba(141,179,90,0.18)]" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 id="ready-heading" className="text-[17px] font-semibold tracking-[-0.02em] sm:text-[18px]">Ready to request?</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${
                    payoutReadiness.ready ? "bg-[#e3f1d6] text-[#2f6a1f]" : "bg-[#fff4d6] text-[#8a5a00]"
                  }`}
                >
                  {coreReady ? `${checksDone}/${readinessChecks.length} done` : "Checking…"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1" aria-hidden>
                {readinessChecks.map((check, index) => (
                  <span key={check.key} className={`h-1.5 rounded-full transition-colors duration-500 ${!coreReady ? "animate-pulse bg-[#eef1ea]" : index < checksDone ? "bg-[#8db35a]" : "bg-[#ece6d2]"}`} />
                ))}
              </div>
              <ul className="mt-3 grid gap-2">
                {readinessChecks.map((check) => {
                  if (!checkReady[check.key]) {
                    return (
                      <li key={check.key} className="flex items-start gap-3 rounded-[14px] bg-[#f8faf5] px-3 py-2.5" aria-busy="true">
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
                      />
                    );
                  }
                  const action = actionFor(check.key);
                  const isNext = check.key === nextKey;
                  return (
                    <li
                      key={check.key}
                      className={`flex items-start gap-3 rounded-[14px] px-3 py-2.5 transition ${
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

            {/* UPI */}
            <section
              ref={upiSectionRef}
              aria-labelledby="upi-heading"
              className={`${card} order-3 scroll-mt-24 p-4 transition-shadow duration-500 sm:p-5 ${flash === "upi" ? "!ring-2 !ring-[#8db35a] shadow-[0_0_0_6px_rgba(141,179,90,0.18)]" : ""}`}
            >
              {(() => {
                const state = !ready.upi ? "loading" : failures.upi ? "unavailable" : !upi?.upiId ? "none" : upiOk ? "verified" : "pending";
                const chip = {
                  unavailable: { text: "Unavailable", className: "bg-[#fff4d6] text-[#8a5a00] ring-[#f1dea6]" },
                  loading: { text: "…", className: "bg-[#f3f4f1] text-[#6f7d74] ring-[#e6ebe2]" },
                  none: { text: "Not added", className: "bg-[#fff4d6] text-[#8a5a00] ring-[#f1dea6]" },
                  pending: { text: "Verifying", className: "bg-[#eef4fb] text-[#1f5fa8] ring-[#cfe0f5]" },
                  verified: { text: "✓ Verified", className: "bg-[#e3f1d6] text-[#2f6a1f] ring-[#c6e0b0]" },
                }[state];
                const step = state === "verified" ? 3 : state === "pending" ? 1 : 0;
                return (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[11.5px] font-black tracking-tight ${
                            state === "verified" ? "bg-[#41695b] text-white" : "bg-[#f0f4ec] text-[#41695b]"
                          }`}
                          aria-hidden
                        >
                          UPI
                        </span>
                        <div className="min-w-0">
                          <h2 id="upi-heading" className="text-[12.5px] font-semibold text-[#5f6f65]">
                            Payout UPI
                          </h2>
                          {state === "loading" ? (
                            <Shimmer className="mt-1 h-5 w-40" />
                          ) : (
                            <div className={`break-all text-[16px] font-semibold leading-snug ${state === "none" ? "text-[#8a948d]" : "text-[#20352c]"}`}>{upi?.upiId || "Not added yet"}</div>
                          )}
                          {upi?.upiId ? <div className="mt-0.5 text-[12px] text-[#5f6f65]">{scheduleLabel(upi.payoutSchedule, upi.payoutDay)}</div> : null}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${chip.className}`} aria-live="polite">
                        {chip.text}
                      </span>
                    </div>

                    {/* Live status */}
                    {state === "pending" ? (
                      <div className="mt-4 rounded-[14px] bg-[#f3f7fc] p-3 ring-1 ring-inset ring-[#dbe7f5]">
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-[#1d4f8f]">
                          <span className="relative flex h-2 w-2" aria-hidden>
                            <span className="absolute inline-flex h-full w-full rounded-full bg-[#7fb0e6] opacity-60 motion-safe:animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2a78d6]" />
                          </span>
                          Waiting for the team to verify
                        </p>
                        <p className="mt-0.5 text-[12px] leading-5 text-[#4f6476]">
                          {sinceLabel(upi?.updatedAt) ? `Saved ${sinceLabel(upi?.updatedAt)}. ` : ""}
                          {liveState === "live" ? "This card updates the moment it's verified." : "We check for the result automatically."}
                        </p>
                        <ol className="mt-2.5 grid grid-cols-3 gap-1.5" aria-label="UPI verification progress">
                          {["Saved", "Team check", "Verified"].map((label, index) => {
                            const done = index < step;
                            const current = index === step;
                            return (
                              <li key={label} className="min-w-0">
                                <span className={`block h-1 rounded-full ${done ? "bg-[#8db35a]" : current ? "bg-[#7fb0e6] motion-safe:animate-pulse" : "bg-[#dfe6ee]"}`} />
                                <span className={`mt-1 block truncate text-[10.5px] ${done || current ? "font-semibold text-[#3f5566]" : "text-[#9aa6b1]"}`} aria-current={current ? "step" : undefined}>
                                  {label}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : state === "verified" ? (
                      <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[#2f6a1f]">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#8db35a] text-[11px] text-white" aria-hidden>
                          ✓
                        </span>
                        Verified{upi?.verifiedAt ? ` ${sinceLabel(upi.verifiedAt)}` : ""}. Payouts go to this UPI ID.
                      </p>
                    ) : state === "none" ? (
                      <p className="mt-3 text-[12.5px] leading-5 text-[#5f6f65]">Add the UPI ID where you want payouts sent. The team verifies it once, usually within a day.</p>
                    ) : null}

                    {processingBatch && upi?.upiId ? (
                      <p className="mt-3 flex gap-2 rounded-[12px] bg-[#fff8e8] px-3 py-2 text-[12px] leading-5 text-[#7a5200]">
                        <span aria-hidden>🔒</span>
                        Your UPI ID is locked while a payout is in progress. You can still change the schedule.
                      </p>
                    ) : null}
                  </>
                );
              })()}

              <button
                type="button"
                onClick={() => {
                  setUpiDraft(upi ?? DEFAULT_UPI);
                  setUpiError(null);
                  setUpiEditorOpen((prev) => !prev);
                }}
                aria-expanded={upiEditorOpen}
                disabled={!ready.upi}
                className={`mt-4 inline-flex h-11 w-full items-center justify-center rounded-[14px] text-[14px] font-semibold transition disabled:opacity-50 ${
                  !upi?.upiId && !upiEditorOpen ? "bg-[#41695b] text-white hover:bg-[#35584b]" : "border border-[#dfe7dc] bg-white text-[#41695b] hover:bg-[#f4f7f1]"
                }`}
              >
                {upiEditorOpen ? "Close" : upi?.upiId ? "Change UPI or schedule" : "Add payout UPI"}
              </button>

              {upiEditorOpen && (
                <div className="mt-4 space-y-4 rounded-[18px] bg-[#f8faf5] p-4 ring-1 ring-[#e8eee5]">
                  <label className="block">
                    <span className="text-[13px] font-semibold text-[#274537]">UPI ID</span>
                    <span className="relative mt-2 block">
                      <input
                        value={upiDraft.upiId}
                        onChange={(e) => {
                          setUpiError(null);
                          setUpiDraft((prev) => ({ ...prev, upiId: e.target.value }));
                        }}
                        placeholder="yourname@okhdfcbank"
                        inputMode="email"
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                        disabled={Boolean(processingBatch)}
                        aria-invalid={Boolean(upiDraft.upiId) && !isValidUpi(upiDraft.upiId)}
                        className={`${inputClass.replace("mt-2 ", "")} pr-11 disabled:bg-[#f3f4f1] disabled:text-[#7a827c]`}
                      />
                      {upiDraft.upiId ? (
                        <span
                          className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-bold ${isValidUpi(upiDraft.upiId) ? "text-[#5e8f35]" : "text-[#c26a1a]"}`}
                          aria-hidden
                        >
                          {isValidUpi(upiDraft.upiId) ? "✓" : "!"}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[12px] text-[#6f7d74]">
                      {processingBatch
                        ? "Locked while a payout is in progress."
                        : upiDraft.upiId.trim() && upiDraft.upiId.trim() !== (upi?.upiId ?? "")
                          ? "A new UPI ID needs a quick verification by the team before payouts use it."
                          : "Find it in your UPI app's profile, e.g. name@okicici."}
                    </span>
                  </label>

                  <div>
                    <span className="text-[13px] font-semibold text-[#274537]">Payout schedule</span>
                    <div role="radiogroup" aria-label="Payout schedule" className="mt-2 grid grid-cols-2 gap-1 rounded-[14px] bg-white p-1 ring-1 ring-[#dbe3d7]">
                      {(["Weekly", "Monthly"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={upiDraft.payoutSchedule === option}
                          onClick={() => {
                            setUpiError(null);
                            setUpiDraft((prev) =>
                              prev.payoutSchedule === option ? prev : { ...prev, payoutSchedule: option, payoutDay: option === "Monthly" ? "1" : "Fri" }
                            );
                          }}
                          className={`h-10 rounded-[10px] text-[13.5px] font-semibold transition ${
                            upiDraft.payoutSchedule === option ? "bg-[#41695b] text-white shadow-sm" : "text-[#41695b] hover:bg-[#f4f7f1]"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[13px] font-semibold text-[#274537]">{upiDraft.payoutSchedule === "Monthly" ? "Day of the month" : "Day of the week"}</span>
                    {upiDraft.payoutSchedule === "Monthly" ? (
                      <select
                        value={upiDraft.payoutDay}
                        onChange={(e) => {
                          setUpiError(null);
                          setUpiDraft((prev) => ({ ...prev, payoutDay: e.target.value }));
                        }}
                        className={`${inputClass} mt-2`}
                        aria-label="Day of the month"
                      >
                        {MONTH_DAYS.map((day) => (
                          <option key={day} value={day}>
                            {ordinal(Number(day))}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div role="radiogroup" aria-label="Day of the week" className="mt-2 grid grid-cols-7 gap-1">
                        {WEEK_DAYS.map((day) => (
                          <button
                            key={day}
                            type="button"
                            role="radio"
                            aria-checked={upiDraft.payoutDay === day}
                            aria-label={WEEK_DAY_NAMES[day]}
                            onClick={() => {
                              setUpiError(null);
                              setUpiDraft((prev) => ({ ...prev, payoutDay: day }));
                            }}
                            className={`h-10 rounded-[10px] text-[12px] font-semibold transition ${
                              upiDraft.payoutDay === day ? "bg-[#41695b] text-white" : "bg-white text-[#41695b] ring-1 ring-inset ring-[#dbe3d7] hover:bg-[#f4f7f1]"
                            }`}
                          >
                            {day.slice(0, 2)}
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="mt-1.5 block text-[12px] text-[#6f7d74]">{scheduleLabel(upiDraft.payoutSchedule, upiDraft.payoutDay)}. Schedule changes apply right away.</span>
                  </div>

                  {upiError && (
                    <div role="alert" className="rounded-[12px] border border-[#f6cdc8] bg-[#fdecea] px-3 py-2 text-[13px] font-semibold text-[#b42318]">
                      {upiError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-[1fr_auto]">
                    <button
                      type="button"
                      onClick={() => void saveAndVerifyUpi()}
                      disabled={savingUpi || !isValidUpi(upiDraft.upiId) || (upiDraft.upiId.trim() === (upi?.upiId ?? "") && upiDraft.payoutSchedule === upi?.payoutSchedule && upiDraft.payoutDay === upi?.payoutDay)}
                      className="inline-flex h-11 items-center justify-center rounded-[14px] bg-[#41695b] px-5 text-[14px] font-semibold text-white transition hover:bg-[#35584b] disabled:opacity-50"
                    >
                      {savingUpi ? "Saving…" : upiDraft.upiId.trim() !== (upi?.upiId ?? "") ? "Save and send for verification" : "Save schedule"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUpiDraft(upi ?? DEFAULT_UPI);
                        setUpiError(null);
                        setUpiEditorOpen(false);
                      }}
                      className="inline-flex h-11 items-center justify-center rounded-[14px] border border-[#dfe7dc] bg-white px-5 text-[14px] font-semibold text-[#41695b]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Guidance */}
            <details className={`${card} group order-5 p-4 sm:p-5`} open={ready.batches && batches.length === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <h2 className="text-[17px] font-semibold tracking-[-0.02em] sm:text-[18px]">How payouts work</h2>
                <span className="text-[#7a8a80] transition-transform group-open:rotate-180" aria-hidden>
                  ▾
                </span>
              </summary>
              <ol className="relative mt-3 grid gap-3">
                <span className="absolute bottom-3 left-3 top-3 w-px bg-[#dfe7dc]" aria-hidden />
                {[
                  { title: "Earn", text: "Approved reels and work become payout-eligible after the team's review." },
                  { title: "Review", text: "Reel approval credits reviewed earnings to your wallet automatically. New views still need review." },
                  { title: "Request", text: `Once your wallet reaches ${formatINR(MIN_PAYOUT_REQUEST_INR)} with KYC and UPI verified, request a payout.` },
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
