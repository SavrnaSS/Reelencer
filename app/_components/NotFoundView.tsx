"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { suggestPage } from "@/lib/notFoundSuggest";
import { CREATOR_HOME_HREF, FIND_GIGS_HREF } from "@/lib/routes";
import styles from "./NotFoundView.module.css";

// The 404 screen for both routers (app/not-found.tsx and pages/404.tsx): the missing address, the page it most
// likely meant, and the main ways back into Reelencer.

const noop = () => () => {};
const readPath = () => window.location.pathname + window.location.search;
const canGoBack = () => window.history.length > 1 && !!document.referrer && new URL(document.referrer).origin === window.location.origin;

const LINKS: Array<{ href: string; title: string; body: string; icon: ReactNode }> = [
  {
    href: FIND_GIGS_HREF,
    title: "Find gigs",
    body: "Browse open brand briefs",
    icon: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  },
  {
    href: CREATOR_HOME_HREF,
    title: "My jobs",
    body: "Applications and work",
    icon: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5h8v2M3 12h18" /></>,
  },
  {
    href: "/payouts",
    title: "Payouts",
    body: "Earnings and withdrawals",
    icon: <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="3" y="8" width="18" height="12" rx="2.5" /><path d="M16 14h2" /></>,
  },
  {
    href: "mailto:support@reelencer.com?subject=Broken%20link",
    title: "Report a broken link",
    body: "Tell us where it came from",
    icon: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
  },
];

function Icon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** "404" as three reel frames; the zero is an empty frame with a play button. */
function ReelNumber() {
  const frame = "relative flex h-[7.5rem] w-[4.6rem] items-center justify-center overflow-hidden rounded-[1.1rem] border border-white/15 bg-white/[0.06] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)] backdrop-blur sm:h-44 sm:w-[6.6rem] sm:rounded-[1.4rem]";
  const digit = "font-[Georgia,Times_New_Roman,serif] text-[4.2rem] font-bold leading-none text-white sm:text-[6rem]";
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-3 sm:gap-4">
      <div className={`${styles.frame} ${frame}`} style={{ ["--tilt" as string]: "-6deg" }}>
        <span className={digit}>4</span>
      </div>
      <div className={`${styles.frame} ${frame} border-[#8fe05f]/50 bg-[#8fe05f]/10`}>
        <span className={`${styles.scan} absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-[#8fe05f]/25 to-transparent`} />
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#8fe05f] text-[#0b1914] sm:h-14 sm:w-14">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 sm:h-6 sm:w-6" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
        </span>
        <span className="absolute left-2.5 top-2.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/70 sm:text-[10px]">
          <span className={`${styles.blink} h-1.5 w-1.5 rounded-full bg-[#ff5a4f]`} />
          Rec
        </span>
        <span className="absolute inset-x-2.5 bottom-2.5 h-[3px] overflow-hidden rounded-full bg-white/15">
          <span className="block h-full w-1/3 rounded-full bg-[#8fe05f]" />
        </span>
      </div>
      <div className={`${styles.frame} ${frame}`} style={{ ["--tilt" as string]: "6deg" }}>
        <span className={digit}>4</span>
      </div>
    </div>
  );
}

export default function NotFoundView() {
  // Read on the client only, so the server and client markup match.
  const path = useSyncExternalStore(noop, readPath, () => "");
  const back = useSyncExternalStore(noop, canGoBack, () => false);
  const suggestion = path ? suggestPage(path) : null;

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#031713] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[#58b52d]/20 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-[#2e7d4f]/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8fe05f]" aria-label="Reelencer home">
          <BrandLogo className="h-9 w-9" sizes="36px" />
          <span className="font-[Georgia,Times_New_Roman,serif] text-[1.2rem] font-bold">Reelencer</span>
        </Link>
        <a href="mailto:support@reelencer.com" className="hidden h-9 items-center rounded-full border border-white/15 px-3.5 text-[13px] font-semibold text-white/80 transition hover:border-white/35 hover:text-white sm:inline-flex">
          Contact support
        </a>
      </header>

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-14 lg:px-8">
        <ReelNumber />

        <p className="mt-9 text-[12px] font-bold uppercase tracking-[0.22em] text-[#8fe05f] sm:mt-11">Error 404 · Page not found</p>
        <h1 className="mt-3 max-w-2xl text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">This scene didn&apos;t make the final cut</h1>
        <p className="mt-4 max-w-xl text-pretty text-[15px] leading-7 text-white/70 sm:text-[16.5px]">
          The page you&apos;re looking for doesn&apos;t exist, was moved, or the link has a typo.
        </p>

        {path ? (
          <code className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.07] px-3.5 py-1.5 text-[12.5px] text-white/75 ring-1 ring-white/12">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff5a4f]" aria-hidden="true" />
            <span className="truncate">{path}</span>
          </code>
        ) : null}

        {suggestion ? (
          <Link
            href={suggestion.href}
            className="group mt-5 inline-flex max-w-full items-center gap-3 rounded-2xl bg-[#8fe05f]/12 py-2.5 pl-3 pr-4 text-left ring-1 ring-[#8fe05f]/35 transition hover:bg-[#8fe05f]/18"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#8fe05f] text-[#0b1914]">
              <Icon className="h-4 w-4"><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[#8fe05f]">Did you mean</span>
              <span className="block truncate text-[14.5px] font-semibold">{suggestion.label}</span>
            </span>
          </Link>
        ) : null}

        <div className="mt-7 flex w-full max-w-sm flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row sm:justify-center">
          <Link href="/" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#8fe05f] px-6 text-[14.5px] font-bold text-[#0b1914] transition hover:bg-[#9ae86a]">
            <Icon className="h-4 w-4"><path d="m3 11 9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" /></Icon>
            Back to home
          </Link>
          {back ? (
            <button
              type="button"
              onClick={() => window.history.back()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-[14.5px] font-semibold text-white/85 transition hover:border-white/35 hover:text-white"
            >
              <Icon className="h-4 w-4"><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>
              Go back
            </button>
          ) : (
            <Link href={FIND_GIGS_HREF} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-[14.5px] font-semibold text-white/85 transition hover:border-white/35 hover:text-white">
              Browse gigs
            </Link>
          )}
        </div>

        <nav aria-label="Popular pages" className="mt-12 w-full max-w-4xl sm:mt-14">
          <div className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.18em] text-white/45">Or jump to</div>
          <ul className="grid grid-cols-2 gap-2.5 text-left sm:gap-3 lg:grid-cols-4">
            {LINKS.map((link) => (
              <li key={link.title} className={styles.rise}>
                <a
                  href={link.href}
                  className="group flex h-full flex-col gap-3 rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-white/[0.09] hover:ring-white/20 sm:flex-row sm:items-center sm:p-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-[#8fe05f] transition group-hover:bg-[#8fe05f] group-hover:text-[#0b1914]">
                    <Icon className="h-[18px] w-[18px]">{link.icon}</Icon>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold leading-5">{link.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-white/55">{link.body}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <footer className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-[12px] text-white/45 sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} Reelencer</span>
          <span className="flex gap-4">
            <Link href="/terms" className="font-semibold text-white/60 transition hover:text-[#aef07f]">Terms</Link>
            <Link href="/privacy" className="font-semibold text-white/60 transition hover:text-[#aef07f]">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
