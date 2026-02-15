"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const loginHref = `/login${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailNorm = useMemo(() => email.trim().toLowerCase(), [email]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive || !data.session) return;
      router.replace("/post-login");
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const signUp = async () => {
    setErr(null);
    setInfo(null);

    const name = fullName.trim();
    if (!name || !emailNorm || !password) {
      setErr("Enter full name, email, and password to create your account.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: emailNorm,
        password,
        options: { data: { name } },
      });
      if (error) {
        setErr(error.message || "Unable to create account right now.");
        return;
      }

      if (data.session) {
        router.replace("/post-login");
        return;
      }

      setInfo("Account created. Confirm your email, then sign in to continue.");
    } catch (error) {
      setErr(errorMessage(error, "Unexpected error while creating your account."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,#dbeafe,transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:54px_54px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-start px-4 py-4 sm:px-6 sm:py-8 lg:items-center">
        <div className="grid w-full gap-4 sm:gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-xl shadow-slate-200/70 backdrop-blur sm:p-8">
            <div className="mb-3 flex items-center justify-between lg:hidden">
              <Link className="text-xs font-semibold text-slate-600 hover:text-slate-900" href="/">
                Back to home
              </Link>
              <Link className="text-xs font-semibold text-[#0b5cab] hover:text-[#0f6bc7]" href={loginHref}>
                Sign in
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0b5cab] text-lg font-black text-white">RG</div>
              <div>
                <p className="text-xl font-bold text-slate-900">Create your account</p>
                <p className="text-sm text-slate-600">Set up your profile for verified gigs and managed payouts.</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Verified onboarding
              </span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                Role-aware access
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="text-sm font-semibold text-slate-800" htmlFor="signup-name">
                  Full name
                </label>
                <p className="text-xs text-slate-500">Displayed on your creator profile and workspace activity.</p>
                <input
                  id="signup-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Creator"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3.5 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20"
                  autoComplete="name"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800" htmlFor="signup-email">
                  Email
                </label>
                <p className="text-xs text-slate-500">Use a reliable address you can verify immediately.</p>
                <input
                  id="signup-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3.5 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20"
                  autoComplete="email"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-800" htmlFor="signup-password">
                    Password
                  </label>
                  <p className="text-xs text-slate-500">At least 6 characters.</p>
                  <input
                    id="signup-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    type="password"
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3.5 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20"
                    autoComplete="new-password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void signUp();
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-800" htmlFor="signup-confirm">
                    Confirm password
                  </label>
                  <p className="text-xs text-slate-500">Re-enter to avoid typos.</p>
                  <input
                    id="signup-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    type="password"
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3.5 text-base text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/20"
                    autoComplete="new-password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void signUp();
                    }}
                  />
                </div>
              </div>

              {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{err}</div>}
              {info && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{info}</div>}

              <button
                onClick={() => void signUp()}
                disabled={loading}
                className="w-full rounded-xl bg-[#0b5cab] px-4 py-3 text-sm font-bold text-white hover:bg-[#0f6bc7] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Creating account..." : "Create account"}
              </button>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:hidden">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">What you get</div>
                <div className="mt-2 grid gap-2 text-xs text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">Verified marketplace access for trusted gigs.</div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">Structured workflow from acceptance to delivery.</div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">Transparent payout tracking and status history.</div>
                </div>
              </div>

              <div className="hidden flex-wrap items-center justify-between gap-3 text-xs text-slate-500 lg:flex">
                <p>
                  Already registered?{" "}
                  <Link className="font-semibold text-[#0b5cab] hover:text-[#0f6bc7]" href={loginHref}>
                    Sign in
                  </Link>
                </p>
                <Link className="font-semibold text-slate-600 hover:text-slate-900" href="/">
                  Back to home
                </Link>
              </div>
            </div>
          </section>

          <section className="hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/70 sm:p-8 lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Workspace management</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900 sm:text-3xl">
              Advanced creator operations, from onboarding to payout.
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Reelencer centralizes gig matching, assignment tracking, and approval workflows so teams scale without operational chaos.
            </p>

            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Talent-quality screening</div>
                <div className="mt-1 text-xs text-slate-600">Standardized requirements and role fit before task assignment.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Execution visibility</div>
                <div className="mt-1 text-xs text-slate-600">Track progress, blockers, and delivery confidence in real time.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Payment governance</div>
                <div className="mt-1 text-xs text-slate-600">Approved outputs flow into verified payout cycles and audit-safe history.</div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Onboarding flow</div>
              <div className="mt-2 grid gap-1 text-sm text-slate-700">
                <div>1. Create account and profile identity</div>
                <div>2. Verify email and account ownership</div>
                <div>3. Access marketplace and start applying</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
