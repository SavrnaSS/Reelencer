"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

type Audience = "brands" | "creators";

type Props = {
  role: "Admin" | "Worker" | null;
  authResolved: boolean;
  findHref: string;
  dashboardHref: string;
  loginHref: string;
  stats: readonly { value: string; label: string }[];
  /** Email-capture form for signed-out creators (owned by the page so its validation logic stays in one place). */
  /** Signed-out creator email form. `ghost` = invisible height-reserving copy: omit ids and labels. */
  renderLeadForm: (ghost: boolean) => ReactNode;
  onScrollTo: (href: string, label: string) => void;
};

// Creator reels for the hero wall and strip: /public/reels/<slug>.mp4 (540×960 H.264, muted, ≤10s, faststart)
// with a matching <slug>.jpg poster. Labels describe what each clip shows.
const REELS = [
  { slug: "ugc-starter", niche: "UGC starter", payout: "₹2,800" },
  { slug: "drinks-collab", niche: "Drinks collab", payout: "₹3,100" },
  { slug: "campaign-recap", niche: "Campaign recap", payout: "₹3,600" },
  { slug: "side-income", niche: "Side income", payout: "₹2,400" },
  { slug: "paid-ugc", niche: "Paid UGC", payout: "₹3,200" },
] as const;

const COPY: Record<Audience, { eyebrow: string; lines: [string, ReactNode, string]; body: ReactNode }> = {
  brands: {
    eyebrow: "For brands",
    lines: [
      "Effortless",
      <>
        <span className="italic text-[#e7f8da]">creator</span> marketing,
      </>,
      "expertly managed.",
    ],
    body: (
      <>
        Scale sales through creators, <span className="text-white">not ad spend.</span> Reelencer sources creators, manages briefs and approvals, and pays out — so your brand
        shows up organically, every week.
      </>
    ),
  },
  creators: {
    eyebrow: "For creators",
    // Line lengths mirror the brand headline so both views share the same text width.
    lines: [
      "Get paid for",
      <>
        the <span className="italic text-[#e7f8da]">reels</span> you love,
      </>,
      "with zero chasing.",
    ],
    body: (
      <>
        Pick verified brand briefs with the payout shown up front, submit in one place, and <span className="text-white">withdraw to your bank</span> once approved. No
        cold DMs, no invoice chasing.
      </>
    ),
  },
};

const secondaryCta =
  "group inline-flex h-14 items-center justify-center gap-2 rounded-full border border-white/16 bg-white/[0.04] px-7 text-[1rem] font-bold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.08]";

const noopSubscribe = () => () => undefined;
function readViewParam(): Audience | null {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "creator" || view === "creators") return "creators";
  if (view === "brand" || view === "brands") return "brands";
  return null;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}



