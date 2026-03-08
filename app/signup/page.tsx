"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const mobileNavItems = [
  {
    label: "Home",
    href: "/",
    items: ["Landing overview", "Creator-first growth", "Premium onboarding"],
  },
  {
    label: "Login",
    href: "/login",
    items: ["Secure access", "Session protected", "Role-aware redirects"],
  },
  {
    label: "Register",
    href: "/signup",
    items: ["Create account", "Verified onboarding", "Fast setup"],
  },
  {
    label: "Browse",
    href: "/browse",
    items: ["Verified gigs", "Structured workflow", "Payout visibility"],
  },
  {
    label: "Support",
    href: "/#resources",
    items: ["Contact support", "Creator playbooks", "Launch checklist"],
  },
] as const;

const desktopNavItems = [
  { label: "Home", href: "/#top" },
  { label: "How It Works", href: "/#solution" },
  { label: "Why Reelencer", href: "/#company" },
  { label: "Creator Stories", href: "/#portfolio" },
  { label: "Help Center", href: "/#resources" },
] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function SignupPageInner() {
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [menuOpen, setmenuOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string>("Register");

  const emailNorm = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailRedirectTo = useMemo(() => {
    const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    const origin = typeof window !== "undefined" ? window.location.origin : null;
    const base = envSiteUrl || origin;
    return base ? `${base}/login` : undefined;
  }, []);

  useEffect(() => {
    const emailPrefill = searchParams.get("email");
    if (emailPrefill) setEmail(emailPrefill);
  }, [searchParams]);

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
    if (!acceptTerms) {
      setErr("Please accept terms to continue.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: emailNorm,
        password,
        options: {
          data: { name },
          emailRedirectTo,
        },
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
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div
        id="top"
        className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="pointer-events-none absolute right-[9%] top-[21%] hidden h-44 w-44 rounded-full bg-[#8fe05f]/10 blur-3xl lg:block" />
        <div className="pointer-events-none absolute left-[5%] top-[30%] hidden h-52 w-52 rounded-full bg-[#5a45e3]/10 blur-3xl lg:block" />

        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[84vw] max-w-[360px] flex-col border-r border-white/12 bg-[linear-gradient(180deg,#133f35_0%,#10362f_52%,#0d2d27_100%)] px-4 py-6 shadow-[28px_0_64px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            menuOpen ? "translate-x-0 opacity-100" : "-translate-x-[104%] opacity-0"
          }`}
          aria-hidden={!menuOpen}
        >
          <div
            className={`flex items-start justify-between transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              menuOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <BrandMark compact showTagline={false} />
            <button
              type="button"
              onClick={() => setmenuOpen(false)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/35 bg-white/[0.02] text-white/95 transition hover:border-white/55 hover:bg-white/8"
              aria-label="Close navigation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <nav className="mt-12 space-y-1">
            {mobileNavItems.map((item, index) => (
              <div
                key={item.label}
                className={`border-b border-white/10 py-3.5 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                  menuOpen ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0"
                }`}
                style={{ transitionDelay: menuOpen ? `${90 + index * 45}ms` : "0ms" }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedMenu((current) => (current === item.label ? "" : item.label))}
                  className={`flex w-full items-center justify-between py-1 text-left text-[1.1rem] font-semibold tracking-[-0.01em] ${item.label === "Register" ? "text-white" : "text-white/90"}`}
                >
                  <span>{item.label}</span>
                  <span className={`${item.label === "Register" ? "text-white/92" : "text-white/62"}`}>
                    {expandedMenu === item.label ? "−" : "+"}
                  </span>
                </button>
                <div className={`grid transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${expandedMenu === item.label ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    <div className="space-y-2 pt-1 pb-1">
                      <Link
                        href={item.href}
                        onClick={() => setmenuOpen(false)}
                        className="block text-sm font-medium text-white/78 transition hover:text-white"
                      >
                        Open {item.label}
                      </Link>
                      {item.items.map((subitem) => (
                        <div key={subitem} className="text-sm text-white/46">
                          {subitem}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </nav>

          <div
            className={`mt-6 pt-4 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              menuOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
            style={{ transitionDelay: menuOpen ? "300ms" : "0ms" }}
          >
            <Link
              href="mailto:support@reelencer.com"
              className="group flex items-center gap-3 rounded-2xl border border-white/14 bg-[linear-gradient(135deg,#1f2228,#171a1f)] px-3 py-3 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition hover:border-white/24 hover:bg-[linear-gradient(135deg,#232833,#1b2029)]"
              onClick={() => setmenuOpen(false)}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[1.25rem]">✉️</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[0.72rem] font-semibold uppercase tracking-[0.13em] text-white/62">Send us mail for any query</span>
                <span className="block truncate text-[1.03rem] font-bold text-white">support@reelencer.com</span>
              </span>
              <span className="text-xl text-white/62 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
            </Link>
          </div>
        </aside>

        <button
          type="button"
          className={`fixed inset-0 z-40 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            menuOpen ? "pointer-events-auto bg-black/52 backdrop-blur-[3px] opacity-100" : "pointer-events-none bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          onClick={() => setmenuOpen(false)}
          aria-label="Dismiss navigation overlay"
        />

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-6 pt-4 sm:px-6 sm:pt-5 lg:px-8">
          <div className="relative hidden items-center justify-between lg:flex">
            <BrandMark showTagline />
            <nav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-1.5 backdrop-blur-md xl:flex">
              {desktopNavItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition ${item.label === "Home" ? "bg-white text-[#0b211b]" : "text-white/74 hover:bg-white/8 hover:text-white"}`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[1.05rem] font-semibold text-white/95 transition hover:text-white">
                <span>Login</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="8" r="4" />
                  <path strokeLinecap="round" d="M4 20c2-4 5.2-6 8-6s6 2 8 6" />
                </svg>
              </Link>
              <Link
                href="mailto:support@reelencer.com"
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/14 bg-[linear-gradient(135deg,#1f2228,#171a1f)] text-[1.15rem] shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition hover:border-white/22 hover:bg-[linear-gradient(135deg,#22262d,#1a1d23)] 2xl:hidden"
                aria-label="Send us mail"
              >
                ✉️
              </Link>
              <Link
                href="mailto:support@reelencer.com"
                className="group hidden items-center gap-3 rounded-2xl border border-white/14 bg-[linear-gradient(135deg,#1f2228,#171a1f)] px-3 py-2.5 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition hover:border-white/22 hover:bg-[linear-gradient(135deg,#22262d,#1a1d23)] 2xl:inline-flex"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[1.25rem]">✉️</span>
                <span className="leading-tight">
                  <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-white/62">Send us mail for any query</span>
                  <span className="block text-[1.02rem] font-bold text-white">support@reelencer.com</span>
                </span>
                <span className="text-xl text-white/62 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between lg:hidden">
            <BrandMark compact showTagline={false} />
            <div className="flex items-center gap-3">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[1.05rem] font-semibold text-white/95 transition hover:text-white">
                <span>Login</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="8" r="4" />
                  <path strokeLinecap="round" d="M4 20c2-4 5.2-6 8-6s6 2 8 6" />
                </svg>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setExpandedMenu("Register");
                  setmenuOpen(true);
                }}
                className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/70 bg-white/4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:bg-white/10"
                aria-label="Open navigation"
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path strokeLinecap="round" d="M6 7h12M10 12h8M6 17h12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mx-auto mt-12 w-full max-w-[680px] sm:mt-14 lg:mt-20">
            <h1 className="text-[2.8rem] font-black tracking-[-0.035em] text-white sm:text-[3.1rem] lg:text-[3.35rem]">Register</h1>

            <div className="mt-6 rounded-[1.65rem] border border-white/10 bg-[#113d33]/72 p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm sm:p-7 lg:p-8">
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-white/84" htmlFor="signup-name">
                    Full name <span className="text-[#95ea63]">*</span>
                  </label>
                  <input
                    id="signup-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Creator"
                    className="mt-2 h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                    autoComplete="name"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-white/84" htmlFor="signup-email">
                    Username or email address <span className="text-[#95ea63]">*</span>
                  </label>
                  <input
                    id="signup-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="mt-2 h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-white/84" htmlFor="signup-password">
                    Password <span className="text-[#95ea63]">*</span>
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="signup-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      className="h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 pr-12 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-700/90 hover:bg-black/5"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-white/84" htmlFor="signup-confirm">
                    Confirm password <span className="text-[#95ea63]">*</span>
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="signup-confirm"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      type={showConfirmPassword ? "text" : "password"}
                      className="h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 pr-12 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                      autoComplete="new-password"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void signUp();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-700/90 hover:bg-black/5"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>

                {err && <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{err}</div>}
                {info && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{info}</div>}

                <label className="flex flex-wrap items-center gap-2 text-sm text-white/84">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="h-4 w-4 rounded border-white/35 bg-white/10 text-[#8fe05f] focus:ring-[#8fe05f]"
                  />
                  <span>I agree to terms and privacy policy</span>
                </label>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <button
                    onClick={() => void signUp()}
                    disabled={loading}
                    className="flex h-14 w-full items-center justify-center rounded-[1.2rem] bg-[#8fe05f] px-8 text-base font-extrabold tracking-[-0.02em] text-[#0b1914] transition hover:bg-[#9ae86a] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
                  >
                    {loading ? "Creating account..." : "Create account"}
                  </button>

                  <Link href={loginHref} className="text-[#9eea6d] transition hover:text-white lg:whitespace-nowrap">
                    Already have an account? Log in
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#041f1a]" />}>
      <SignupPageInner />
    </Suspense>
  );
}

function BrandMark({ compact = false, showTagline = true }: { compact?: boolean; showTagline?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3 text-white">
      <div className={`relative overflow-hidden ${compact ? "h-11 w-11" : "h-14 w-14"}`}>
        <Image src="/logo-mark.svg" alt="Reelencer logo mark" fill sizes={compact ? "44px" : "56px"} className="object-contain" />
      </div>
      <div className="leading-none">
        <div
          className={`font-[Georgia,Times_New_Roman,serif] font-bold tracking-[-0.06em] text-white ${
            compact ? "text-[1.65rem]" : "text-[2.05rem] sm:text-[2.2rem]"
          }`}
        >
          Reelencer
        </div>
        {showTagline && (
          <div className={`${compact ? "mt-0.5 text-[0.72rem]" : "mt-1 text-[0.95rem]"} font-medium text-white/82`}>
            Freelance Creator Platform
          </div>
        )}
      </div>
    </Link>
  );
}
