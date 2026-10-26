"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SVGProps } from "react";
import { BrandLogo } from "@/app/_components/BrandLogo";
import DashboardWalletView from "@/app/dashboard/DashboardWalletView";
import { cx, getInitials } from "@/app/dashboard/dashboardUi";
import { TAKE_TIMELINE, demoPayoutBatches, type DemoWallet } from "@/lib/reelKit";

/*
 * Recording screen for Content Posting reels: the real creator wallet view, filled with the gig's sample figures,
 * inside a copy of the dashboard shell. Creators film it (usually a laptop, shot on a phone). A take counts the
 * figures up from zero, then glides down to the payout history; nothing else appears on screen until the take ends.
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
const readTouchScreen = () => window.matchMedia("(pointer: coarse)").matches;

/** Phones: a full-width Play button and labelled icon tiles. Larger screens: one row with keyboard hints. */
function ControlButton({ label, short, shortcut, onClick, active = false, primary = false, children }: { label: string; short?: string; shortcut?: string; onClick: () => void; active?: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={primary ? undefined : active}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        primary
          ? "h-12 w-full gap-2 bg-white px-4 text-[15px] text-[#101814] hover:bg-white/90 sm:h-11 sm:w-auto sm:px-3 sm:text-[13px]"
          : cx("min-h-14 min-w-0 flex-col gap-1 px-1 py-1.5 text-[10.5px] sm:h-11 sm:min-h-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-0 sm:text-[13px]", active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white")
      )}
    >
      {children}
      {primary ? <span>{label}</span> : <span aria-hidden="true" className="max-w-full truncate leading-none"><span className="sm:hidden">{short ?? label}</span><span className="hidden sm:inline">{label}</span></span>}
      {shortcut ? <kbd className="hidden rounded border border-current/30 px-1 font-sans text-[10.5px] font-medium opacity-60 lg:inline">{shortcut}</kbd> : null}
    </button>
  );
}

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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Pointer = { x: number; y: number; visible: boolean; pressed: boolean; touch: boolean };
type Point = { x: number; y: number };

