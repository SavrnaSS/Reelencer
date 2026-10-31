"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { suggestPage } from "@/lib/notFoundSuggest";
import { CREATOR_HOME_HREF, FIND_GIGS_HREF } from "@/lib/routes";
import styles from "./NotFoundView.module.css";
import { buttonClassName } from "@/app/dashboard/dashboardUi";
import NotFoundIllustration from "./NotFoundIllustration";

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

export default function NotFoundView() {
  // Read on the client only, so the server and client markup match.
  const path = useSyncExternalStore(noop, readPath, () => "");
  const back = useSyncExternalStore(noop, canGoBack, () => false);
  const suggestion = path ? suggestPage(path) : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f3f4f1] text-[#1a201c] [font-family:var(--font-geist-sans)]">
      {/* Same top bar as the dashboard. */}
      <header className="sticky top-0 z-20 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex h-[60px] w-full max-w-[1440px] items-center justify-between gap-3 px-3.5 sm:px-5 md:h-[68px] md:px-6 lg:px-7 2xl:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40" aria-label="Reelencer home">
            <BrandLogo className="h-8 w-8" sizes="32px" />
            <span className="hidden font-[Georgia,Times_New_Roman,serif] text-[19px] font-bold text-[#20352c] min-[380px]:inline">Reelencer</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <a href="mailto:support@reelencer.com?subject=Broken%20link" className={buttonClassName("secondary", "md", "hidden h-10 rounded-full sm:inline-flex")}>
              Contact support
            </a>
            <Link href={CREATOR_HOME_HREF} className={buttonClassName("primary", "md", "h-10")}>
              My jobs
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center justify-center px-3.5 py-8 min-[380px]:px-4 sm:px-5 sm:py-12 md:px-6 lg:px-7 2xl:px-8">
        {/* The art sits straight on the page: side by side with the message on desktop, stacked on phones. */}
        <section aria-labelledby="not-found-title" className="grid w-full max-w-5xl items-center gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
          <div className="mx-auto w-full max-w-[440px] sm:max-w-[520px] lg:max-w-none">
            <NotFoundIllustration />
          </div>

          <div className="min-w-0 text-center lg:text-left">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[#fde4e1] px-2.5 py-1 text-[12px] font-medium text-[#8e1f1a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#d03b3b]" aria-hidden="true" />
              Error 404 · Page not found
            </p>
            <h1 id="not-found-title" className="mx-auto mt-3 max-w-xl text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#1a201c] sm:text-[32px] lg:mx-0 lg:text-[36px]">
              This scene didn&apos;t make the final cut
            </h1>
            <p className="mx-auto mt-2 max-w-md text-pretty text-[14px] leading-6 text-[#616a64] sm:text-[15px] lg:mx-0">
              The page you&apos;re looking for doesn&apos;t exist, was moved, or the link has a typo.
            </p>

            {path ? (
              <code className="mx-auto mt-4 flex w-fit lg:mx-0 max-w-full items-center gap-2 rounded-lg border border-[#e3e5e1] bg-[#fafbf9] px-3 py-1.5 text-[12.5px] text-[#4b544e]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d03b3b]" aria-hidden="true" />
                <span className="truncate">{path}</span>
              </code>
            ) : null}

            {suggestion ? (
              <Link
                href={suggestion.href}
                className="group mx-auto mt-4 flex w-fit max-w-full items-center gap-3 rounded-xl border border-[#cfe3d4] bg-white lg:mx-0 py-2.5 pl-3 pr-4 text-left transition hover:bg-[#eaf4e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2e7d4f] text-white">
                  <Icon className="h-4 w-4"><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-[#2b5d4a]">Did you mean</span>
                  <span className="block truncate text-[14px] font-semibold text-[#1a201c]">{suggestion.label}</span>
                </span>
              </Link>
            ) : null}

            <div className="mx-auto mt-6 flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              <Link href="/" className={buttonClassName("primary", "lg")}>
                <Icon className="h-4 w-4"><path d="m3 11 9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" /></Icon>
                Back to home
              </Link>
              {back ? (
                <button type="button" onClick={() => window.history.back()} className={buttonClassName("secondary", "lg")}>
                  <Icon className="h-4 w-4"><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>
                  Go back
                </button>
              ) : (
                <Link href={FIND_GIGS_HREF} className={buttonClassName("secondary", "lg")}>
                  Browse gigs
                </Link>
              )}
            </div>
          </div>
        </section>

        <nav aria-label="Popular pages" className="mt-8 w-full max-w-5xl sm:mt-10">
          <h2 className="mb-2.5 px-1 text-[12.5px] font-medium text-[#616a64]">Or jump to</h2>
          <ul className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 sm:gap-3 lg:grid-cols-4">
            {LINKS.map((link) => (
              <li key={link.title} className={styles.rise}>
                <a
                  href={link.href}
                  className="group flex h-full items-center gap-3 rounded-xl border border-[#e3e5e1] bg-white p-3.5 shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)] transition hover:-translate-y-0.5 hover:border-[#cfd5cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 sm:p-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe9da] bg-[linear-gradient(160deg,#f3f9ef,#e6f2e0)] text-[#2e7d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(34,45,37,0.06)] transition group-hover:bg-[#2e7d4f] group-hover:bg-none group-hover:text-white">
                    <Icon className="h-[18px] w-[18px]">{link.icon}</Icon>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold leading-5 text-[#1a201c]">{link.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-[#7a827c]">{link.body}</span>
                  </span>
                  <span className="shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#616a64]">
                    <Icon className="h-4 w-4"><path d="m9 6 6 6-6 6" /></Icon>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <footer className="border-t border-[#e6ebe2]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3.5 py-4 text-[12px] text-[#7a827c] sm:px-5 md:px-6 lg:px-7 2xl:px-8">
          <span>© {new Date().getFullYear()} Reelencer</span>
          <span className="flex gap-4">
            <Link href="/terms" className="font-semibold text-[#4b544e] transition hover:text-[#2e7d4f]">Terms</Link>
            <Link href="/privacy" className="font-semibold text-[#4b544e] transition hover:text-[#2e7d4f]">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
