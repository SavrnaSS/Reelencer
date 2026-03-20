"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };
type UpiSchedule = "Weekly" | "Bi-weekly" | "Monthly";
type PayoutDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
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
  };
  sla?: {
    met?: number;
    breached?: number;
  };
};

type GigAssignment = {
  gigId?: string;
  status?: string;
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
};

type GigSummary = {
  id: string;
  payout?: string | null;
};

type UpiConfig = {
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  payoutSchedule: UpiSchedule;
  payoutDay: PayoutDay;
};

type PayoutItem = {
  id: string;
  workItemId: string;
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
};

const MIN_PAYOUT_REQUEST_INR = 1000;

const LS_KEYS = {
  AUTH: "igops:auth",
} as const;

const DEFAULT_UPI: UpiConfig = {
  upiId: "",
  verified: false,
  payoutSchedule: "Weekly",
  payoutDay: "Fri",
};

const PAYOUT_DAYS: PayoutDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function formatINR(value: number) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${value}`;
  }
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function batchTotal(batch: PayoutBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

function isValidUpi(upi: string) {
  const text = String(upi ?? "").trim();
  if (!text.includes("@")) return false;
  const [name, provider] = text.split("@");
  return !!name && !!provider && name.length >= 2 && provider.length >= 2;
}

function parsePayoutAmount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[, ]+/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function summarizeCredentialEarnings(assignments: GigAssignment[], gigs: GigSummary[]) {
  const payoutByGigId = new Map<string, number>(
    gigs.map((gig) => [String(gig.id), parsePayoutAmount(gig.payout)])
  );

  return assignments.reduce(
    (totals, assignment) => {
      const amount = payoutByGigId.get(String(assignment.gigId ?? "")) ?? 0;
      if (!amount) return totals;

      if (assignment.earningsReleaseStatus === "credited") {
        totals.earnings += amount;
        return totals;
      }

      if (
        assignment.earningsReleaseStatus === "queued" ||
        ["Submitted", "Accepted", "Pending"].includes(String(assignment.status ?? ""))
      ) {
        totals.pending += amount;
      }

      return totals;
    },
    { earnings: 0, pending: 0 }
  );
}

export default function PayoutsPage() {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(null);
  const [upi, setUpi] = useState<UpiConfig | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [upiEditorOpen, setUpiEditorOpen] = useState(false);
  const [upiDraft, setUpiDraft] = useState<UpiConfig>(DEFAULT_UPI);
  const [savingUpi, setSavingUpi] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);

  useEffect(() => {
    const session = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setRole(session?.role ?? null);
    setWorkerId(session?.workerId ?? null);
    setSessionLoaded(true);
    void supabase.auth.getUser().then(({ data }) => {
      setAuthUserId(data.user?.id ?? null);
    });
  }, []);

  const loadPayoutData = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (loadInFlightRef.current && mode !== "initial") return;
    if (!workerId) {
      setLoading(false);
      return;
    }

    loadInFlightRef.current = true;
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const [metricsResult, batchesResult, upiResult, assignmentsResult] = await Promise.allSettled([
        fetch(`/api/metrics/worker?workerId=${encodeURIComponent(workerId)}`, { method: "GET", cache: "no-store" }),
        fetch(`/api/payoutbatches?workerId=${encodeURIComponent(workerId)}`, { method: "GET", cache: "no-store" }),
        token
          ? fetch("/api/upi", { method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          : Promise.resolve(null),
        fetch(`/api/gig-assignments?workerId=${encodeURIComponent(workerId)}`, { method: "GET", cache: "no-store" }),
      ]);

      const issues: string[] = [];
      let credentialFallback = { earnings: 0, pending: 0 };

      if (assignmentsResult.status === "fulfilled" && assignmentsResult.value.ok) {
        const assignmentsJson = (await assignmentsResult.value.json().catch(() => [])) as GigAssignment[];
        const gigIds = Array.from(new Set((Array.isArray(assignmentsJson) ? assignmentsJson : []).map((row) => String(row.gigId ?? "")).filter(Boolean)));
        if (gigIds.length > 0) {
          const gigsRes = await fetch("/api/gigs", { method: "GET", cache: "no-store" });
          if (gigsRes.ok) {
            const gigsJson = (await gigsRes.json().catch(() => [])) as GigSummary[];
            const relevantGigs = (Array.isArray(gigsJson) ? gigsJson : []).filter((gig) => gigIds.includes(String(gig.id)));
            credentialFallback = summarizeCredentialEarnings(Array.isArray(assignmentsJson) ? assignmentsJson : [], relevantGigs);
          }
        }
      }

      if (metricsResult.status === "fulfilled") {
        if (metricsResult.value.ok) {
          const metricsJson = await metricsResult.value.json();
          const mergedMetrics = {
            ...(metricsJson ?? {}),
            money: {
              ...(metricsJson?.money ?? {}),
              earnings: Math.max(Number(metricsJson?.money?.earnings ?? 0), credentialFallback.earnings),
              pending: Math.max(Number(metricsJson?.money?.pending ?? 0), credentialFallback.pending),
            },
          };
          setMetrics(mergedMetrics);
        } else {
          if (credentialFallback.earnings > 0 || credentialFallback.pending > 0) {
            setMetrics({
              money: {
                earnings: credentialFallback.earnings,
                pending: credentialFallback.pending,
              },
            });
          } else {
            issues.push("earnings metrics");
          }
        }
      } else {
        if (credentialFallback.earnings > 0 || credentialFallback.pending > 0) {
          setMetrics({
            money: {
              earnings: credentialFallback.earnings,
              pending: credentialFallback.pending,
            },
          });
        } else {
          issues.push("earnings metrics");
        }
      }

      if (batchesResult.status === "fulfilled") {
        if (batchesResult.value.ok) {
          const batchesJson = await batchesResult.value.json();
          setBatches(Array.isArray(batchesJson) ? batchesJson : []);
        } else {
          issues.push("payout batches");
        }
      } else {
        issues.push("payout batches");
      }

      if (upiResult.status === "fulfilled" && upiResult.value) {
        if (upiResult.value.ok) {
          const upiJson = await upiResult.value.json();
          setUpi(upiJson ?? null);
        } else {
          issues.push("UPI status");
        }
      } else if (upiResult.status === "rejected") {
        issues.push("UPI status");
      }

      setLastUpdatedAt(new Date().toLocaleTimeString());
      if (issues.length > 0) {
        setError(`Some payout data could not be refreshed: ${issues.join(", ")}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load payout data.");
    } finally {
      loadInFlightRef.current = false;
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, [workerId]);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!role) {
      window.location.replace("/login?next=/payouts");
      return;
    }
    if (role === "Admin") {
      window.location.replace("/admin");
      return;
    }
    void loadPayoutData("initial");
  }, [loadPayoutData, role, sessionLoaded]);

  const realtimeWorkerIds = useMemo(
    () => Array.from(new Set([workerId, authUserId].filter(Boolean) as string[])),
    [authUserId, workerId]
  );

  useEffect(() => {
    if (!sessionLoaded || role !== "Worker" || realtimeWorkerIds.length === 0) return;

    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadPayoutData("refresh");
      }, 500);
    };

    const channels = realtimeWorkerIds.flatMap((id) => [
      supabase.channel(`payout-batches-${id}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payout_batches", filter: `worker_id=eq.${id}` },
        scheduleRefresh
      ),
      supabase.channel(`payout-items-${id}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payout_items", filter: `worker_id=eq.${id}` },
        scheduleRefresh
      ),
      supabase.channel(`work-items-${id}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_items", filter: `worker_id=eq.${id}` },
        scheduleRefresh
      ),
      supabase.channel(`upi-configs-${id}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upi_configs", filter: `worker_id=eq.${id}` },
        scheduleRefresh
      ),
    ]);

    channels.forEach((channel) => channel.subscribe());

    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadPayoutData("refresh");
    };
    document.addEventListener("visibilitychange", onVisibility);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPayoutData("refresh");
    }, 30000);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [loadPayoutData, realtimeWorkerIds, role, sessionLoaded]);

  useEffect(() => {
    setUpiDraft(upi ?? DEFAULT_UPI);
  }, [upi]);

  const approvedEarnings = metrics?.money?.earnings ?? 0;
  const pendingPayouts = metrics?.money?.pending ?? 0;
  const paidBatches = useMemo(() => batches.filter((batch) => batch.status === "Paid").length, [batches]);
  const processingBatch = useMemo(() => batches.find((batch) => batch.status === "Processing" || batch.status === "Draft") ?? null, [batches]);
  const totalPaidAmount = useMemo(
    () => batches.filter((batch) => batch.status === "Paid").reduce((sum, batch) => sum + batchTotal(batch), 0),
    [batches]
  );
  const requestBlockedReason = !upi?.verified
    ? "Verify UPI in workspace before requesting payout."
    : processingBatch
      ? "A payout batch is already active."
      : approvedEarnings < MIN_PAYOUT_REQUEST_INR
        ? `A minimum approved earnings balance of ${formatINR(MIN_PAYOUT_REQUEST_INR)} is required before a payout request can be submitted.`
        : approvedEarnings <= 0
          ? "No approved earnings are available yet."
          : null;
  const thresholdGap = Math.max(0, MIN_PAYOUT_REQUEST_INR - approvedEarnings);

  const requestPayout = async () => {
    if (!workerId) return;
    setRequesting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/payoutbatches/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setUpiError("Enter a valid UPI ID like name@bank before saving.");
      return;
    }

    setSavingUpi(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const payload: UpiConfig = {
        ...upiDraft,
        upiId: upiDraft.upiId.trim(),
        verified: true,
        verifiedAt: new Date().toISOString(),
      };

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
      setNotice({ tone: "success", text: "UPI payout configuration updated and verified." });
      await loadPayoutData("refresh");
    } catch (err) {
      setUpiError(err instanceof Error ? err.message : "Unable to update UPI configuration.");
    } finally {
      setSavingUpi(false);
    }
  };

  if (!sessionLoaded || loading) {
    return (
      <div className="min-h-screen bg-[#eef4ea] text-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#cdd9cd] bg-white px-3 py-1 text-xs font-semibold text-[#486455] shadow-sm">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#c3d1c3] border-t-[#1f4f43]" />
            Loading payout data...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef4ea] text-slate-900">
      <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(220,233,222,0.95),transparent_38%)]">
        <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f877d]">Payout Ledger</div>
              <h1 className="mt-1 text-[1.9rem] font-semibold leading-tight tracking-tight text-[#1c3e33] sm:text-[2.35rem]">
                Worker payouts
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5c7368]">
                Review approved earnings, payout batches, and request the next payout cycle from one dedicated worker page.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/browse" className="rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]">
                Browse gigs
              </Link>
              <Link href="/workspace" className="rounded-full bg-[#1f4f43] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2d6b5a]">
                Workspace
              </Link>
            </div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-[#5c7368]">
              {workerId ? `Worker ID: ${workerId}` : "Worker profile is still being resolved."}
              {lastUpdatedAt && <span className="ml-2 text-[#7b8f84]">Last synced at {lastUpdatedAt}</span>}
            </div>
            <button
              type="button"
              onClick={() => void loadPayoutData("refresh")}
              disabled={refreshing || !workerId}
              className="inline-flex items-center justify-center rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1] disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "Refresh ledger"}
            </button>
          </div>
          {error && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error}</div>}
          {notice && (
            <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {notice.text}
            </div>
          )}

          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Approved earnings", value: formatINR(approvedEarnings), detail: "Live from approved work" },
              { label: "Pending payouts", value: formatINR(pendingPayouts), detail: "Submitted awaiting admin" },
              { label: "Payout batches", value: String(batches.length), detail: "Your payout cycles" },
              { label: "Paid batches", value: String(paidBatches), detail: paidBatches > 0 ? `${formatINR(totalPaidAmount)} released` : "Completed successfully" },
            ].map((item) => (
              <div key={item.label} className="rounded-[1.2rem] border border-[#cfdbc8] bg-white/90 px-4 py-3 shadow-lg shadow-[#d6dfd2]/35 backdrop-blur sm:rounded-[1.4rem] sm:px-5 sm:py-5">
                <span className="inline-flex rounded-full border border-[#d9e4de] bg-[#f3f8f2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#597568]">
                  {item.label}
                </span>
                <div className="mt-4 text-[2rem] font-semibold leading-none tracking-tight text-[#1c3e33] sm:text-4xl">{item.value}</div>
                <div className="mt-2 text-xs leading-5 text-[#71887c]">{item.detail}</div>
              </div>
            ))}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <div className="space-y-6">
              <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Payout batches</div>
                    <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">Cycle history</div>
                    <div className="mt-1 text-sm leading-6 text-[#5c7368]">Admin-created payout batches and their current release status.</div>
                  </div>
                  {processingBatch && (
                    <span className="inline-flex rounded-full border border-[#cfe0d4] bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                      {processingBatch.status} in progress
                    </span>
                  )}
                </div>

                <div className="mt-5 space-y-3.5">
                  {batches.length === 0 && (
                    <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-5 text-sm text-[#5f6f66]">
                      No payout batches yet. Approved work will appear here once a payout cycle is created.
                    </div>
                  )}
                  {batches.map((batch) => (
                    <article key={batch.id} className="rounded-2xl border border-[#d9e4de] bg-[#f9fcf8] p-4 shadow-[0_10px_24px_rgba(172,190,176,0.16)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-[1.02rem] font-semibold leading-tight text-[#23352d] sm:text-[1.08rem]">{batch.cycleLabel}</div>
                          <div className="mt-1 text-xs leading-5 text-[#6a7f73]">
                            {batch.periodStart} to {batch.periodEnd} • {batch.method}
                          </div>
                        </div>
                        <span className="self-start rounded-full border border-[#cfe0d4] bg-white px-3 py-1 text-xs font-semibold text-[#315f50]">
                          {batch.status}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-[#70857a] sm:grid-cols-3">
                        <div className="rounded-xl border border-[#e1e8e0] bg-white px-3 py-2">Amount: {formatINR(batchTotal(batch))}</div>
                        <div className="rounded-xl border border-[#e1e8e0] bg-white px-3 py-2">Items: {batch.items.length}</div>
                        <div className="rounded-xl border border-[#e1e8e0] bg-white px-3 py-2">Created: {fmtDate(batch.createdAt)}</div>
                      </div>
                      {batch.items.length > 0 && (
                        <div className="mt-3 rounded-xl border border-[#e1e8e0] bg-white px-3 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Included items</div>
                          <div className="mt-2 grid gap-2">
                            {batch.items.slice(0, 4).map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 text-sm text-[#385449]">
                                <span className="truncate">{item.handle || item.workItemId}</span>
                                <span className="shrink-0 font-semibold">{formatINR(item.amountINR)}</span>
                              </div>
                            ))}
                            {batch.items.length > 4 && <div className="text-xs text-[#70857a]">+{batch.items.length - 4} more items</div>}
                          </div>
                        </div>
                      )}
                      {batch.notes?.length > 0 && (
                        <div className="mt-3 rounded-xl border border-[#e1e8e0] bg-white px-3 py-2 text-xs text-[#6b8175]">
                          {batch.notes.join(" • ")}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Request payout</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">Current payout readiness</div>
                <div className="mt-5 space-y-3 text-sm text-[#5c7368]">
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">UPI status</div>
                    <div className="mt-2 text-base font-semibold text-[#274537]">{upi?.verified ? "Verified" : "Not verified"}</div>
                    <div className="mt-1 text-sm text-[#617166]">
                      {upi?.upiId ? `${upi.upiId} • ${upi.payoutSchedule} • ${upi.payoutDay}` : "Add and verify a payout UPI ID before requesting funds."}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">Pending batch</div>
                    <div className="mt-2 text-base font-semibold text-[#274537]">{processingBatch ? processingBatch.status : "No active request"}</div>
                    <div className="mt-1 text-sm text-[#617166]">
                      {processingBatch ? "A payout cycle is already active for your account." : "You can request a payout for approved items when eligible."}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">Release threshold</div>
                    <div className="mt-2 text-base font-semibold text-[#274537]">{formatINR(MIN_PAYOUT_REQUEST_INR)} minimum</div>
                    <div className="mt-1 text-sm text-[#617166]">
                      {approvedEarnings >= MIN_PAYOUT_REQUEST_INR
                        ? "Your approved balance meets the minimum request threshold."
                        : `${formatINR(thresholdGap)} more in approved earnings is needed before the payout request can be opened.`}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">Eligible amount</div>
                    <div className="mt-2 text-base font-semibold text-[#274537]">{formatINR(approvedEarnings)}</div>
                    <div className="mt-1 text-sm text-[#617166]">
                      Approved work not yet released into a paid batch becomes requestable once the minimum threshold is met.
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={requestPayout}
                    disabled={requesting || !workerId || !!requestBlockedReason}
                    className="inline-flex items-center justify-center rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d6b5a] disabled:opacity-50"
                  >
                    {requesting ? "Requesting..." : "Request payout"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUpiDraft(upi ?? DEFAULT_UPI);
                      setUpiError(null);
                      setUpiEditorOpen((prev) => !prev);
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-[#c9d3c4] bg-white px-5 py-2.5 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]"
                  >
                    {upiEditorOpen ? "Close UPI manager" : "Manage payout UPI"}
                  </button>
                </div>
                {requestBlockedReason && <div className="mt-3 text-sm font-medium text-[#6a7f73]">{requestBlockedReason}</div>}
                {upiEditorOpen && (
                  <div className="mt-5 rounded-[1.4rem] border border-[#d9e4de] bg-[#f7fbf8] p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Payout UPI manager</div>
                        <div className="mt-1 text-lg font-semibold text-[#234538]">Update payout address and release schedule</div>
                        <div className="mt-1 text-sm text-[#617166]">Changing the UPI or schedule requires a fresh verification before the next release cycle.</div>
                      </div>
                      {upi?.verified && upi?.verifiedAt && (
                        <span className="self-start rounded-full border border-[#cfe0d4] bg-white px-3 py-1 text-xs font-semibold text-[#2f6655]">
                          Verified {fmtDate(upi.verifiedAt)}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="text-sm font-semibold text-[#274537]">UPI ID</div>
                        <input
                          value={upiDraft.upiId}
                          onChange={(e) => {
                            setUpiError(null);
                            setUpiDraft((prev) => ({ ...prev, upiId: e.target.value, verified: false, verifiedAt: undefined }));
                          }}
                          placeholder="name@bank"
                          className="mt-2 w-full rounded-2xl border border-[#cdd9cd] bg-white px-4 py-3 text-sm font-medium text-[#1f2e28] outline-none transition focus:border-[#9cb6aa] focus:ring-2 focus:ring-[#dce7df]"
                        />
                        <div className="mt-2 text-xs text-[#738476]">Use the payout UPI where admin releases should settle for your wallet.</div>
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <div className="text-sm font-semibold text-[#274537]">Schedule</div>
                          <select
                            value={upiDraft.payoutSchedule}
                            onChange={(e) => {
                              setUpiError(null);
                              setUpiDraft((prev) => ({ ...prev, payoutSchedule: e.target.value as UpiSchedule, verified: false, verifiedAt: undefined }));
                            }}
                            className="mt-2 w-full rounded-2xl border border-[#cdd9cd] bg-white px-4 py-3 text-sm font-medium text-[#1f2e28] outline-none transition focus:border-[#9cb6aa] focus:ring-2 focus:ring-[#dce7df]"
                          >
                            <option value="Weekly">Weekly</option>
                            <option value="Bi-weekly">Bi-weekly</option>
                            <option value="Monthly">Monthly</option>
                          </select>
                        </label>

                        <label className="block">
                          <div className="text-sm font-semibold text-[#274537]">Payout day</div>
                          <select
                            value={upiDraft.payoutDay}
                            onChange={(e) => {
                              setUpiError(null);
                              setUpiDraft((prev) => ({ ...prev, payoutDay: e.target.value as PayoutDay, verified: false, verifiedAt: undefined }));
                            }}
                            className="mt-2 w-full rounded-2xl border border-[#cdd9cd] bg-white px-4 py-3 text-sm font-medium text-[#1f2e28] outline-none transition focus:border-[#9cb6aa] focus:ring-2 focus:ring-[#dce7df]"
                          >
                            {PAYOUT_DAYS.map((day) => (
                              <option key={day} value={day}>
                                {day}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-[#d9e4de] bg-white px-4 py-3 text-sm text-[#5f7267]">
                      Saving here updates the worker payout profile directly for this account. The new UPI details become the source of truth for future payout cycles.
                    </div>

                    {upiError && <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{upiError}</div>}

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void saveAndVerifyUpi()}
                        disabled={savingUpi}
                        className="inline-flex items-center justify-center rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d6b5a] disabled:opacity-50"
                      >
                        {savingUpi ? "Saving..." : "Save and verify UPI"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUpiDraft(upi ?? DEFAULT_UPI);
                          setUpiError(null);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-[#c9d3c4] bg-white px-5 py-2.5 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]"
                      >
                        Reset changes
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Payout guidance</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">How release works</div>
                <div className="mt-5 space-y-3 text-sm text-[#5c7368]">
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    Approved work becomes payout-eligible after admin review.
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    A minimum approved earnings balance of {formatINR(MIN_PAYOUT_REQUEST_INR)} is required before payout requests can be submitted.
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    Requests stay pending until admin approves and marks the batch as paid.
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    UPI verification is required before payout requests can move into processing.
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
