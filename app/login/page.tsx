"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "Admin" | "Worker";
type ProfileRow = { role?: Role; worker_code?: string | null };
type WorkerRow = { userId?: string; workerId?: string; id?: string };

const LS_KEYS = { AUTH: "igops:auth" } as const;

type AuthSession = {
  role: Role;
  workerId?: string;
  at: string;
};

function nowStamp() {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function safeNextPath(next: string | null, role: Role) {
  const fallback = role === "Admin" ? "/admin" : "/";
  if (!next || !next.startsWith("/")) return fallback;
  if (role === "Admin") return next.startsWith("/admin") ? next : "/admin";
  if (next.startsWith("/admin")) return "/";
  return next === "/workspace" ? "/" : next;
}

function writeLocalAuth(role: Role, workerCode?: string) {
  const value: AuthSession =
    role === "Admin" ? { role: "Admin", at: nowStamp() } : { role: "Worker", workerId: workerCode, at: nowStamp() };
  try {
    window.localStorage.setItem(LS_KEYS.AUTH, JSON.stringify(value));
  } catch {
    // ignore localStorage errors
  }
}

async function fetchOrEnsureProfile() {
  const ensured = await supabase.rpc("ensure_profile");
  if (ensured.data) return { profile: ensured.data as ProfileRow, error: null as string | null };
  return { profile: null, error: ensured.error?.message || "Profile missing" };
}

async function resolveWorkerCode(profile: ProfileRow) {
  if (profile.role !== "Worker") return undefined;
  if (profile.worker_code) return profile.worker_code;

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) return undefined;

  const workersRes = await fetch("/api/workers", { method: "GET" });
  if (!workersRes.ok) return undefined;
  const workersJson: unknown = await workersRes.json();
  if (!Array.isArray(workersJson)) return undefined;

  const workers = workersJson as WorkerRow[];
  const match = workers.find((w) => w.userId === userId);
  return match?.workerId ?? match?.id ?? undefined;
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const signupHref = `/signup${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailNorm = useMemo(() => email.trim().toLowerCase(), [email]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive || !data.session) return;

      const ensured = await fetchOrEnsureProfile();
      if (!alive) return;

      if (!ensured.profile) {
        setErr(`Signed in, but profile could not be loaded (${ensured.error || "unknown error"}).`);
        return;
      }

      const role = ensured.profile.role ?? "Worker";
      const workerCode = await resolveWorkerCode(ensured.profile);
      if (!alive) return;
      writeLocalAuth(role, workerCode);
      router.replace(safeNextPath(nextParam, role));
    })();
    return () => {
      alive = false;
    };
  }, [nextParam, router]);

  const signIn = async () => {
    setErr(null);
    setInfo(null);

    if (!emailNorm || !password) {
      setErr("Enter your work email and password to continue.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailNorm, password });
      if (error || !data.session) {
        setErr(error?.message || "We could not sign you in with those credentials.");
        return;
      }

      const ensured = await fetchOrEnsureProfile();
      if (!ensured.profile) {
        setErr(`Signed in, but profile could not be loaded (${ensured.error || "unknown error"}).`);
        return;
      }

      const role = ensured.profile.role ?? "Worker";
      const workerCode = await resolveWorkerCode(ensured.profile);
      writeLocalAuth(role, workerCode);
      router.replace(safeNextPath(nextParam, role));
    } catch (error) {
      setErr(errorMessage(error, "Unexpected error while signing in."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:52px_52px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl items-start px-3 py-3 sm:px-6 sm:py-8 lg:items-center">
        <div className="grid w-full gap-4 sm:gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl shadow-slate-200/70 backdrop-blur sm:rounded-3xl sm:p-6 lg:p-8">
            <div className="mb-4 flex items-center justify-between py-2 lg:hidden">
              <Link className="text-sm font-semibold text-slate-600 hover:text-slate-900" href="/">
                Back
              </Link>
              <Link className="text-sm font-semibold text-[#0b5cab] hover:text-[#0f6bc7]" href={signupHref}>
                Create account
              </Link>
            </div>
            <div className="mt-1 flex flex-col items-start gap-3 py-2 sm:mt-0 sm:flex-row sm:items-center">
              <Image
                src="/reelencer-logo-transparent-v1.png"
                alt="Reelencer"
                width={1160}
                height={508}
                className="h-auto w-[112px] sm:w-[140px]"
                priority
              />
              <div>
                <p className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Sign in</p>
                <p className="text-sm text-slate-600 sm:text-base">Access workspace, approvals, payouts, and assignments.</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Enterprise access
              </span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                Session protected
              </span>
            </div>

            <div className="mt-5 space-y-4 sm:mt-6">
              <div>
                <label className="text-sm font-semibold text-slate-800" htmlFor="login-email">
                  Work email
                </label>
                <p className="text-xs text-slate-500">Use the same email linked with your profile.</p>
                <input
                  id="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20 sm:py-3.5"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800" htmlFor="login-password">
                  Password
                </label>
                <p className="text-xs text-slate-500">Minimum 6 characters.</p>
                <input
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20 sm:py-3.5"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signIn();
                  }}
                />
              </div>

              {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{err}</div>}
              {info && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{info}</div>}

              <button
                onClick={() => void signIn()}
                disabled={loading}
                className="w-full rounded-2xl bg-[#0b5cab] px-4 py-3 text-base font-bold text-white hover:bg-[#0f6bc7] disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-xl sm:text-sm"
              >
                {loading ? "Signing in..." : "Sign in securely"}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:hidden">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Quick benefits</div>
              <div className="mt-2 grid gap-2 text-xs text-slate-700">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">Track assignments and approvals in one place.</div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">See payout status with clear verification signals.</div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">Move from gig application to delivery faster.</div>
              </div>
            </div>

            <div className="mt-5 hidden flex-wrap items-center justify-between gap-3 text-xs text-slate-500 lg:flex">
              <p>
                New to Reelencer?{" "}
                <Link className="font-semibold text-[#0b5cab] hover:text-[#0f6bc7]" href={signupHref}>
                  Create account
                </Link>
              </p>
              <Link className="font-semibold text-slate-600 hover:text-slate-900" href="/">
                Back
              </Link>
            </div>
          </section>

          <section className="hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/70 sm:p-8 lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Operations ready</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900 sm:text-3xl">
              Production-grade creator workflow management.
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Run creators like a real operations team with structured approvals, performance visibility, and payout controls.
            </p>

            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Assignment orchestration</div>
                <div className="mt-1 text-xs text-slate-600">Track submissions, revisions, and SLA timelines in one view.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Verified payout operations</div>
                <div className="mt-1 text-xs text-slate-600">Tie approvals to payout states for predictable creator earnings.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Compliance-first publishing</div>
                <div className="mt-1 text-xs text-slate-600">Keep brand, legal, and policy checks embedded into delivery flow.</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginPageInner />
    </Suspense>
  );
}
