"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/app/_components/BrandMark";
import { ThemeToggle, useSyncHomeTheme } from "@/app/_components/ThemeToggle";
import { FIND_GIGS_HREF } from "@/lib/routes";

type AuthMode = "login" | "signup";

const storyByMode: Record<
  AuthMode,
  { kicker: string; lead: string; accent: string; body: string; points: readonly (readonly [string, string])[] }
> = {
  login: {
    kicker: "Welcome back",
    lead: "Your next reel could be",
    accent: "your next payout.",
    body: "Sign in to pick up accepted gigs, follow every review, and see exactly where your earnings stand.",
    points: [
      ["Pick up where you left off", "Accepted gigs and briefs wait in your workspace."],
      ["Follow every review", "Know whether a reel is approved, in review, or needs a tweak."],
      ["Track your payouts", "Pending, approved, and paid, all in one place."],
    ],
  },
  signup: {
    kicker: "Join Reelencer",
    lead: "Turn the reels you make into",
    accent: "reliable income.",
    body: "Create an account with any email, pick a brand gig that fits your style, and get paid once it's approved.",
    points: [
      ["Create your account", "Sign up with any email address."],
      ["Pick a brand gig", "Deliverables, deadline, and payout are listed up front."],
      ["Submit and get paid", "Track your reel from review all the way to payout."],
    ],
  },
};