export function HomeHero({ role, authResolved, findHref, dashboardHref, loginHref, stats, renderLeadForm, onScrollTo }: Props) {
  const [chosen, setAudience] = useState<Audience | null>(null);
  const viewParam = useSyncExternalStore(noopSubscribe, readViewParam, () => null);
  // Explicit choice wins, then ?view=creator|brand (shareable campaign links); everyone else lands on the creator view.
  const audience: Audience = chosen ?? viewParam ?? "creators";
  // Bumped on every user switch: remounts the panel copy so it animates in, from the side the pill moved to.
  const [swap, setSwap] = useState<{ n: number; dir: 1 | -1 } | null>(null);
  const choose = (id: Audience) => {
    if (id === audience) return;
    setAudience(id);
    setSwap((prev) => ({ n: (prev?.n ?? 0) + 1, dir: id === "brands" ? 1 : -1 }));
  };
  const swapKey = swap?.n ?? 0;
  const swapStyle = (index: number) =>
    swap ? ({ ["--rx-dir" as string]: swap.dir, ["--i" as string]: index } as React.CSSProperties) : undefined;


  // Shown under the CTAs in every view, so a first-time visitor always has a low-commitment next step.
  const faqPrompt = (
    <p className="mt-3.5 text-[0.88rem] text-white/60 min-[400px]:text-[0.92rem] md:max-lg:text-center lg:mt-3">
      Have questions first?{" "}
      <button
        type="button"
        onClick={() => onScrollTo("#resources", "Help Center")}
        className="font-bold text-[#9eea6d] underline-offset-4 transition hover:text-white hover:underline"
      >
        Read the FAQ
      </button>
    </p>
  );

  /**
   * One audience's copy + CTAs + social row. Both audiences are rendered stacked in the same grid cell (the
   * inactive one invisible, inert and id-free), so the panel is always as tall as the taller view and nothing
   * below it moves when switching.
   */
  const renderView = (v: Audience, ghost: boolean) => {
    // Only the visible copy is the page heading; the height-reserving ghost must not add a second <h1>.
    const Heading = ghost ? "div" : "h1";
    const c = COPY[v];
    return (
      <div
        key={v}
        aria-hidden={ghost || undefined}
        inert={ghost || undefined}
        className={`flex flex-col [grid-area:1/1] ${ghost ? "invisible pointer-events-none select-none" : ""}`}
      >
            <Heading
              key={ghost ? undefined : `h-${swapKey}`}
              id={ghost ? undefined : "hero-heading"}
              data-page-stagger={ghost ? undefined : true}
              className="mt-6 max-w-[44rem] md:max-lg:mx-auto font-[Georgia,Times_New_Roman,serif] text-[clamp(1.75rem,9.4vw,3.35rem)] font-bold leading-[1.03] tracking-[-0.015em] text-white sm:mt-7 md:text-[3.6rem] land:mt-4 land:text-[2.35rem] lg:text-[clamp(2.5rem,min(4.1vw,7.4svh),3.9rem)] lg-mid:mt-5 lg-short:mt-4"
            >
              <span className={`block ${!ghost && swap ? "rx-swap-line" : ""}`} style={ghost ? undefined : swapStyle(0)}>
                {c.lines[0]}
              </span>
              <span className={`block ${!ghost && swap ? "rx-swap-line" : ""}`} style={ghost ? undefined : swapStyle(1)}>
                {c.lines[1]}
              </span>
              <span className={`hero-accent relative block w-fit pb-2 md:max-lg:mx-auto ${!ghost && swap ? "rx-swap-line" : ""}`} style={ghost ? undefined : swapStyle(2)}>
                {c.lines[2]}
                <svg aria-hidden viewBox="0 0 300 14" preserveAspectRatio="none" className="hero-underline absolute -bottom-0.5 left-0 h-[0.26em] w-full text-[#8fe05f]">
                  <path d="M3 10C60 3.5 150 1.5 297 7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" pathLength={1} />
                </svg>
              </span>
            </Heading>

            <p key={ghost ? undefined : `p-${swapKey}`} style={ghost ? undefined : swapStyle(3)} data-page-stagger={ghost ? undefined : true} className={`mt-5 max-w-[36rem] md:max-lg:mx-auto text-pretty text-[0.98rem] font-medium leading-[1.65] text-white/70 sm:mt-6 sm:text-[1.08rem] xl:text-[1.14rem] land:mt-3 land:text-[0.95rem] lg-mid:mt-4 lg-short:mt-4 lg-short:text-[1rem] lg-short:leading-[1.55] ${!ghost && swap ? "rx-swap-line" : ""}`}>
              {c.body}
            </p>

            {/* CTAs. Their auto margins split the shorter view's reserved space above and below them, so the social row and
                stats stay in the same place in both views without one large gap opening up. */}
            <div key={ghost ? undefined : `c-${swapKey}`} style={ghost ? undefined : swapStyle(4)} data-page-stagger={ghost ? undefined : true} className={`my-auto max-w-[40rem] pt-7 md:max-lg:mx-auto sm:pt-8 land:pt-5 lg-mid:pt-6 lg-short:pt-5 ${!ghost && swap ? "rx-swap-line" : ""}`}>
              {v === "brands" ? (
                <>
                <div className="flex flex-col gap-3 min-[480px]:flex-row md:max-lg:justify-center">
                  <a
                    href="mailto:support@reelencer.com?subject=Creator%20network%20for%20my%20brand"
                    className="group inline-flex min-h-14 items-center justify-between gap-5 rounded-full bg-[#8fe05f] py-2 pl-7 pr-2 text-[1rem] font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.28)] transition hover:-translate-y-0.5 hover:bg-[#9ae86a] hover:shadow-[0_20px_40px_rgba(143,224,95,0.36)]"
                  >
                    Get your creator network
                    <ArrowBadge />
                  </a>
                  <button
                    type="button"
                    onClick={() => onScrollTo("#solution", "How It Works")}
                    className={secondaryCta}
                  >
                    <PlayCircleIcon className="h-[1.15rem] w-[1.15rem] text-[#8fe05f]" />
                    See how it works
                  </button>
                </div>
                {faqPrompt}
                </>
              ) : !authResolved ? (
                <div className="h-14 w-full max-w-md animate-pulse rounded-full bg-white/10" />
              ) : role ? (
                <>
                <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:flex-wrap md:max-lg:justify-center">
                  <Link
                    href={role === "Admin" ? dashboardHref : findHref}
                    className="group inline-flex min-h-14 items-center justify-between gap-6 rounded-full bg-[#8fe05f] py-2 pl-7 pr-2 text-[1rem] font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.28)] transition hover:-translate-y-0.5 hover:bg-[#9ae86a] hover:shadow-[0_20px_40px_rgba(143,224,95,0.36)]"
                  >
                    {role === "Admin" ? "Open admin console" : "Find gigs now"}
                    <ArrowBadge />
                  </Link>
                  <Link href={dashboardHref} className={secondaryCta}>
                    <GridIcon className="h-[1.1rem] w-[1.1rem] text-[#8fe05f]" />
                    Open dashboard
                  </Link>
                </div>
                {role !== "Admin" && faqPrompt}
                </>
              ) : (
                <>
                  {renderLeadForm(ghost)}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 text-[0.88rem] min-[400px]:text-[0.92rem] md:max-lg:justify-center lg:mt-3">
                    <p className="flex min-w-0 items-center gap-2 text-white/60">
                      {/* On desktop the social row is hidden in this view, so a few creator faces carry the proof here. */}
                      <span aria-hidden className="hidden shrink-0 items-center -space-x-2 lg:flex">
                        {REELS.slice(0, 3).map((reel) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={reel.slug} src={`/reels/${reel.slug}.jpg`} alt="" loading="lazy" className="rx-avatar-ring h-7 w-7 rounded-full object-cover" />
                        ))}
                      </span>
                      <span>Already earning?</span>
                      <Link href={loginHref} className="font-bold text-[#9eea6d] underline-offset-4 transition hover:text-white hover:underline">
                        Sign in
                      </Link>
                    </p>
                    <Link
                      href={findHref}
                      className="group/prev inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] pl-3 pr-1 font-bold text-white transition hover:border-[#8fe05f]/50 hover:bg-white/[0.09] lg-short:h-8"
                    >
                      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8fe05f] opacity-60 motion-reduce:hidden" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8fe05f]" />
                      </span>
                      {/* "open" drops on phones so the pill shares one line with the sign-in prompt. */}
                      <span>
                        Preview <span className="max-sm:hidden">open </span>gigs
                      </span>
                      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.08] transition-[transform,background-color] group-hover/prev:translate-x-0.5 group-hover/prev:bg-[#8fe05f]/25 lg-short:h-6 lg-short:w-6">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
                        </svg>
                      </span>
                    </Link>
                  </div>
                  {faqPrompt}
                </>
              )}
            </div>

        {/* Social row sits at the bottom of the view, so it never moves when switching audiences. */}
        <div>
            <div className={`flex items-center gap-3 pt-8 sm:pt-9 md:max-lg:justify-center land:pt-6 lg-mid:pt-7 lg-short:pt-6 lg-tiny:hidden ${v === "creators" && authResolved && !role ? "lg:hidden" : ""}`}>
              <div className="flex shrink-0 items-center -space-x-2.5">
                {REELS.slice(0, 4).map((reel, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={reel.slug}
                    src={`/reels/${reel.slug}.jpg`}
                    alt=""
                    loading="lazy"
                    className={`rx-avatar-ring h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10 ${index === 3 ? "hidden sm:block" : ""}`}
                  />
                ))}
                <span className="rx-avatar-ring grid h-8 w-8 place-items-center rounded-full bg-[#8fe05f] text-[0.66rem] font-black tracking-tighter text-[#0b1914] sm:h-10 sm:w-10 sm:text-[0.68rem]">
                  {stats[0]?.value ?? "18K+"}
                </span>
              </div>
              <p className="min-w-0 text-[0.84rem] leading-snug text-white/65 min-[400px]:text-[0.88rem] sm:text-[0.92rem]">
                <span className="flex items-center gap-1.5 font-bold text-white min-[360px]:whitespace-nowrap md:max-lg:justify-center">
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8fe05f] opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8fe05f]" />
                  </span>
                  Creators across every niche
                </span>
                are shipping brand reels this week.
              </p>
            </div>
        </div>
      </div>
    );
  };

  return (
    <section data-page-motion="hero" aria-labelledby="hero-heading" className="relative mx-auto w-full max-w-7xl px-3.5 pb-12 pt-4 min-[430px]:px-4 sm:px-6 sm:pb-16 md:pt-8 land:pt-2 land:pb-8 lg:flex lg:min-h-[min(calc(100svh-5.75rem),54rem)] lg:flex-col lg:justify-center lg:px-8 lg:py-8 lg-short:py-5">
      <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-12 xl:gap-16">
        {/* Copy column */}
        <div className="relative isolate min-w-0 md:max-lg:mx-auto md:max-lg:max-w-[42rem] md:max-lg:text-center">
          <div aria-hidden className="hero-glow pointer-events-none absolute -left-12 -top-8 -z-10 h-[24rem] w-[115%]" />

          {/* Audience switch: equal-width tabs with a pill that glides (with a little spring) to the active one. */}
          <div
            data-page-stagger
            role="tablist"
            aria-label="Choose your view"
            className="relative inline-grid grid-cols-2 rounded-full border border-white/12 bg-white/[0.05] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md"
          >
            <span
              aria-hidden
              className={`absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-[linear-gradient(180deg,#a5ec78,#86d957)] shadow-[0_6px_18px_rgba(143,224,95,0.4),inset_0_1px_0_rgba(255,255,255,0.45)] transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none ${
                audience === "brands" ? "translate-x-full" : "translate-x-0"
              }`}
            />
            {TABS.map(({ id, label, Icon }) => {
              const active = audience === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="hero-panel"
                  onClick={() => choose(id)}
                  onKeyDown={(e) => {
                    // Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const next = id === "creators" ? "brands" : "creators";
                      choose(next);
                      (e.currentTarget.parentElement?.querySelector(`[data-tab="${next}"]`) as HTMLButtonElement | null)?.focus();
                    }
                  }}
                  data-tab={id}
                  tabIndex={active ? 0 : -1}
                  className={`relative z-10 inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[0.88rem] font-bold transition-[color,transform] duration-300 active:scale-[0.97] sm:h-10 sm:px-5 sm:text-[0.94rem] ${
                    active ? "text-[#0b1914]" : "text-white/70 hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 transition-[opacity,transform] duration-300 ${active ? "scale-100 opacity-100" : "scale-90 opacity-60"}`} />
                  {label}
                </button>
              );
            })}
          </div>

          <div id="hero-panel" role="tabpanel" aria-live="polite" className={`grid ${swap ? "rx-swapping" : ""}`}>
            {renderView(audience, false)}
            {renderView(audience === "creators" ? "brands" : "creators", true)}
          </div>

          {/* Stats */}
          <div data-page-stagger className="mt-7 sm:mt-8 land:mt-5 lg:mt-9 lg-mid:mt-7 lg-short:mt-6">
            <dl className="grid max-w-[40rem] grid-cols-3 md:max-lg:mx-auto md:max-lg:w-full overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
              {stats.map((stat, index) => (
                <StatTile key={stat.label} value={stat.value} label={stat.label} index={index} />
              ))}
            </dl>
          </div>
        </div>

        {/* Desktop: two columns of phones scrolling in opposite directions (pause on hover). */}
        <div data-page-stagger className="rx-reel-wall relative hidden lg:block lg:h-[clamp(26rem,calc(100svh-10rem),44rem)]">
          <div className="grid h-full grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3.5 xl:gap-5">
            {/* Loop length scales with the column's phone count, so both columns move at the same speed. */}
            <ReelColumn reels={REELS.slice(0, 3)} duration={`${REELS.slice(0, 3).length * 14.7}s`} />
            {/* Same top edge as the first column; a negative delay starts it mid-loop so phones never line up row-for-row. */}
            <ReelColumn reels={REELS.slice(3)} reverse duration={`${REELS.slice(3).length * 16.7}s`} delay="-14s" />
          </div>
          <div className="rx-keep-dark absolute -left-8 bottom-[12%] z-10 w-[15rem] rounded-[1.4rem] border border-white/12 bg-[linear-gradient(180deg,#080a09,#181e1b)] p-4 shadow-[0_24px_50px_rgba(0,0,0,0.35)] [transform:translateZ(0)] xl:-left-12 lg-tiny:hidden">
            <div className="flex items-center justify-between text-[0.66rem] font-bold uppercase tracking-[0.16em] text-white/50">
              Paid this month
              <span className="rounded-full border border-[#8fe05f]/40 px-2 py-0.5 text-[#aef07f]">Verified</span>
            </div>
            <div className="mt-2 text-[2rem] font-black leading-none tracking-[-0.05em] text-white">₹48,600</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[72%] rounded-full bg-[#8fe05f]" />
            </div>
            <div className="mt-2 text-[0.75rem] text-white/55">18 reels approved · paid to bank</div>
          </div>
          <div className="rx-keep-dark absolute -right-4 top-[9%] z-10 flex items-center gap-3 rounded-full border border-white/12 bg-[#0b1914] py-2 pl-2 pr-4 shadow-[0_20px_40px_rgba(0,0,0,0.35)] [transform:translateZ(0)] xl:-right-6">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#8fe05f] text-[#0b1914]">✓</span>
            <span className="text-[0.85rem] font-bold text-white">
              Reel approved
              <span className="block text-[0.72rem] font-medium text-white/55">Payout queued · 2m ago</span>
            </span>
          </div>
        </div>
      </div>

      {/* Phones & tablets: staggered phones auto-sliding sideways, each video looping (pause on touch/hover). */}
      <div data-page-stagger className="rx-reel-strip relative -mx-3.5 mt-[clamp(4.5rem,16vw,6rem)] overflow-hidden min-[430px]:-mx-4 sm:-mx-6 lg:hidden">
        <div className="rx-reel-row flex w-max items-center gap-3 pb-16 pt-8">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-3" aria-hidden={copy > 0 || undefined}>
              {REELS.map((reel, index) => (
                <div key={`${copy}-${reel.slug}`} className={index % 2 ? "translate-y-4" : "-translate-y-4"}>
                  <ReelPhone {...reel} size="strip" decorative={copy > 0} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Reel phones (shared by the desktop wall and the mobile strip)
 * ---------------------------------------------------------------------------------------------- */

/** A reel inside a phone frame. Its video only downloads/plays while on screen and loops forever. */
/**
 * One scheduler for every reel video on the page. Decoding many videos at once is the main cost of the hero, so
 * only the most-visible few play (3 on desktop, 2 on phones/tablets); the rest show their poster. Everything pauses
 * while the tab is hidden, and nothing autoplays on Data Saver or slow connections.
 */
const reelPlayback = (() => {
  const visibility = new Map<HTMLVideoElement, number>();
  let frame: number | null = null;
  const limit = () => {
    if (typeof window === "undefined") return 0;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$|^3g$/.test(connection?.effectiveType ?? "")) return 0;
    return window.matchMedia("(min-width: 1024px)").matches ? 3 : 2;
  };
  const apply = () => {
    frame = null;
    const max = document.hidden ? 0 : limit();
    const ranked = [...visibility.entries()].filter(([, ratio]) => ratio > 0.15).sort((a, b) => b[1] - a[1]);
    const playing = new Set(ranked.slice(0, max).map(([video]) => video));
    for (const video of visibility.keys()) {
      if (playing.has(video)) {
        if (video.preload !== "auto") video.preload = "auto";
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    }
  };
  const schedule = () => {
    if (frame === null && typeof window !== "undefined") frame = window.requestAnimationFrame(apply);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", schedule);
  return {
    set(video: HTMLVideoElement, ratio: number) {
      visibility.set(video, ratio);
      schedule();
    },
    remove(video: HTMLVideoElement) {
      visibility.delete(video);
      video.pause();
      schedule();
    },
  };
})();

function ReelPhone({ slug, niche, payout, size, decorative = false }: (typeof REELS)[number] & { size: "wall" | "strip"; decorative?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const video = ref.current;
    if (!video || reduced) return;
    const observer = new IntersectionObserver(([entry]) => reelPlayback.set(video, entry.isIntersecting ? entry.intersectionRatio : 0), {
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
      reelPlayback.remove(video);
    };
  }, [reduced]);

  const wall = size === "wall";
  // Graphite rim with a light edge highlight: reads as a device on light AND dark backgrounds.
  const rim =
    "bg-[linear-gradient(150deg,#5b605d_0%,#26292a_22%,#0e100f_50%,#2a2d2c_78%,#5b605d_100%)] shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_26px_50px_-18px_rgba(0,0,0,0.6)]";
  const sideButton = "absolute w-[3px] bg-[linear-gradient(90deg,#1a1c1b,#4d524f)]";
  return (
    <figure
      aria-hidden={decorative || undefined}
      className={`rx-keep-dark relative shrink-0 ${rim} ${
        wall
          ? "mx-auto w-full max-w-[14.5rem] rounded-[2.45rem] p-[3px] xl:max-w-[15.5rem]"
          : "w-[min(calc(50vw-0.375rem),15rem)] rounded-[2.15rem] p-[3px] sm:w-[min(calc(33.333vw-0.5rem),14.5rem)] sm:rounded-[2.3rem]"
      }`}
    >
      {/* Side buttons: action + volume (left), power (right) */}
      <span aria-hidden className={`${sideButton} -left-[3px] top-[17%] h-[4.5%] rounded-l-[2px]`} />
      <span aria-hidden className={`${sideButton} -left-[3px] top-[25%] h-[8%] rounded-l-[2px]`} />
      <span aria-hidden className={`${sideButton} -left-[3px] top-[35%] h-[8%] rounded-l-[2px]`} />
      <span aria-hidden className={`${sideButton} -right-[3px] top-[27%] h-[12%] rotate-180 rounded-l-[2px]`} />

      {/* Black bezel */}
      <div className={`bg-[#0a0a0a] ${wall ? "rounded-[2.28rem] p-[6px]" : "rounded-[2rem] p-[5px] sm:rounded-[2.15rem]"}`}>
        <div className={`relative isolate aspect-[9/19.5] overflow-hidden bg-[#0b1914] ${wall ? "rounded-[1.9rem]" : "rounded-[1.7rem] sm:rounded-[1.82rem]"}`}>
          <video
            ref={ref}
            src={`/reels/${slug}.mp4`}
            poster={`/reels/${slug}.jpg`}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 z-0 h-full w-full object-cover"
          />
          {/* Overlays sit on their own GPU layer (translateZ) so they stay above the playing, composited video inside the
              animated, masked columns. This used to be a backdrop-filter, which re-ran on every video frame. */}
          {/* Top shade + glass glare */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[32%] bg-[linear-gradient(118deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.04)_30%,transparent_48%),linear-gradient(180deg,rgba(0,0,0,0.34),transparent)] [transform:translateZ(0)]" />
          <span
            aria-hidden
            className={`absolute left-1/2 top-0 z-[3] w-[44%] bg-[#0a0a0a] [transform:translate3d(-50%,0,0)] ${wall ? "h-[1.15rem] rounded-b-[0.9rem]" : "h-[1.05rem] rounded-b-[0.8rem] sm:h-[1.1rem]"}`}
          />
          <div
            className={`absolute z-[2] flex items-center gap-1 rounded-full bg-black/60 font-bold uppercase tracking-[0.12em] text-white [transform:translateZ(0)] ${
              wall ? "left-3 top-7 px-2 py-0.5 text-[0.6rem]" : "left-3 top-6 px-2 py-0.5 text-[0.58rem] sm:top-7 sm:text-[0.6rem]"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff4d4d]" />
            Reel
          </div>
          {/* The clips carry their own burned-in captions, so no text is overlaid on the video: the label is for
              screen readers only, and a light bottom shade just softens the edge against the bezel. */}
          <figcaption className="sr-only">
            {niche} reel · {payout} brief
          </figcaption>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[18%] bg-[linear-gradient(0deg,rgba(0,0,0,0.38),transparent)] [transform:translateZ(0)]" />
        </div>
      </div>
    </figure>
  );
}

/** One endlessly scrolling column of phones; the set is rendered twice so the loop is seamless. */
function ReelColumn({ reels, reverse, duration, delay = "0s" }: { reels: readonly (typeof REELS)[number][]; reverse?: boolean; duration: string; delay?: string }) {
  return (
    <div className="rx-reel-mask-y relative h-full overflow-hidden px-1">
      <div className={`rx-reel-col flex flex-col gap-3.5 ${reverse ? "rx-reel-col--down" : ""}`} style={{ ["--rx-reel-duration" as string]: duration, animationDelay: delay }}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex flex-col gap-3.5" aria-hidden={copy > 0 || undefined}>
            {reels.map((reel) => (
              <ReelPhone key={`${copy}-${reel.slug}`} {...reel} size="wall" decorative={copy > 0} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Hero CTA icons & stat tiles
 * ---------------------------------------------------------------------------------------------- */

/** Dark circle with a bold arrow that slides diagonally on hover. */
function ArrowBadge() {
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#0b1914] text-[#8fe05f]">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-[1.1rem] w-[1.1rem] transition-transform duration-300 group-hover:translate-x-7 group-hover:-translate-y-7" aria-hidden>
        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
      </svg>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="absolute h-[1.1rem] w-[1.1rem] -translate-x-7 translate-y-7 transition-transform duration-300 group-hover:translate-x-0 group-hover:translate-y-0" aria-hidden>
        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
      </svg>
    </span>
  );
}

const GridIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" className={className} aria-hidden>
    <rect x="3" y="3" width="5.5" height="5.5" rx="1.4" />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.4" />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.4" />
    <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.4" />
  </svg>
);

const PlayCircleIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.9" />
    <path d="M8.5 7.2v5.6a.5.5 0 0 0 .77.42l4.2-2.8a.5.5 0 0 0 0-.84l-4.2-2.8a.5.5 0 0 0-.77.42Z" fill="currentColor" />
  </svg>
);

const SparkIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
    <path d="M10 2.8 11.6 8.4 17.2 10l-5.6 1.6L10 17.2l-1.6-5.6L2.8 10l5.6-1.6L10 2.8Z" fill="currentColor" />
  </svg>
);

const StoreIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
    <path d="M3.5 8v8h13V8M2.8 4h14.4l-.9 3.2a2 2 0 0 1-3.8.2 2.1 2.1 0 0 1-4 0 2 2 0 0 1-3.8-.2L2.8 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M8 16v-4h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

// Creators come first: they're the default view and the left tab.
const TABS = [
  { id: "creators", label: "I'm a creator", Icon: SparkIcon },
  { id: "brands", label: "I'm a brand", Icon: StoreIcon },
] as const;

const STAT_STYLES = [
  {
    chip: "bg-[#8fe05f]/15 text-[#8fe05f]",
    unit: "text-[#8fe05f]",
    glow: "bg-[#8fe05f]",
    icon: "M10 9.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 16.5c.6-2.7 2.8-4.4 5.5-4.4s4.9 1.7 5.5 4.4M14.2 4a2.6 2.6 0 0 1 0 4.8M16.3 12.6c1 .6 1.7 1.6 2 3",
  },
  { chip: "bg-[#b2a6ff]/15 text-[#b2a6ff]", unit: "text-[#b2a6ff]", glow: "bg-[#b2a6ff]", icon: "M10 2.8 15.8 5v4.3c0 3.6-2.5 6.4-5.8 7.4-3.3-1-5.8-3.8-5.8-7.4V5L10 2.8ZM7.4 9.9l1.9 1.9 3.4-3.6" },
  { chip: "bg-[#38bdf8]/15 text-[#38bdf8]", unit: "text-[#38bdf8]", glow: "bg-[#38bdf8]", icon: "M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4ZM10 6.2V10l2.6 1.6" },
] as const;

/** Splits "18K+" into 18 and "K+" so the number can count up while the suffix stays put. */
function parseStat(value: string) {
  const match = /^([\d.]+)(.*)$/.exec(value);
  return match ? { target: Number(match[1]), suffix: match[2], decimals: (match[1].split(".")[1] ?? "").length } : null;
}

function StatTile({ value, label, index }: { value: string; label: string; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const parsed = parseStat(value);
  const [shown, setShown] = useState<string>(value);

  // Count up once, the first time the tile scrolls into view (the hero fades in, so the reset to 0 is never seen).
  useEffect(() => {
    const el = ref.current;
    if (!el || !parsed || reduced) return;
    let raf = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const duration = 1300 + index * 150;
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setShown(`${(parsed.target * eased).toFixed(parsed.decimals)}${parsed.suffix}`);
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced, index]);

  const style = STAT_STYLES[index % STAT_STYLES.length];
  // Keep the unit ("K+", "%", "h") still and tinted while the number counts up.
  const unit = parsed?.suffix ?? "";
  const number = unit && shown.endsWith(unit) ? shown.slice(0, -unit.length) : shown;
  return (
    <div
      ref={ref}
      className={`group relative isolate min-w-0 overflow-hidden px-2.5 py-3.5 transition-colors hover:bg-white/[0.04] min-[380px]:px-3.5 sm:px-5 sm:py-4 lg-short:py-3 ${index > 0 ? "border-l border-white/10" : ""}`}
    >
      {/* Soft colour wash on hover, keyed to the tile's accent. */}
      <span aria-hidden className={`pointer-events-none absolute -right-8 -top-10 -z-10 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-25 ${style.glow}`} />
      {/* The icon sits in the tile's empty top-right corner, so it costs no height at any size. */}
      <span className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-[0.55rem] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 min-[380px]:right-2.5 min-[380px]:top-2.5 sm:right-3.5 sm:top-3.5 sm:h-8 sm:w-8 sm:rounded-[0.65rem] lg-short:top-2.5 lg-short:h-7 lg-short:w-7 ${style.chip}`}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden>
          <path d={style.icon} />
        </svg>
      </span>
      <dt className="sr-only">{label}</dt>
      <dd className="text-[clamp(1.35rem,5.4vw,1.9rem)] font-black leading-none tracking-[-0.04em] text-white tabular-nums" aria-label={value}>
        {number}
        {unit && <span className={`ml-px text-[0.72em] tracking-[-0.02em] ${style.unit}`}>{unit}</span>}
      </dd>
      <dd className="mt-1.5 text-[0.68rem] leading-snug text-white/55 min-[380px]:text-[0.72rem] sm:text-[0.8rem]">{label}</dd>
    </div>
  );
}