/** The on-screen hand of the take: a mouse pointer on laptops, a fingertip on touch screens. */
function TakePointer({ pointer }: { pointer: Pointer }) {
  if (!pointer.visible) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-50" style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}>
      {pointer.touch ? (
        <span className={cx("block h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-[#1a201c]/25 shadow-[0_4px_14px_rgba(0,0,0,0.25)] backdrop-blur-[1px] transition-transform duration-150", pointer.pressed ? "scale-75 bg-[#1a201c]/40" : "scale-100")} />
      ) : (
        <span className="relative block">
          {pointer.pressed ? <span className="absolute -left-3 -top-3 h-7 w-7 rounded-full bg-[#2e7d4f]/25 motion-safe:animate-ping" /> : null}
          <svg viewBox="0 0 24 24" className={cx("h-6 w-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)] transition-transform duration-100", pointer.pressed && "scale-90")}>
            <path d="M5 3.2v15.6l4.1-3.9 2.6 6 2.5-1.1-2.6-5.9h5.7z" fill="#111" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

export default function DemoWalletStudio({ wallet, now }: { wallet: DemoWallet; now: number }) {
  const [name, setName] = useState(wallet.name);
  const [progress, setProgress] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [countdownOn, setCountdownOn] = useState(true);
  /** From Play until the take ends: nothing but the wallet may appear on screen. */
  const [taking, setTaking] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [editing, setEditing] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [pointer, setPointer] = useState<Pointer>({ x: 0, y: 0, visible: false, pressed: false, touch: false });
  const pointerAt = useRef<Point>({ x: 0, y: 0 });
  const pointerFrame = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  const greeting = useSyncExternalStore(subscribeNoop, readGreeting, () => "Welcome back");
  const fullscreen = useSyncExternalStore(subscribeFullscreen, readFullscreen, () => false);
  const fullscreenEnabled = useSyncExternalStore(subscribeNoop, readFullscreenEnabled, () => false);
  // Payout dates and "5d ago" labels depend on the viewer's clock and timezone, which the server can't match, so
  // the wallet renders in the browser only (a skeleton on the server) and hydration never disagrees.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const touchScreen = useSyncExternalStore(subscribeNoop, readTouchScreen, () => false);
  const taps = useRef<number[]>([]);
  const scrolledAt = useRef(0);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const scrollFrame = useRef(0);
  const idleTimer = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const busy = countdown > 0 || progress < 1;

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    cancelAnimationFrame(frame.current);
    cancelAnimationFrame(scrollFrame.current);
    cancelAnimationFrame(pointerFrame.current);
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

  /** One scroll flick: fast at first, then easing off like trackpad momentum. */
  const flick = useCallback((by: number, ms: number) => {
    const main = mainRef.current;
    if (!main) return;
    const from = main.scrollTop;
    const start = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, Math.max(0, (time - start) / ms));
      main.scrollTop = from + by * easeOut(t);
      if (t < 1) scrollFrame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(step);
  }, []);

  /** Moves the take's pointer along a gentle arc, the way a hand moves a mouse rather than a straight line. */
  const movePointer = useCallback((to: Point, ms: number) => {
    const from = { ...pointerAt.current };
    const start = performance.now();
    const arc = Math.min(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.18);
    const step = (time: number) => {
      const t = Math.min(1, Math.max(0, (time - start) / ms));
      const e = easeInOut(t);
      const lift = Math.sin(Math.PI * t) * arc;
      const point = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - lift };
      pointerAt.current = point;
      setPointer((current) => ({ ...current, ...point }));
      if (t < 1) pointerFrame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = requestAnimationFrame(step);
  }, []);

  const placePointer = useCallback((point: Point, touch: boolean, visible = true) => {
    pointerAt.current = point;
    setPointer({ ...point, visible, pressed: false, touch });
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setTaking(false);
    setPointer((current) => ({ ...current, visible: false }));
    setCountdown(0);
    setProgress(1);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [clearTimers]);

  const play = useCallback(() => {
    clearTimers();
    setEditing(false);
    setHasPlayed(true);
    setTaking(true);
    setProgress(0);
    // The bar hides the moment Play is pressed and stays hidden, countdown included, until the take ends.
    window.clearTimeout(idleTimer.current);
    setControlsVisible(false);
    mainRef.current?.scrollTo({ top: 0 });
    setPointer((current) => ({ ...current, visible: false }));
    // Close any payout cycle the previous take opened.
    mainRef.current?.querySelectorAll<HTMLButtonElement>("#wallet-cycles ~ * button[aria-expanded='true'], [aria-labelledby='wallet-cycles'] button[aria-expanded='true']").forEach((button) => button.click());
    // Keep the screen awake while it is being filmed.
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!wakeLock.current && nav.wakeLock) nav.wakeLock.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => undefined);
    // The take follows TAKE_TIMELINE: count-up, a few scroll flicks, then a click that opens the latest cycle.
    const run = () => {
      setCountdown(0);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const { scrollAtMs, flicks, openAtMs, clickDelayMs, endMs } = TAKE_TIMELINE;
      later(() => { setTaking(false); setPointer((current) => ({ ...current, visible: false })); }, endMs);
      if (autoScroll) {
        const main = mainRef.current;
        const touch = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
        const centre = (element: Element | null | undefined, dx = 0.5, dy = 0.5): Point | null => {
          const rect = element?.getBoundingClientRect();
          return rect && rect.width ? { x: rect.left + rect.width * dx, y: rect.top + rect.height * dy } : null;
        };
        const cyclesSection = () => main?.querySelector("[aria-labelledby='wallet-cycles']");
        // The person watches the number climb with the pointer resting on it.
        if (!touch && !reduced) {
          later(() => placePointer({ x: window.innerWidth * 0.66, y: window.innerHeight * 0.78 }, false), 150);
          later(() => {
            const card = centre(main?.querySelector("[aria-label='Reel earnings summary'] dl > div"), 0.42, 0.62);
            if (card) movePointer(card, 950);
          }, 650);
        }
        // Scroll down in a few flicks, overshooting a touch and correcting, like a hand on a trackpad.
        later(() => {
          if (!main) return;
          const max = main.scrollHeight - main.clientHeight;
          const section = cyclesSection();
          const target = section ? Math.min(max, Math.max(0, section.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 12)) : max;
          const total = target - main.scrollTop;
          if (reduced || total < 8) { main.scrollTop = target; return; }
          const overshoot = Math.min(28, Math.max(0, max - target), total * 0.1);
          const amounts = total < 120 ? [total] : [total * 0.4, total * 0.33, total * 0.27 + overshoot, -overshoot];
          amounts.forEach((amount, index) => {
            const [offset, duration] = flicks[index] ?? flicks[flicks.length - 1];
            later(() => {
              flick(amount, duration);
              if (touch && amount > 0) {
                // A fingertip swipes up while the page moves.
                const x = window.innerWidth * (0.56 + index * 0.03);
                const y = window.innerHeight * 0.74;
                placePointer({ x, y }, true);
                movePointer({ x: x - 6, y: y - Math.min(170, amount * 0.6) }, duration * 0.8);
                later(() => setPointer((current) => ({ ...current, visible: false })), duration * 0.85);
              } else if (!touch) {
                // The hand drifts a little on the trackpad between flicks.
                movePointer({ x: pointerAt.current.x + 8 - index * 5, y: pointerAt.current.y + (amount > 0 ? 10 : -6) }, duration);
              }
            }, offset);
          });
        }, scrollAtMs);
        // Open the latest payout cycle: travel to it, press, release.
        if (!reduced) {
          later(() => {
            const button = [...(cyclesSection()?.querySelectorAll<HTMLButtonElement>("button[aria-expanded]") ?? [])].find((candidate) => candidate.getClientRects().length > 0);
            const spot = centre(button, touch ? 0.5 : 0.08, 0.5);
            if (!button || !spot) return;
            if (!touch) movePointer(spot, clickDelayMs - 120);
            later(() => {
              if (touch) placePointer(spot, true);
              setPointer((current) => ({ ...current, pressed: true }));
              later(() => {
                setPointer((current) => ({ ...current, pressed: false }));
                button.click();
                if (touch) later(() => setPointer((current) => ({ ...current, visible: false })), 260);
                else later(() => movePointer({ x: pointerAt.current.x + Math.min(320, window.innerWidth * 0.2), y: pointerAt.current.y + 40 }, 900), 450);
              }, 140);
            }, clickDelayMs);
          }, openAtMs);
        }
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
    if (!countdownOn) return run();
    // The countdown is silent: the screen holds at ₹0 (trim it later) while the creator frames the shot.
    setCountdown(3);
    later(() => setCountdown(2), 1000);
    later(() => setCountdown(1), 2000);
    later(run, TAKE_TIMELINE.countdownMs);
  }, [autoScroll, clearTimers, countdownOn, flick, later, movePointer, placePointer]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']") || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      // Mid-take only Escape or R stop it (and bring the controls back); other keys would show the bar on camera.
      if (taking) {
        if (key === "escape" || key === "r") { reset(); showControls(); }
        return;
      }
      if (key === " " || key === "enter") {
        // Let focused buttons act on their own; Space anywhere else plays a take.
        if (target.closest("button, a")) return;
        event.preventDefault();
        play();
        return;
      } else if (key === "f" && fullscreenEnabled) toggleFullscreen();
      else if (key === "s") setAutoScroll((value) => !value);
      else if (key === "r") reset();
      else if (key === "h") { window.clearTimeout(idleTimer.current); setControlsVisible(false); return; }
      else if (key === "escape") setEditing(false);
      else return;
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenEnabled, play, reset, showControls, taking, toggleFullscreen]);

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

  return (
    <div
      className={cx(
        "creator-dashboard-theme relative flex h-[100dvh] overflow-hidden bg-[#f8f4ec] text-[#20352c] [font-family:var(--font-geist-sans)]",
        (taking || (!controlsVisible && !editing)) && "cursor-none"
      )}
      // During a take, taps and mouse movement never bring the controls back into the shot.
      onPointerMove={taking ? undefined : (event) => {
        // Touch moves are part of a swipe, and moves right after a scroll are the hand still scrolling.
        if (event.pointerType === "touch" || performance.now() - scrolledAt.current < 500) return;
        showControls();
      }}
      onPointerDown={
        taking
          ? () => {
              // There is no Esc on a phone: three quick taps stop the take and bring the controls back.
              const now = performance.now();
              taps.current = [...taps.current.filter((time) => now - time < 700), now];
              if (taps.current.length >= 3) {
                taps.current = [];
                reset();
                showControls();
              }
            }
          : showControls
      }
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
          onScroll={() => {
            // Scrolling the page by hand hides the controls so they never sit over the part being looked at;
            // a tap or mouse move brings them back. The take's own scrolling happens while they are hidden anyway.
            if (taking || editing) return;
            scrolledAt.current = performance.now();
            window.clearTimeout(idleTimer.current);
            setControlsVisible(false);
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-28 pt-4 [scrollbar-width:none] min-[380px]:px-4 sm:px-5 sm:pt-5 md:px-6 lg:px-7 xl:pt-7 2xl:px-8"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) event.preventDefault();
          }}
        >
          <DashboardWalletView
            loading={!mounted}
            payoutBatches={mounted ? batches : []}
            accountEarnings={accountEarnings}
            earningsLoading={!mounted}
            onOpenAccounts={() => undefined}
            assignmentsCount={wallet.approvedReels > 0 ? 1 : 0}
            workerId="DEMO"
          />
        </main>
      </div>

      <TakePointer pointer={pointer} />

      {/* Recording controls: hidden while idle so the filmed screen is just the wallet. */}
      <div
        className={cx(
          "fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition duration-300 motion-reduce:transition-none",
          (controlsVisible || editing) && !taking ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
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
          <p className="w-full max-w-md rounded-2xl bg-[#101814]/85 px-4 py-2.5 text-center text-[12.5px] leading-[1.15rem] text-white/85 backdrop-blur sm:w-auto sm:max-w-xl sm:rounded-full sm:py-1.5 sm:text-[12px]">
            {touchScreen ? (
              <>Start your camera, then tap <span className="font-semibold text-white">Play take</span>. Everything here disappears until the take ends. To stop early, tap the screen three times.</>
            ) : (
              <>Start recording, then press <kbd className="font-sans font-semibold text-white">Space</kbd> or click <span className="font-semibold text-white">Play take</span>. Everything here disappears until the take ends; press <kbd className="font-sans font-semibold text-white">Esc</kbd> to stop early.</>
            )}
          </p>
        ) : null}
        <div role="toolbar" aria-label="Recording controls" className="flex w-full max-w-md flex-col gap-1.5 rounded-2xl bg-[#101814]/90 p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] backdrop-blur sm:w-auto sm:max-w-full sm:flex-row sm:items-center sm:gap-1">
          <ControlButton primary label={hasPlayed ? "Play again" : "Play take"} shortcut="Space" onClick={play}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z" /></svg>
          </ControlButton>
          <div className="grid auto-cols-fr grid-flow-col gap-1 sm:flex sm:items-center">
          <ControlButton label="3s countdown" short="Timer" active={countdownOn} onClick={() => setCountdownOn((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="11" r="6.5" /><path d="M10 7.5V11l2 1.5M8 2.5h4" /></svg>
          </ControlButton>
          <ControlButton label="Auto-browse" short="Browse" shortcut="S" active={autoScroll} onClick={() => setAutoScroll((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><rect x="5" y="2.5" width="10" height="15" rx="2" /><path d="M10 6v6m-2.5-2.5L10 12l2.5-2.5" /></svg>
          </ControlButton>
          <ControlButton label="Reset" shortcut="R" onClick={reset}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5" /></svg>
          </ControlButton>
          <ControlButton label="Name" active={editing} onClick={() => setEditing((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="m12.5 4.5 3 3L8 15H5v-3z" /></svg>
          </ControlButton>
          {fullscreenEnabled ? (
            <ControlButton label={fullscreen ? "Exit full screen" : "Full screen"} short={fullscreen ? "Exit" : "Full"} shortcut="F" active={fullscreen} onClick={toggleFullscreen}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><path d={fullscreen ? "M8 3v5H3m14 0h-5V3M3 12h5v5m4 0v-5h5" : "M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"} /></svg>
            </ControlButton>
          ) : null}
          <ControlButton label="Hide" shortcut="H" onClick={() => { window.clearTimeout(idleTimer.current); setEditing(false); setControlsVisible(false); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5ZM4 16 16 4" /></svg>
          </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}
