"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const LOGIN_ADMIN = "/login?next=/admin";
const WORKSPACE = "/workspace";
type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

const LS_KEYS = {
  AUTH: "igops:auth",
} as const;

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [displayName, setDisplayName] = useState<string>("User");
  const [role, setRole] = useState<Role | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const isGuest = !role;

  const syncAuthState = useCallback(async () => {
    try {
      const session = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
      if (session?.role) {
        setRole(session.role);
        setWorkerId(session.workerId ?? null);
      }

      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData.session?.access_token;
      if (!token) {
        if (!session?.role) {
          setRole(null);
          setWorkerId(null);
        }
        return;
      }

      const ensured = await supabase.rpc("ensure_profile");
      const profile = ensured.data as { role?: Role; worker_code?: string } | null;

      if (profile?.role) {
        setRole(profile.role);
        setWorkerId(profile.worker_code ?? null);
        try {
          const merged: AuthSession = {
            role: profile.role,
            workerId: profile.worker_code ?? session?.workerId,
            at: session?.at ?? new Date().toISOString(),
          };
          window.localStorage.setItem(LS_KEYS.AUTH, JSON.stringify(merged));
        } catch {}
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshKyc = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/kyc", { headers: { Authorization: `Bearer ${token}` } });
        const payload = res.ok ? await res.json() : null;
        setKycStatus(payload?.status ?? "none");
      }
    } catch {
      // ignore
    }
  }, []);

  const closeMenu = useCallback(() => {
    if (!menuOpen) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 160);
  }, [menuOpen]);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      void syncAuthState();
    }, 0);

    const { data: authSub } = supabase.auth.onAuthStateChange(() => {
      void syncAuthState();
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEYS.AUTH) void syncAuthState();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.clearTimeout(boot);
      authSub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [syncAuthState]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const name = data?.user?.user_metadata?.name ?? data?.user?.email ?? "User";
      if (alive) setDisplayName(String(name));
      await refreshKyc();
    })();
    return () => {
      alive = false;
    };
  }, [refreshKyc]);

  useEffect(() => {
    if (!menuOpen) return;
    const id = window.setTimeout(() => {
      void refreshKyc();
    }, 0);
    return () => window.clearTimeout(id);
  }, [menuOpen, refreshKyc]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-profile-menu]")) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, menuOpen]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    try {
      window.localStorage.removeItem(LS_KEYS.AUTH);
    } catch {}
    window.location.replace("/login");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 -top-32 h-96 w-96 rounded-full bg-sky-300/40 blur-3xl" />
          <div className="absolute right-[-10%] top-20 h-[520px] w-[520px] rounded-full bg-emerald-200/50 blur-3xl" />
          <div className="absolute bottom-[-10%] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(180deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
        </div>

        <header className="relative z-50">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
            <div className="flex items-center gap-3">
              <Image
                src="/reelencer-logo-transparent-v1.png"
                alt="Reelencer"
                width={1160}
                height={508}
                className="h-auto w-[150px] sm:w-[200px] md:w-[220px]"
                priority
              />
            </div>
            <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
              <Link className="hover:text-slate-900" href="/browse">
                Browse
              </Link>
              <a className="hover:text-slate-900" href="#platform">
                Platform
              </a>
              <a className="hover:text-slate-900" href="#workflow">
                Workflow
              </a>
              <a className="hover:text-slate-900" href="#earnings">
                Earnings
              </a>
              <a className="hover:text-slate-900" href="#trust">
                Trust
              </a>
            </nav>
            <div className="flex items-center">
              <div className="relative" data-profile-menu>
                <button
                  className="flex cursor-pointer items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm shadow-slate-200/80 transition hover:border-slate-300"
                  onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                  aria-label="Open account menu"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0b5cab] text-sm font-semibold text-white">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <svg
                    className="h-4 w-4 text-slate-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="fixed inset-0 z-[9999] flex items-stretch justify-end bg-slate-900/60 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:z-[9999] sm:items-start sm:justify-end sm:bg-transparent">
                    <div
                      className={`relative z-[10000] flex h-full w-[88vw] max-w-[420px] flex-col rounded-none border-l border-slate-200 bg-white shadow-2xl transition-all duration-200 ease-out sm:h-auto sm:w-80 sm:rounded-2xl sm:border sm:animate-none ${
                        menuClosing ? "animate-[slideOutRight_160ms_ease-in]" : "animate-[slideInRight_200ms_ease-out]"
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Navigation</div>
                        <button
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 shadow-sm hover:border-slate-300"
                          onClick={closeMenu}
                          aria-label="Close menu"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto px-4 pb-4 pt-4">
                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b5cab] text-lg font-bold text-white">
                              {displayName.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-base font-semibold text-slate-900">{displayName}</div>
                              <div className="text-xs text-slate-500">
                                {role ? `${role} • ${workerId ? `ID ${workerId}` : "No worker ID"}` : "Guest"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {isGuest ? (
                              <>
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                  Sign in required
                                </span>
                                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-blue-700">
                                  Guest access
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                  KYC: {kycStatus}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                                  Trusted
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {isGuest ? (
                          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4">
                            <div className="text-sm font-semibold text-slate-900">Sign in to unlock the workspace</div>
                            <p className="mt-1 text-xs text-slate-600">
                              Access assignments, payouts, and verified gigs once you’re signed in.
                            </p>
                            <div className="mt-3 grid gap-2">
                              <Link
                                className="cursor-pointer rounded-xl bg-[#0b5cab] px-3 py-3 text-center text-xs font-semibold text-white hover:bg-[#0f6bc7]"
                                href="/login?next=/"
                                onClick={closeMenu}
                              >
                                Sign in
                              </Link>
                              <Link
                                className="cursor-pointer rounded-xl border border-blue-200 bg-white px-3 py-3 text-center text-xs font-semibold text-blue-700 shadow-sm hover:border-blue-300"
                                href="/signup?next=/"
                                onClick={closeMenu}
                              >
                                Create account
                              </Link>
                              <Link
                                className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300"
                                href="/browse"
                                onClick={closeMenu}
                              >
                                Browse gigs
                              </Link>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              <Link
                                className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300"
                                href="/workspace"
                                onClick={closeMenu}
                              >
                                Workspace
                              </Link>
                              <Link
                                className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300"
                                href="/browse"
                                onClick={closeMenu}
                              >
                                Browse gigs
                              </Link>
                            </div>

                            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Quick links
                            </div>
                            <div className="mt-2 space-y-1">
                              <Link
                                className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                href="/"
                                onClick={closeMenu}
                              >
                                Home
                                <span className="text-slate-400">›</span>
                              </Link>
                              <Link
                                className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                href="/workspace"
                                onClick={closeMenu}
                              >
                                Go to workspace
                                <span className="text-slate-400">›</span>
                              </Link>
                              {role === "Admin" && (
                                <Link
                                  className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                  href="/addgigs"
                                  onClick={closeMenu}
                                >
                                  Admin console
                                  <span className="text-slate-400">›</span>
                                </Link>
                              )}
                              <Link
                                className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                href="/workspace"
                                onClick={closeMenu}
                              >
                                My assignments
                                <span className="text-slate-400">›</span>
                              </Link>
                            </div>

                            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2">
                              <button
                                className="w-full cursor-pointer text-left text-sm font-semibold text-rose-600"
                                onClick={signOut}
                              >
                                Sign out
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-10">
          <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-16 pt-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                Enterprise-grade creator platform
              </div>
              <h1 className="mt-6 text-4xl font-semibold leading-tight text-slate-900 md:text-5xl">
                Reelencer Workspace is where social media becomes a full-time job.
              </h1>
              <p className="mt-5 text-base text-slate-600 md:text-lg">
                Discover real work opportunities, complete structured tasks, and earn a stable income — all by simply using
                the social media platforms you already know. Reelencer brings corporate structure to creator workflows so
                teams move fast, stay compliant, and get paid on time.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  className="rounded-full bg-[#0b5cab] px-6 py-3 text-sm font-semibold text-white hover:bg-[#0f6bc7]"
                  href={WORKSPACE}
                >
                  Go to workspace
                </Link>
                {isGuest ? (
                  <Link
                    className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    href="/login?next=/"
                  >
                    Sign in to continue
                  </Link>
                ) : role === "Admin" ? (
                  <Link
                    className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    href="/admin"
                  >
                    Open admin console
                  </Link>
                ) : (
                  <Link
                    className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    href="/browse"
                  >
                    Browse gigs
                  </Link>
                )}
              </div>
              {isGuest ? (
                <p className="mt-3 text-xs text-slate-500">
                  Not signed in? You’ll be redirected to the login page before accessing the workspace.
                </p>
              ) : (
                <p className="mt-3 text-xs text-emerald-700">Signed in. Your workspace and account tools are ready.</p>
              )}
              <div className="mt-8 grid grid-cols-3 gap-4 text-sm text-slate-600">
                <div>
                  <div className="text-2xl font-semibold text-slate-900">48h</div>
                  Avg. payout cycle
                </div>
                <div>
                  <div className="text-2xl font-semibold text-slate-900">300+</div>
                  Live creator teams
                </div>
                <div>
                  <div className="text-2xl font-semibold text-slate-900">99.2%</div>
                  On-time approvals
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/70">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">Creator Earnings Console</div>
                <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Live</div>
              </div>
              <div className="mt-6 grid gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-500">Weekly earnings</div>
                  <div className="mt-2 text-3xl font-semibold text-slate-900">₹48,200</div>
                  <div className="mt-2 text-xs text-emerald-600">+12% from last week</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs text-slate-500">Tasks in motion</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">16</div>
                    <div className="mt-2 text-xs text-slate-500">6 need review</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs text-slate-500">Approval SLAs</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">92%</div>
                    <div className="mt-2 text-xs text-slate-500">On schedule</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Publishing pipeline</span>
                    <span>Today</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {[
                      { label: "Briefs accepted", value: 12 },
                      { label: "Content in edit", value: 7 },
                      { label: "Scheduled posts", value: 9 },
                    ].map((row) => (
                      <div key={row.label}>
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>{row.label}</span>
                          <span>{row.value}</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200">
                          <div className="h-1.5 rounded-full bg-gradient-to-r from-sky-500 to-emerald-400" style={{ width: `${row.value * 6}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="platform" className="mx-auto w-full max-w-6xl px-5 pb-14">
            <div className="grid gap-8 md:grid-cols-3">
              {[
                {
                  title: "Enterprise task orchestration",
                  body: "Discover real work opportunities, receive structured briefs, and execute with clarity and speed.",
                },
                {
                  title: "Publishing that stays on brand",
                  body: "Built-in compliance, checklists, and quality gates keep content aligned with client standards.",
                },
                {
                  title: "Guaranteed payout visibility",
                  body: "Transparent earnings, payout status, and verification ensure a stable, predictable income.",
                },
              ].map((card) => (
                <div key={card.title} className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm">
                  <div className="text-lg font-semibold text-slate-900">{card.title}</div>
                  <p className="mt-3 text-sm text-slate-600">{card.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="workflow" className="mx-auto w-full max-w-6xl px-5 pb-16">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-blue-700">Workflow intelligence</div>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">Operate like a studio, earn like a business.</h2>
                </div>
                <Link
                  className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                  href={LOGIN_ADMIN}
                >
                  Download brochure
                </Link>
              </div>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                {[
                  {
                    step: "01",
                    title: "Accept briefs",
                    body: "Receive approved campaigns with clear deliverables and deadlines so you know exactly what to post.",
                  },
                  {
                    step: "02",
                    title: "Publish + verify",
                    body: "Upload proof, track quality checks, and keep your content aligned with brand guidelines.",
                  },
                  {
                    step: "03",
                    title: "Get paid",
                    body: "Automatic payout visibility, batch approvals, and verified earnings keep cash flow predictable.",
                  },
                ].map((step) => (
                  <div key={step.step} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs text-slate-500">Step {step.step}</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{step.title}</div>
                    <p className="mt-2 text-sm text-slate-600">{step.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="earnings" className="mx-auto w-full max-w-6xl px-5 pb-16">
            <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-center">
              <div>
                <h2 className="text-3xl font-semibold text-slate-900">Full-time earnings with part-time effort.</h2>
                <p className="mt-3 text-sm text-slate-600">
                  Reelencer Workspace turns everyday social media tasks into real, recurring work opportunities so you can
                  build a stable income without chasing one-off gigs.
                </p>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {[
                    "Daily task pipeline",
                    "Admin-backed approvals",
                    "Verified payout cycles",
                    "Realtime performance insights",
                  ].map((item) => (
                    <div key={item} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="text-sm text-slate-500">Creator payout forecast</div>
                <div className="mt-4 text-4xl font-semibold text-slate-900">₹2.4L</div>
                <div className="mt-2 text-sm text-slate-600">Projected monthly earnings</div>
                <div className="mt-6 space-y-4">
                  {[
                    { label: "Brand A", value: "₹76,000" },
                    { label: "Brand B", value: "₹64,000" },
                    { label: "Brand C", value: "₹46,000" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-sm text-slate-700">
                      <span>{row.label}</span>
                      <span className="font-semibold text-slate-900">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="trust" className="mx-auto w-full max-w-6xl px-5 pb-20">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
              <div className="grid gap-8 md:grid-cols-2 md:items-center">
                <div>
                  <div className="text-sm font-semibold text-emerald-700">Trust & compliance</div>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">Corporate-grade governance for creator teams.</h2>
                  <p className="mt-3 text-sm text-slate-600">
                    Role-based access, audit trails, and payout approvals ensure every campaign stays accountable.
                  </p>
                </div>
                <div className="grid gap-4">
                  {[
                    "SOC-ready operational logs",
                    "Automated fraud checks",
                    "Secure payout verification",
                    "Admin approval workflows",
                  ].map((item) => (
                    <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      <footer className="border-t border-slate-200 bg-white/90">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-slate-500 md:flex-row">
          <div>© 2026 Reelencer. All rights reserved.</div>
          <div className="flex gap-4">
            <Link className="hover:text-slate-900" href="/browse">
              Browse
            </Link>
            <Link className="hover:text-slate-900" href="/login">
              Privacy
            </Link>
            <Link className="hover:text-slate-900" href="/login">
              Terms
            </Link>
            <Link className="hover:text-slate-900" href="/login">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
