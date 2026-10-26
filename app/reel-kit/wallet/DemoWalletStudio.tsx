"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SVGProps } from "react";
import { BrandLogo } from "@/app/_components/BrandLogo";
import DashboardWalletView from "@/app/dashboard/DashboardWalletView";
import { cx, formatMoney, getInitials } from "@/app/dashboard/dashboardUi";
import { REEL_KIT_MESSAGE, TAKE_TIMELINE, demoPayoutBatches, type DemoWallet } from "@/lib/reelKit";

/*
 * Recording screen for Content Posting reels: the real creator wallet view, filled with the gig's sample figures,
 * inside a copy of the dashboard shell. Creators film it (usually a laptop, shot on a phone). A take counts the
 * figures up from zero and ends on a payout notification; the controls hide themselves so they stay out of the shot.
 * The brand line reads "Demo workspace" so the screen never passes as a real account.
 */

const CONTROLS_IDLE_MS = 2600;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type IconProps = SVGProps<SVGSVGElement>;
// Mirrors the dashboard navigation icons so the filmed screen matches the real app.
const NavIcons = {
  jobs: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="5" y="4.5" width="14" height="16" rx="2.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 4.5h6v3H9z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10h7M8.5 14h7" strokeLinecap="round" />
    </svg>
  ),
  dashboard: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}>
      <rect x="4.5" y="4.5" width="6.25" height="8.5" rx="1.75" />
      <rect x="4.5" y="15.5" width="6.25" height="4" rx="1.5" />
      <rect x="13.25" y="4.5" width="6.25" height="4" rx="1.5" />
      <rect x="13.25" y="11" width="6.25" height="8.5" rx="1.75" />
    </svg>
  ),
  find: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </svg>
  ),
  accounts: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="11" height="11" rx="3.2" />
      <circle cx="9" cy="9" r="2.4" />
      <path d="M17.5 9.5h.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9.5 18v-.5" />
      <path d="m13.5 17.5 1.8-1.8 1.6 1.4 2.1-2.6" />
    </svg>
  ),
  messages: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M5.5 6.5h13A1.5 1.5 0 0 1 20 8v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  wallet: (props: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 18H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M16 12h3.5" strokeLinecap="round" />
      <circle cx="15.25" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M7 6V5.5A1.5 1.5 0 0 1 8.5 4h8" strokeLinecap="round" />
    </svg>
  ),
};
const NAV_GROUPS = [
  { label: "Work", items: [["jobs", "Jobs"], ["dashboard", "Dashboard"], ["find", "Find gigs"], ["accounts", "Linked"]] },
  { label: "Earnings & updates", items: [["messages", "Messages"], ["wallet", "Wallet"]] },
] as const;

const subscribeNoop = () => () => {};
const readGreeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};
const subscribeFullscreen = (listener: () => void) => {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
};
const readFullscreen = () => Boolean(document.fullscreenElement);
// iPhone Safari has no element fullscreen; the button hides there and the page is already edge to edge.
const readFullscreenEnabled = () => Boolean(document.fullscreenEnabled);

