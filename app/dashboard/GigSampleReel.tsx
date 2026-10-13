"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatSampleDuration, sampleIsVertical, type GigSample } from "@/lib/gigSamples";

const PlayGlyph = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z" />
  </svg>
);
const Chevron = ({ dir, className = "h-5 w-5" }: { dir: "left" | "right"; className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={dir === "left" ? "m12 5-5 5 5 5" : "m8 5 5 5-5 5"} />
  </svg>
);

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Data saver ("Lite mode" / Save-Data) means posters only: autoplaying several clips would burn the user's data.
const prefersSavingData = () =>
  typeof navigator !== "undefined" && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

/** One tile: plays muted on a loop while it's on screen, falls back to the poster when motion or data should be spared. */
function SampleTile({
  sample,
  index,
  onOpen,
  paused,
  soundOn,
  onToggleSound,
  onSoundBlocked,
}: {
  sample: GigSample;
  index: number;
  onOpen: (index: number, trigger: HTMLElement) => void;
  /** The full-screen player is open: hold the tiles behind it. */
  paused: boolean;
  /** Only one tile plays with sound at a time; the strip owns which. */
  soundOn: boolean;
  onToggleSound: () => void;
  /** The browser refused to play with sound (no user gesture): the tile went back to muted. */
  onSoundBlocked: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // Whether the autoplay observer currently wants this tile playing (on screen, page visible).
  const wantsPlayRef = useRef(false);
  const soundBlockedRef = useRef(onSoundBlocked);
  useEffect(() => {
    soundBlockedRef.current = onSoundBlocked;
  });
  const vertical = sampleIsVertical(sample);

  // Set the property, not just the attribute React renders: iOS only allows inline autoplay for muted videos,
  // and unmuting must happen on the element itself. Declared first so it runs before the autoplay effect.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !soundOn;
    if (paused || !(soundOn || wantsPlayRef.current)) return;
    // Browsers may pause a video that gains sound without a user gesture; resume it, muted if sound is refused.
    video.play().catch(() => {
      if (!soundOn) return;
      video.muted = true;
      soundBlockedRef.current();
      if (wantsPlayRef.current) void video.play().catch(() => undefined);
    });
  }, [soundOn, paused]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || paused || prefersReducedMotion() || prefersSavingData()) return;
    let visible = false;
    const sync = () => {
      wantsPlayRef.current = visible && document.visibilityState === "visible";
      if (wantsPlayRef.current) {
        video.preload = "auto";
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    // Play once most of the tile is visible; tiles scrolled out of the strip or page stop downloading and decoding.
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        sync();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(video);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      wantsPlayRef.current = false;
      video.pause();
    };
  }, [paused]);

  const label = `Play sample ${index + 1}${sample.caption ? `: ${sample.caption}` : ""}${sample.duration ? ` (${formatSampleDuration(sample.duration)})` : ""}`;
  return (
    <li
      className={`group relative shrink-0 snap-start transition duration-300 hover:-translate-y-0.5 ${
        vertical ? "w-[42vw] max-w-[13.5rem] sm:w-[11rem] lg:w-[12rem]" : "w-[78vw] max-w-[24rem] sm:w-[20rem]"
      }`}
    >
      <button
        type="button"
        onClick={(event) => onOpen(index, event.currentTarget)}
        aria-label={label}
        className={`relative block w-full overflow-hidden rounded-2xl bg-[#101814] text-left shadow-[0_1px_2px_rgba(26,32,28,0.12),0_8px_24px_-14px_rgba(26,32,28,0.45)] outline-none ring-[#2e7d4f]/50 transition duration-300 focus-visible:ring-4 ${
          vertical ? "aspect-[9/16]" : "aspect-video"
        }`}
      >
        <video
          ref={videoRef}
          // Without a poster, "#t=0.5" makes the browser show a real frame instead of black.
          src={sample.poster ? sample.url : `${sample.url}#t=0.5`}
          poster={sample.poster}
          preload={sample.poster ? "none" : "metadata"}
          muted
          loop
          playsInline
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
        <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,transparent_28%,transparent_75%,rgba(0,0,0,0.25)_100%)]" />
        {sample.duration ? (
          <span aria-hidden="true" className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {formatSampleDuration(sample.duration)}
          </span>
        ) : null}
        {/* Still tiles show a play button; playing tiles reveal it on hover or keyboard focus. */}
        <span
          aria-hidden="true"
          className={`absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#101814] shadow-lg backdrop-blur-sm transition duration-300 group-hover:scale-110 group-focus-visible:scale-110 ${
            playing ? "scale-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100"
          }`}
        >
          <PlayGlyph className="ml-0.5 h-5 w-5" />
        </span>
      </button>
      {playing || soundOn ? (
        // A sibling of the tile button (buttons can't nest), laid over its top-left corner.
        <button
          type="button"
          onClick={onToggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? `Mute sample ${index + 1}` : `Unmute sample ${index + 1}`}
          title={soundOn ? "Mute" : "Unmute"}
          // The visible disc stays small; the padding gives touch screens a full-size tap target.
          className="absolute left-0 top-0 z-10 p-1.5 outline-none sm:p-2 [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-white"
        >
          <span
            className={`grid h-8 w-8 place-items-center rounded-full text-white shadow-sm backdrop-blur-sm transition duration-200 hover:scale-105 active:scale-95 sm:h-7 sm:w-7 ${
              soundOn ? "bg-[#2e7d4f]/90" : "bg-black/55 hover:bg-black/70"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true">
              <path d="M3.5 7.5h2.5L10 4v12l-4-3.5H3.5z" fill="currentColor" stroke="none" />
              {soundOn ? <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9" /> : <path d="m13 8 4 4M17 8l-4 4" />}
            </svg>
          </span>
        </button>
      ) : null}
    </li>
  );
}

/** Full-screen player: arrows / swipe / keys to move between samples, Esc to close. */
function SamplePlayer({ samples, index, onIndex, onClose }: { samples: GigSample[]; index: number; onIndex: (next: number) => void; onClose: () => void }) {
  const sample = samples[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const go = useCallback((delta: number) => onIndex((index + delta + samples.length) % samples.length), [index, onIndex, samples.length]);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && samples.length > 1) go(1);
      else if (event.key === "ArrowLeft" && samples.length > 1) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, samples.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Sample ${index + 1} of ${samples.length}`}
      className="fixed inset-0 z-[80] flex flex-col bg-[#060a08]/95 backdrop-blur-sm"
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchX.current;
        const end = event.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start == null || end == null || samples.length < 2) return;
        if (Math.abs(end - start) > 50) go(end < start ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-6">
        <span className="text-[13px] font-semibold tabular-nums text-white/70">
          {index + 1} / {samples.length}
        </span>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close player" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <video
          key={sample.url}
          src={sample.url}
          poster={sample.poster}
          controls
          autoPlay
          playsInline
          className={`max-h-full rounded-xl bg-black shadow-2xl ${sampleIsVertical(sample) ? "h-full max-w-full" : "w-full max-w-5xl"}`}
        />
        {samples.length > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous sample" className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:grid">
              <Chevron dir="left" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next sample" className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:grid">
              <Chevron dir="right" />
            </button>
          </>
        ) : null}
      </div>

      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-center sm:px-6">
        {sample.caption ? <p className="mx-auto max-w-2xl text-[14px] font-semibold text-white">{sample.caption}</p> : null}
        {samples.length > 1 ? (
          <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
            {samples.map((s, i) => (
              <button key={s.url} type="button" tabIndex={-1} onClick={() => onIndex(i)} className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/35"}`} />
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[11.5px] text-white/45 sm:hidden">Swipe to see more</p>
      </div>
    </div>
  );
}

/** "See the work": the gig's sample videos, shown before the description. Renders nothing without samples. */
export default function GigSampleReel({ samples, company }: { samples: GigSample[]; company?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, samples.length]);

  if (!samples.length) return null;

  const scroll = (dir: 1 | -1) => stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  const close = () => {
    setOpen(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <article className="gig-detail-card overflow-hidden p-4 sm:p-6" aria-labelledby="gig-samples-title">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="gig-samples-title" className="gig-section-title flex items-center gap-2">
            See the work
            <span className="rounded-full bg-[#eef6ec] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[#2e7d4f]">
              {samples.length} {samples.length === 1 ? "sample" : "samples"}
            </span>
          </h2>
          <p className="mt-1 text-[13px] text-[#616a64]">Examples of the reels {company ? `${company} is` : "the brand is"} looking for. Tap one to watch.</p>
        </div>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          {(["left", "right"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => scroll(dir === "left" ? -1 : 1)}
              disabled={dir === "left" ? edges.start : edges.end}
              aria-label={dir === "left" ? "Scroll samples left" : "Scroll samples right"}
              className="grid h-9 w-9 place-items-center rounded-full border border-[#e3e5e1] bg-white text-[#41695b] transition hover:bg-[#f4f7f1] disabled:cursor-default disabled:opacity-35"
            >
              <Chevron dir={dir} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="relative -mx-4 mt-4 sm:-mx-6">
        <ul ref={stripRef} onScroll={measure} className="dashboard-chip-scroller flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:scroll-px-6 sm:px-6" aria-label="Sample videos">
          {samples.map((sample, index) => (
            <SampleTile
              key={sample.url}
              sample={sample}
              index={index}
              paused={open !== null}
              soundOn={soundUrl === sample.url}
              onToggleSound={() => setSoundUrl((current) => (current === sample.url ? null : sample.url))}
              onSoundBlocked={() => setSoundUrl((current) => (current === sample.url ? null : current))}
              onOpen={(i, trigger) => {
                // The player has its own sound; tiles go back to silent behind it.
                setSoundUrl(null);
                triggerRef.current = trigger;
                setOpen(i);
              }}
            />
          ))}
        </ul>
        {/* Edge fades hint that the strip scrolls. */}
        <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent transition-opacity ${edges.start ? "opacity-0" : "opacity-100"}`} />
        <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent transition-opacity ${edges.end ? "opacity-0" : "opacity-100"}`} />
      </div>

      {/* Portaled to <body>: animated ancestors would otherwise trap a fixed overlay inside the page column. */}
      {open !== null ? createPortal(<SamplePlayer samples={samples} index={open} onIndex={setOpen} onClose={close} />, document.body) : null}
    </article>
  );
}
