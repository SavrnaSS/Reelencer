"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };
type UpiSchedule = "Weekly" | "Bi-weekly" | "Monthly";
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

type UpiConfig = {
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  payoutSchedule: UpiSchedule;
  payoutDay: string;
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

const LS_KEYS = {
  AUTH: "igops:auth",
} as const;

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

export default function PayoutsPage() {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(null);
  const [upi, setUpi] = useState<UpiConfig | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const session = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setRole(session?.role ?? null);
    setWorkerId(session?.workerId ?? null);
    setSessionLoaded(true);
  }, []);

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
    if (!workerId) {
      setLoading(false);
      return;
    }

    let alive = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const [metricsRes, batchesRes, upiRes] = await Promise.all([
          fetch(`/api/metrics/worker?workerId=${encodeURIComponent(workerId)}`, { method: "GET" }),
          fetch(`/api/payoutbatches?workerId=${encodeURIComponent(workerId)}`, { method: "GET" }),
          token
            ? fetch("/api/upi", { method: "GET", headers: { Authorization: `Bearer ${token}` } })
            : Promise.resolve(null),
        ]);

        if (!alive) return;
        if (!metricsRes.ok || !batchesRes.ok) {
          throw new Error("Unable to load payout data right now.");
        }

        const metricsJson = await metricsRes.json();
        const batchesJson = await batchesRes.json();
        const upiJson = upiRes && upiRes.ok ? await upiRes.json() : null;

        if (!alive) return;
        setMetrics(metricsJson ?? null);
        setBatches(Array.isArray(batchesJson) ? batchesJson : []);
        setUpi(upiJson ?? null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Unable to load payout data.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [role, sessionLoaded, workerId]);

  const approvedEarnings = metrics?.money?.earnings ?? 0;
  const pendingPayouts = metrics?.money?.pending ?? 0;
  const paidBatches = useMemo(() => batches.filter((batch) => batch.status === "Paid").length, [batches]);
  const processingBatch = useMemo(() => batches.find((batch) => batch.status === "Processing" || batch.status === "Draft") ?? null, [batches]);

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
      const refresh = await fetch(`/api/payoutbatches?workerId=${encodeURIComponent(workerId)}`, { method: "GET" });
      if (refresh.ok) {
        const data = await refresh.json();
        setBatches(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof Error ? err.message : "Unable to request payout." });
    } finally {
      setRequesting(false);
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
          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>}
          {notice && (
            <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {notice.text}
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Approved earnings", value: formatINR(approvedEarnings), detail: "Live from approved work" },
              { label: "Pending payouts", value: formatINR(pendingPayouts), detail: "Submitted awaiting admin" },
              { label: "Payout batches", value: String(batches.length), detail: "Your payout cycles" },
              { label: "Paid batches", value: String(paidBatches), detail: "Completed successfully" },
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
                      {upi?.upiId ? `${upi.upiId} • ${upi.payoutSchedule} • ${upi.payoutDay}` : "Configure and verify UPI in workspace before requesting payout."}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">Pending batch</div>
                    <div className="mt-2 text-base font-semibold text-[#274537]">{processingBatch ? processingBatch.status : "No active request"}</div>
                    <div className="mt-1 text-sm text-[#617166]">
                      {processingBatch ? "A payout cycle is already active for your account." : "You can request a payout for approved items when eligible."}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={requestPayout}
                    disabled={requesting || !workerId || !upi?.verified}
                    className="inline-flex items-center justify-center rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d6b5a] disabled:opacity-50"
                  >
                    {requesting ? "Requesting..." : "Request payout"}
                  </button>
                  <Link href="/workspace" className="inline-flex items-center justify-center rounded-full border border-[#c9d3c4] bg-white px-5 py-2.5 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]">
                    Configure UPI in workspace
                  </Link>
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Payout guidance</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">How release works</div>
                <div className="mt-5 space-y-3 text-sm text-[#5c7368]">
                  <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-3">
                    Approved work becomes payout-eligible after admin review.
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