function ControlButton({ label, shortcut, onClick, active = false, primary = false, children }: { label: string; shortcut?: string; onClick: () => void; active?: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={primary ? undefined : active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(
        "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        primary ? "bg-white text-[#101814] hover:bg-white/90" : active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      {children}
      <span className={primary ? "" : "sr-only sm:not-sr-only"}>{label}</span>
      {shortcut ? <kbd className="hidden rounded border border-current/30 px-1 font-sans text-[10.5px] font-medium opacity-60 lg:inline">{shortcut}</kbd> : null}
    </button>
  );
}

const PREVIEW_LOOP_MS = TAKE_TIMELINE.endMs + 1500;

/** `preview` is the looping, control-free thumbnail embedded in the creator's reel kit. */
/** Glow around the Reel earnings card while the figures count up: draws the eye in the first beat of the take. */
function spotlight(element: Element | null | undefined) {
  element?.animate(
    [
      { boxShadow: "0 0 0 0 rgba(46,125,79,0)", transform: "scale(1)" },
      { boxShadow: "0 0 0 6px rgba(46,125,79,0.28), 0 18px 40px -18px rgba(46,125,79,0.55)", transform: "scale(1.012)", offset: 0.45 },
      { boxShadow: "0 0 0 0 rgba(46,125,79,0)", transform: "scale(1)" },
    ],
    { duration: TAKE_TIMELINE.countUpMs + 700, easing: "ease-in-out" }
  );
}

export default function DemoWalletStudio({ wallet, now, preview = false }: { wallet: DemoWallet; now: number; preview?: boolean }) {
  const [name, setName] = useState(wallet.name);
  const [progress, setProgress] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [countdownOn, setCountdownOn] = useState(true);
  const [toast, setToast] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [editing, setEditing] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const mainRef = useRef<HTMLElement>(null);
  const greeting = useSyncExternalStore(subscribeNoop, readGreeting, () => "Welcome back");
  const fullscreen = useSyncExternalStore(subscribeFullscreen, readFullscreen, () => false);
  const fullscreenEnabled = useSyncExternalStore(subscribeNoop, readFullscreenEnabled, () => false);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const idleTimer = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const busy = countdown > 0 || progress < 1;

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    cancelAnimationFrame(frame.current);
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => () => void wakeLock.current?.release().catch(() => undefined), []);

  const later = useCallback((callback: () => void, ms: number) => {
    timers.current.push(window.setTimeout(callback, ms));
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const reset = useCallback(() => {
    clearTimers();
    setCountdown(0);
    setProgress(1);
    setToast(false);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [clearTimers]);

  const play = useCallback(() => {
    clearTimers();
    setEditing(false);
    setHasPlayed(true);
    setToast(false);
    setProgress(0);
    mainRef.current?.scrollTo({ top: 0 });
    // Keep the laptop awake while it is being filmed.
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!preview && !wakeLock.current && nav.wakeLock) nav.wakeLock.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => undefined);
    // The take follows TAKE_TIMELINE, the same timeline the creator's storyboard is written against.
    const run = () => {
      setCountdown(0);
      setControlsVisible(false);
      // The embedded thumbnail tells the reel kit when a take starts, so its timeline and storyboard follow along.
      if (preview && window.parent !== window) window.parent.postMessage({ source: REEL_KIT_MESSAGE, type: "take-start" }, window.location.origin);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      later(() => setToast(true), TAKE_TIMELINE.toastAtMs);
      if (autoScroll) {
        later(() => {
          const target = mainRef.current?.querySelector("#wallet-cycles")?.closest("section");
          target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        }, TAKE_TIMELINE.scrollAtMs);
      }
      if (reduced) return setProgress(1);
      spotlight(mainRef.current?.querySelector("[aria-label='Reel earnings summary']"));
      const start = performance.now();
      const tick = (time: number) => {
        // A frame's timestamp can precede `start`; clamp so figures never dip below zero.
        const t = Math.min(1, Math.max(0, (time - start) / TAKE_TIMELINE.countUpMs));
        setProgress(easeOut(t));
        if (t < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };
    if (!countdownOn || preview) return run();
    // The countdown lives in the control bar, which hides before the take starts, so the shot stays clean.
    setCountdown(3);
    later(() => setCountdown(2), 1000);
    later(() => setCountdown(1), 2000);
    later(run, TAKE_TIMELINE.countdownMs);
  }, [autoScroll, clearTimers, countdownOn, later, preview]);

  // The thumbnail replays the take on a loop; reduced motion keeps it on the finished frame.
  useEffect(() => {
    if (!preview || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const first = window.setTimeout(play, 600);
    const loop = window.setInterval(play, PREVIEW_LOOP_MS);
    return () => { window.clearTimeout(first); window.clearInterval(loop); };
  }, [play, preview]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (preview) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']") || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "enter") {
        // Let focused buttons act on their own; Space anywhere else plays a take.
        if (target.closest("button, a")) return;
        event.preventDefault();
        play();
      } else if (key === "f" && fullscreenEnabled) toggleFullscreen();
      else if (key === "t") setToast((value) => !value);
      else if (key === "s") setAutoScroll((value) => !value);
      else if (key === "r") reset();
      else if (key === "h") { window.clearTimeout(idleTimer.current); setControlsVisible(false); return; }
      else if (key === "escape") setEditing(false);
      else return;
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenEnabled, play, preview, reset, showControls, toggleFullscreen]);

  const scaled = useMemo(() => {
    const money = (value: number) => Math.round(value * progress * 100) / 100;
    return {
      approved: money(wallet.approved),
      pending: money(wallet.pending),
      approvedReels: Math.round(wallet.approvedReels * progress),
      pendingReels: Math.round(wallet.pendingReels * progress),
    };
  }, [progress, wallet]);
  const accountEarnings = useMemo(
    () => ({ ...scaled, accountCount: 1, missingCounts: 0, breakdown: [] }),
    [scaled]
  );
  const batches = useMemo(() => demoPayoutBatches({ ...wallet, name }, now, progress), [name, now, progress, wallet]);
  const displayName = name.trim() || "Creator";
  const firstName = displayName.split(/\s+/)[0];
  const initials = getInitials(displayName);
  const toastAmount = wallet.pendingWithdrawal > 0 ? wallet.pendingWithdrawal : wallet.approved;
  const toastDetail = wallet.pendingWithdrawal > 0 ? "Withdrawal sent to your UPI" : `From ${wallet.approvedReels} approved reel${wallet.approvedReels === 1 ? "" : "s"}`;

  return (
    <div
      className={cx(
        "creator-dashboard-theme relative flex h-[100dvh] overflow-hidden bg-[#f8f4ec] text-[#20352c] [font-family:var(--font-geist-sans)]",
        (preview || (!controlsVisible && !editing)) && "cursor-none"
      )}
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      {/* Desktop sidebar */}
      <aside className="hidden h-full w-[248px] shrink-0 flex-col border-r border-[#e3e5e1] bg-white xl:flex 2xl:w-[264px]">
        <div className="flex h-[68px] shrink-0 items-center border-b border-[#ebedea] px-3">
          <div className="flex items-center gap-3 py-1.5 pl-1.5 pr-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#ffffff,#eef3ec)] shadow-[0_1px_2px_rgba(26,32,28,0.08),inset_0_0_0_1px_rgba(26,32,28,0.07),inset_0_1px_0_rgba(255,255,255,0.9)]">
              <BrandLogo className="h-[30px] w-[30px]" sizes="32px" />
            </span>
            <span className="min-w-0">
              <span className="block font-[Georgia,Times_New_Roman,serif] text-[18px] font-bold leading-[1.1] tracking-[-0.015em] text-[#1a201c]">Reelencer</span>
              <span className="mt-1 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#2e7d4f]" aria-hidden="true" />
                <span className="text-[11.5px] font-medium leading-none text-[#6b736d]">Demo workspace</span>
              </span>
            </span>
          </div>
        </div>
        <nav aria-label="Dashboard sections" className="min-h-0 flex-1 space-y-5 overflow-hidden px-3 pt-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2.5 pb-1 text-[11.5px] font-semibold text-[#7a827c]">{group.label}</div>
              <div className="grid gap-0.5">
                {group.items.map(([id, label]) => {
                  const NavIcon = NavIcons[id];
                  const active = id === "wallet";
                  return (
                    <span key={id} aria-current={active ? "page" : undefined} className={cx("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-semibold", active ? "bg-[#eceeea] text-[#1a201c]" : "text-[#4b544e]")}>
                      <NavIcon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-[#1a201c]" : "text-[#7a827c]")} />
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-[#ebedea] p-2">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[12px] font-bold text-white">
              {initials}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#2e7d4f]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{displayName}</span>
              <span className="block text-[11.5px] text-[#7a827c]">Creator</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md">
          <div className="flex h-[60px] items-center justify-between gap-3 px-3.5 sm:px-5 md:h-[68px] md:px-6 lg:px-7 2xl:px-8">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e6ebe2] bg-white text-[#41695b] md:hidden" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
            </span>
            <div className="flex min-w-0 items-center justify-center gap-2.5 md:justify-start md:gap-3">
              <span aria-hidden="true" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe9da] bg-[linear-gradient(160deg,#f3f9ef,#e6f2e0)] text-[#2e7d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(34,45,37,0.06)] md:flex">
                <NavIcons.wallet className="h-[19px] w-[19px]" />
              </span>
              <div className="min-w-0 text-center md:text-left">
                <div className="hidden truncate text-[11.5px] font-semibold text-[#7a877f] md:block">
                  {greeting}<span className="text-[#41695b]">, {firstName}</span>
                </div>
                <h1 className="flex items-center justify-center gap-1.5 text-[16px] font-semibold text-[#20352c] md:justify-start md:text-[20px] md:leading-tight md:tracking-[-0.02em]">
                  <NavIcons.wallet aria-hidden="true" className="h-4 w-4 shrink-0 text-[#2e7d4f] md:hidden" />
                  Wallet
                  <span className="rounded-full bg-[#eef1ed] px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-[#6b736d] xl:hidden">Demo</span>
                </h1>
              </div>
            </div>
            <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex" aria-hidden="true">
              <span className="relative flex h-9 w-full max-w-[480px] items-center rounded-lg border border-[#e3e5e1] bg-[#f3f4f1] pl-9 text-[13.5px] text-[#7a827c]">
                <NavIcons.find className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                Search gigs or brands
                <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-[#dfe2de] bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium lg:block">⌘K</kbd>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2" aria-hidden="true">
              <span className="relative inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full border border-[#e3e5e1] bg-white text-[12px] font-semibold text-[#4b544e] sm:w-auto sm:px-3">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cx("h-[18px] w-[18px] sm:h-4 sm:w-4", busy && "animate-spin motion-reduce:animate-none")}>
                  <path d="M16 10a6 6 0 0 1-10.4 4.1M4 10a6 6 0 0 1 10.4-4.1" />
                  <path d="M14.6 3.2v2.9h-2.9M5.4 16.8v-2.9h2.9" />
                </svg>
                <span className="hidden whitespace-nowrap sm:inline">{busy ? "Refreshing…" : "Updated just now"}</span>
                <span className={cx("absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white sm:static sm:h-2 sm:w-2 sm:border-0", busy ? "animate-pulse bg-[#d99a06]" : "dashboard-live-dot bg-[#2e7d4f]")} />
              </span>
              <span className="hidden h-9 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] xl:inline-flex">
                <NavIcons.find className="h-4 w-4" />
                Find gigs
              </span>
              <span className="hidden h-10 w-10 items-center justify-center rounded-full border border-[#e6ebe2] bg-white text-[#41695b] md:flex">
                <NavIcons.messages className="h-[18px] w-[18px]" />
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2b24] text-[14px] font-bold text-white xl:hidden">{initials}</span>
            </div>
          </div>
        </header>

        {/* Links in the real wallet would leave the recording screen; keep every tap on this page. */}
        <main
          ref={mainRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-28 pt-4 [scrollbar-width:none] min-[380px]:px-4 sm:px-5 sm:pt-5 md:px-6 lg:px-7 xl:pt-7 2xl:px-8"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) event.preventDefault();
          }}
        >
          <DashboardWalletView
            loading={false}
            payoutBatches={batches}
            accountEarnings={accountEarnings}
            earningsLoading={false}
            onOpenAccounts={() => undefined}
            assignmentsCount={wallet.approvedReels > 0 ? 1 : 0}
            workerId="DEMO"
          />
        </main>
      </div>

      {/* Payout notification: the closing beat of the take. */}
      <div
        role="status"
        aria-live="polite"
        className={cx(
          "pointer-events-none fixed inset-x-3 top-3 z-30 mx-auto max-w-sm transition duration-500 ease-[cubic-bezier(.2,.9,.25,1.15)] sm:inset-x-auto sm:right-6 sm:top-5 motion-reduce:transition-none",
          toast ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"
        )}
      >
        {toast ? (
          <div className="flex items-center gap-3 rounded-2xl border border-[#cfe3d4] bg-white/95 p-3.5 pr-5 shadow-[0_18px_40px_-16px_rgba(16,40,26,0.45)] backdrop-blur">
            <span className="dashboard-success-badge relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2e7d4f] text-white">
              <span className="dashboard-success-ring absolute inset-0 rounded-full border-2 border-[#2e7d4f]/40" />
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="dashboard-success-check" d="m5.5 12.5 4.2 4.2L18.5 7.8" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-[#2e7d4f]">Reelencer · now</span>
              <span className="block text-[15px] font-semibold tabular-nums text-[#1a201c]">{formatMoney(toastAmount)} credited</span>
              <span className="block truncate text-[12px] text-[#616a64]">{toastDetail}</span>
            </span>
          </div>
        ) : null}
      </div>

      {/* Recording controls: hidden while idle so the filmed screen is just the wallet. */}
      {preview ? null : <div
        className={cx(
          "fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition duration-300 motion-reduce:transition-none",
          controlsVisible || editing || countdown > 0 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        )}
        onPointerMove={(event) => event.stopPropagation()}
      >
        {editing ? (
          <form
            onSubmit={(event) => { event.preventDefault(); setEditing(false); showControls(); }}
            className="w-full max-w-sm rounded-2xl bg-[#101814]/95 p-4 text-white shadow-2xl backdrop-blur"
          >
            <label htmlFor="demo-name" className="text-[12px] font-semibold text-white/70">Name on screen</label>
            <div className="mt-1.5 flex gap-2">
              <input id="demo-name" autoFocus value={name} maxLength={24} onChange={(event) => setName(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 text-[14px] text-white outline-none focus:border-white/50" />
              <button type="submit" className="h-11 rounded-lg bg-white px-4 text-[13px] font-semibold text-[#101814]">Done</button>
            </div>
            <p className="mt-2 text-[11.5px] leading-4 text-white/55">The figures come from the gig brief, so every creator shows the same numbers.</p>
          </form>
        ) : !hasPlayed ? (
          <p className="rounded-full bg-[#101814]/85 px-3.5 py-1.5 text-center text-[12px] text-white/85 backdrop-blur">
            Start recording, then press <kbd className="font-sans font-semibold text-white">Space</kbd> or tap <span className="font-semibold text-white">Play take</span>. These controls hide on their own.
          </p>
        ) : null}
        <div role="toolbar" aria-label="Recording controls" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-[#101814]/90 p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] backdrop-blur [scrollbar-width:none]">
          <ControlButton primary label={countdown > 0 ? `Starting in ${countdown}` : hasPlayed ? "Play again" : "Play take"} shortcut="Space" onClick={play}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z" /></svg>
          </ControlButton>
          <ControlButton label="3s countdown" active={countdownOn} onClick={() => setCountdownOn((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="11" r="6.5" /><path d="M10 7.5V11l2 1.5M8 2.5h4" /></svg>
          </ControlButton>
          <ControlButton label="Auto-scroll" shortcut="S" active={autoScroll} onClick={() => setAutoScroll((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><rect x="5" y="2.5" width="10" height="15" rx="2" /><path d="M10 6v6m-2.5-2.5L10 12l2.5-2.5" /></svg>
          </ControlButton>
          <ControlButton label="Payout alert" shortcut="T" active={toast} onClick={() => setToast((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 4-1.5 5.5-1.5 5.5h12s-1.5-1.5-1.5-5.5A4.5 4.5 0 0 0 10 3ZM8.5 16a1.6 1.6 0 0 0 3 0" /></svg>
          </ControlButton>
          <ControlButton label="Reset" shortcut="R" onClick={reset}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5" /></svg>
          </ControlButton>
          <ControlButton label="Name" active={editing} onClick={() => setEditing((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="m12.5 4.5 3 3L8 15H5v-3z" /></svg>
          </ControlButton>
          {fullscreenEnabled ? (
            <ControlButton label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" active={fullscreen} onClick={toggleFullscreen}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><path d={fullscreen ? "M8 3v5H3m14 0h-5V3M3 12h5v5m4 0v-5h5" : "M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"} /></svg>
            </ControlButton>
          ) : null}
          <ControlButton label="Hide" shortcut="H" onClick={() => { window.clearTimeout(idleTimer.current); setEditing(false); setControlsVisible(false); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5ZM4 16 16 4" /></svg>
          </ControlButton>
        </div>
      </div>}
    </div>
  );
}