export function AuthShell({
  mode,
  loginHref,
  signupHref,
  title,
  subtitle,
  children,
  footer,
}: {
  mode: AuthMode;
  loginHref: string;
  signupHref: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useSyncHomeTheme();
  const story = storyByMode[mode];
  const altHref = mode === "login" ? signupHref : loginHref;

  return (
    <div className="home-motion-scope min-h-screen text-white">
      <div id="top" className="home-page-bg relative isolate flex min-h-[100dvh] flex-col overflow-clip">
        <div aria-hidden className="rx-aurora">
          <span className="rx-aurora-blob rx-aurora-blob--a" />
          <span className="rx-aurora-blob rx-aurora-blob--b" />
          <span className="rx-aurora-blob rx-aurora-blob--c" />
        </div>
        <div aria-hidden className="rx-hero-grid" />
        <div aria-hidden className="rx-grain" />

        <header className="relative z-20">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-3 min-[430px]:px-4 sm:px-6 sm:py-5 lg:px-8">
            <div className="min-w-0 shrink">
              <BrandMark compact showTagline={false} />
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              <Link
                href="/"
                className="hidden h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-white/75 transition hover:bg-white/8 hover:text-white sm:inline-flex"
              >
                <span aria-hidden>←</span>
                Back to home
              </Link>
              <Link
                href={altHref}
                className="inline-flex h-10 items-center rounded-full border border-white/14 bg-white/[0.05] px-4 text-sm font-bold text-white transition hover:border-white/30 hover:bg-white/10"
              >
                {mode === "login" ? "Sign up" : "Log in"}
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-3 pb-10 pt-2 min-[430px]:px-4 sm:px-6 sm:pb-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14 lg:px-8 lg:pb-16 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] xl:gap-20">
          {/* Story panel: short on phones (above the form), full on desktop */}
          <section className="rx-auth-rise order-1 min-w-0" aria-label={story.kicker}>
            <div className="earn-kicker text-[0.7rem] font-bold uppercase tracking-[0.26em] text-[#95ea63] sm:text-xs">{story.kicker}</div>
            <h1 className="mt-3 max-w-[36rem] font-[Georgia,Times_New_Roman,serif] text-[clamp(1.85rem,7.6vw,3.6rem)] font-bold leading-[1.04] tracking-[-0.015em] text-white sm:mt-4">
              {story.lead}{" "}
              <span className="hero-accent relative inline-block pb-1.5">
                {story.accent}
                <svg
                  aria-hidden
                  viewBox="0 0 300 14"
                  preserveAspectRatio="none"
                  className="hero-underline absolute -bottom-0.5 left-0 h-[0.26em] w-full text-[#8fe05f]"
                >
                  <path d="M3 10C60 3.5 150 1.5 297 7" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" pathLength={1} />
                </svg>
              </span>
            </h1>
            <p className="mt-4 hidden max-w-[32rem] text-pretty text-[clamp(0.98rem,1.4vw,1.1rem)] leading-[1.65] text-white/68 sm:block">{story.body}</p>

            <ol className="mt-8 hidden max-w-[32rem] gap-3 lg:grid" aria-label="What you get">
              {story.points.map(([point, detail], index) => (
                <li
                  key={point}
                  className={`rx-auth-point rx-step-${index} flex items-start gap-3.5 rounded-[1.2rem] border border-white/8 bg-white/[0.035] p-4 backdrop-blur-sm`}
                >
                  <span className="rx-step-node grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#95ea63]/30 bg-[#10352d] text-xs font-black text-[#aef07f]">
                    0{index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.98rem] font-semibold text-white">{point}</span>
                    <span className="mt-0.5 block text-sm leading-6 text-white/62">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-6 hidden items-center gap-3 text-sm text-white/60 lg:flex">
              <span className="earn-live-dot" aria-hidden />
              Want a look first? See what brands are posting right now.
              <Link href={FIND_GIGS_HREF} className="shrink-0 font-bold text-[#aef07f] transition hover:text-white">
                Browse gigs →
              </Link>
            </div>
          </section>

          {/* Form card */}
          <section className="rx-auth-rise rx-auth-rise--late order-2 w-full min-w-0 lg:justify-self-end" aria-label={title}>
            <div className="rx-auth-card relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl min-[380px]:p-5 sm:rounded-[2rem] sm:p-7 lg:p-8">
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-[#8fe05f]/12 blur-3xl" />

              <nav aria-label="Account" className="relative grid grid-cols-2 rounded-full border border-white/10 bg-black/15 p-1">
                {(
                  [
                    ["login", "Log in", loginHref],
                    ["signup", "Create account", signupHref],
                  ] as const
                ).map(([key, label, href]) => {
                  const active = key === mode;
                  return (
                    <Link
                      key={key}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`rx-auth-tab flex h-10 items-center justify-center rounded-full text-sm font-bold transition sm:h-11 ${
                        active ? "is-active" : "text-white/65 hover:text-white"
                      }`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </nav>

              <div className="relative mt-6 sm:mt-7">
                <h2 className="text-[clamp(1.45rem,5.4vw,1.85rem)] font-black leading-tight tracking-[-0.035em] text-white">{title}</h2>
                <p className="mt-1.5 text-[0.95rem] leading-6 text-white/64">{subtitle}</p>
              </div>

              <div className="relative mt-6">{children}</div>
            </div>

            {footer && <div className="mt-5 text-center text-sm text-white/60">{footer}</div>}
          </section>

          {/* Phones/tablets: the value points follow the form instead of pushing it down */}
          <section className="order-3 lg:hidden" aria-label="What you get">
            <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
              {story.points.map(([point, detail], index) => (
                <li
                  key={point}
                  className={`rx-auth-point rx-step-${index} flex items-start gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.035] p-3.5 sm:flex-col sm:gap-2.5 sm:p-4`}
                >
                  <span className="rx-step-node grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#95ea63]/30 bg-[#10352d] text-[0.7rem] font-black text-[#aef07f]">
                    0{index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.95rem] font-semibold text-white">{point}</span>
                    <span className="mt-0.5 block text-[0.84rem] leading-5 text-white/62">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className="relative z-10 border-t border-white/8">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-white/55 sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} Reelencer. Built for creators.</span>
            <a href="mailto:support@reelencer.com" className="font-semibold text-white/70 transition hover:text-white">
              Need help? support@reelencer.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Form building blocks shared by the login and signup pages
   --------------------------------------------------------------------------- */

const fieldIcons = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path strokeLinecap="round" d="M8 10.5V7.5a4 4 0 1 1 8 0v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M4 20c2-4 5.2-6 8-6s6 2 8 6" />
    </>
  ),
} as const;

export function AuthField({
  id,
  label,
  icon,
  invalid,
  children,
  trailing,
  hint,
}: {
  id: string;
  label: string;
  icon: keyof typeof fieldIcons;
  invalid?: boolean;
  children: ReactNode;
  trailing?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-white/80">
        {label}
      </label>
      <div className={`rx-auth-field group relative mt-2 ${invalid ? "is-invalid" : ""}`}>
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-4 top-1/2 h-[1.15rem] w-[1.15rem] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#3f9a1e]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          aria-hidden
        >
          {fieldIcons[icon]}
        </svg>
        {children}
        {trailing}
      </div>
      {hint}
    </div>
  );
}

export const authInputClass =
  "auth-field-input h-12 w-full min-w-0 rounded-[0.95rem] border border-slate-200 bg-[#fff] pl-11 pr-4 text-[1rem] font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-[#8fe05f] focus:ring-4 focus:ring-[#8fe05f]/25 sm:h-[3.25rem]";

export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fe05f]"
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
    >
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
        {shown && <path strokeLinecap="round" d="M4 4l16 16" />}
      </svg>
    </button>
  );
}

export function AuthSubmit({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      aria-busy={loading}
      className="resources-cta-button group inline-flex h-12 w-full items-center justify-center gap-2 rounded-[1rem] bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.25)] transition hover:bg-[#9ae86a] disabled:cursor-not-allowed disabled:opacity-70 sm:h-[3.25rem]"
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0b1914]/25 border-t-[#0b1914]" aria-hidden />
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <span className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden>
            →
          </span>
        </>
      )}
    </button>
  );
}

/** Green check shown inside an email field that was carried over from the homepage. */
export function CarriedEmailCheck() {
  return (
    <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-[#22c55e] text-white">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <path d="m5 10.5 3.2 3.2L15 7" />
      </svg>
    </span>
  );
}

/** "Filled in for you. Change" note under a carried-over email field. */
export function CarriedEmailNote({ id, inputId, onChange }: { id: string; inputId: string; onChange: () => void }) {
  return (
    <p id={id} className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8rem] font-semibold text-white/60">
      <span>Filled in for you.</span>
      <button
        type="button"
        onClick={() => {
          onChange();
          const input = document.getElementById(inputId) as HTMLInputElement | null;
          input?.focus();
          input?.select();
        }}
        className="-my-1 rounded-md px-1 py-1 font-bold text-[#aef07f] underline-offset-4 transition hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fe05f]"
      >
        Change
      </button>
    </p>
  );
}
