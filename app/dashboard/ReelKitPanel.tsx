"use client";

/* eslint-disable @next/next/no-img-element -- Admin uploads may use any media host; preserve the original image without an optimizer allowlist. */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ReelExample } from "@/lib/gigBriefMedia";
import { REEL_KIT_MESSAGE, SETUP_STEPS, TAKE_TIMELINE, demoWalletHref, takeScenes, takeSeconds, type RecordingSetup, type ReelKit, type SceneFocus } from "@/lib/reelKit";
import { buttonClassName, cx, Icon } from "./dashboardUi";

/*
 * Everything a creator needs to record a Content Posting reel, as a guided workspace: a sticky preview (finished
 * reel or the live recording screen) with a take timeline, beside four steps the creator works through and ticks
 * off. The embedded screen announces each take, so the timeline and storyboard follow it live. Lays out by its own
 * width (container queries): side by side when there is room, stacked in the approval column and on phones.
 */

const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 800;
const STEP_IDS = ["setup", "open", "shoot", "post"] as const;
type StepId = (typeof STEP_IDS)[number];

const subscribeNoop = () => () => {};
const readCanShare = () => typeof navigator.share === "function";

/* ------------------------------------------------------------------ */
/* Live screen and take clock                                         */
/* ------------------------------------------------------------------ */

/** Scales the 1280×800 recording screen into whatever width it gets, like a laptop seen from across the room. */
function LiveScreen({ src, className }: { src: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / SCREEN_WIDTH));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={boxRef} className={cx("relative aspect-[16/10] overflow-hidden bg-[#f8f4ec]", className)} aria-hidden="true">
      {scale ? (
        <iframe
          src={src}
          title="Live preview of the recording screen"
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}

/** Milliseconds into the take the embedded screen is playing, or null between takes / before the first one. */
function useTakeClock() {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    let start = 0;
    let timer = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== REEL_KIT_MESSAGE || event.data?.type !== "take-start") return;
      start = performance.now();
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        const ms = performance.now() - start;
        if (ms > TAKE_TIMELINE.endMs + 400) {
          window.clearInterval(timer);
          setElapsed(null);
        } else setElapsed(Math.min(ms, TAKE_TIMELINE.endMs));
      }, 100);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, []);
  return elapsed;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

/** The bold boxed caption style used in reels: one white rounded box per line. */
function CaptionSticker({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cx("text-center font-extrabold leading-[1.35] text-[#111]", className)}>
      <span className="rounded-[0.45em] bg-white px-[0.45em] py-[0.12em] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{text}</span>
    </p>
  );
}

/** Renders the caption as a transparent PNG sticker creators can drop onto their video in any editor. */
async function downloadSticker(text: string) {
  const fontSize = 64, lineHeight = 84, padX = 30, padY = 12, maxWidth = 920, radius = 26;
  const font = `800 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && measure.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const widths = lines.map((line) => measure.measureText(line).width);
  const width = Math.ceil(Math.max(...widths) + padX * 2);
  const height = lines.length * lineHeight + padY * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => {
    const boxWidth = widths[index] + padX * 2;
    const y = padY + index * lineHeight;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect((width - boxWidth) / 2, y - (index ? 6 : 0), boxWidth, lineHeight + (index ? 6 : 0), radius);
    context.fill();
    context.fillStyle = "#111111";
    context.fillText(line, width / 2, y + lineHeight / 2 + 2);
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reel-caption.png";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A schematic of the wallet screen with the scene's focus area lit, so the storyboard reads at a glance. */
function SceneThumb({ focus, toast = false, className }: { focus: SceneFocus; toast?: boolean; className?: string }) {
  return (
    <span className={cx("relative block aspect-[16/10] shrink-0 overflow-hidden rounded-md bg-[#f8f4ec] ring-1 ring-[#dfe3dc]", className)} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 w-[18%] border-r border-[#e3e5e1] bg-white" />
      <span className="absolute left-[18%] right-0 top-0 h-[11%] border-b border-[#e3e5e1] bg-[#fcfdf9]" />
      <span className="absolute left-[24%] right-[4%] top-[20%] h-[34%] rounded-[3px] border border-[#cfe3d4] bg-[#f4f9f2]">
        <span className="absolute left-[4%] top-[42%] h-[42%] w-[44%] rounded-[2px] bg-white" />
        <span className="absolute right-[4%] top-[42%] h-[42%] w-[44%] rounded-[2px] bg-white" />
      </span>
      <span className="absolute left-[24%] right-[4%] top-[58%] grid h-[12%] grid-cols-4 gap-[3%]">
        {[0, 1, 2, 3].map((tile) => <span key={tile} className="rounded-[2px] bg-white ring-1 ring-[#e3e5e1]" />)}
      </span>
      <span className="absolute left-[24%] right-[4%] top-[74%] grid h-[24%] grid-cols-[3fr_2fr] gap-[3%]">
        <span className="rounded-[2px] bg-white ring-1 ring-[#e3e5e1]" />
        <span className="rounded-[2px] bg-white ring-1 ring-[#e3e5e1]" />
      </span>
      {toast ? <span className="absolute right-[3%] top-[4%] h-[13%] w-[30%] rounded-[3px] bg-white shadow ring-1 ring-[#2e7d4f]/50"><span className="absolute left-[8%] top-1/2 h-[55%] -translate-y-1/2 rounded-full bg-[#2e7d4f] [aspect-ratio:1]" /></span> : null}
      <span className="absolute inset-0 bg-[#101814]/35" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${focus.top}%, ${focus.left}% ${focus.top}%, ${focus.left}% ${focus.top + focus.height}%, ${focus.left + focus.width}% ${focus.top + focus.height}%, ${focus.left + focus.width}% ${focus.top}%, 0 ${focus.top}%)` }} />
      <span className="absolute rounded-[3px] ring-2 ring-[#2e7d4f]" style={{ left: `${focus.left}%`, top: `${focus.top}%`, width: `${focus.width}%`, height: `${focus.height}%` }} />
    </span>
  );
}

function useFlash() {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [flash, (message: string) => {
    setFlash(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 2000);
  }] as const;
}

/** Steps marked done are a per-viewer convenience, kept in this browser for the gig. */
const DONE_EVENT = "reelencer:reel-kit-progress";
const subscribeDone = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(DONE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(DONE_EVENT, listener);
  };
};
function useDoneSteps(key: string) {
  const raw = useSyncExternalStore(subscribeDone, () => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }, () => "");
  const done = new Set(raw.split("|").filter((id): id is StepId => (STEP_IDS as readonly string[]).includes(id)));
  const save = (next: Set<StepId>) => {
    try {
      window.localStorage.setItem(key, [...next].join("|"));
    } catch {
      /* Storage unavailable (private mode): progress lasts for this visit only. */
    }
    window.dispatchEvent(new Event(DONE_EVENT));
  };
  return [done, save] as const;
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const radius = 17, circumference = 2 * Math.PI * radius;
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center" role="img" aria-label={`${value} of ${total} steps done`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="#e3ebe0" strokeWidth="4" />
        <circle cx="20" cy="20" r={radius} fill="none" stroke="#2e7d4f" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / total)} className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <span className="text-[11.5px] font-bold tabular-nums text-[#1a201c]">{value}/{total}</span>
    </span>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-[#d9ddd8] border-b-2 bg-white px-1.5 font-sans text-[11px] font-semibold text-[#1a201c]">{children}</kbd>
);

const SetupIcons: Record<RecordingSetup, ReactNode> = {
  laptop: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="2.5" y="4" width="13" height="9" rx="1.5" /><path d="M1.5 15.5h15" /><rect x="15.5" y="8" width="6" height="12" rx="1.5" /><path d="M18.5 17.5h.01" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><circle cx="12" cy="11" r="2.6" /><path d="M12 8.4V7m0 8v-1.4" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/* Panel                                                              */
/* ------------------------------------------------------------------ */

export default function ReelKitPanel({ kit, example, company, creatorName, storageId }: { kit: ReelKit; example?: ReelExample; company: string; creatorName?: string; storageId: string }) {
  const headingId = useId();
  const panelId = useId();
  const name = creatorName && !creatorName.includes("@") ? creatorName.trim().split(/\s+/)[0] : "";
  const href = demoWalletHref(kit, name);
  const previewSrc = `${href}${href.includes("?") ? "&" : "?"}v=preview`;
  const canShare = useSyncExternalStore(subscribeNoop, readCanShare, () => false);
  const [linkFlash, flashLink] = useFlash();
  const [captionFlash, flashCaption] = useFlash();
  const [setup, setSetup] = useState<RecordingSetup>("laptop");
  const [previewTab, setPreviewTab] = useState<"reel" | "screen">("reel");
  const [done, saveDone] = useDoneSteps(`reelencer:reel-kit:${storageId}`);
  const [activeChoice, setActive] = useState<StepId | null>(null);
  const active: StepId = activeChoice ?? STEP_IDS.find((id) => !done.has(id)) ?? "post";
  const elapsed = useTakeClock();
  const scenes = takeScenes();
  const liveScene = elapsed === null ? -1 : scenes.findIndex((scene) => elapsed >= scene.fromMs && elapsed < scene.toMs);
  const currentScene = elapsed !== null && liveScene === -1 ? scenes.length - 1 : liveScene;
  // Only one live screen is mounted at a time: it is the take clock's source and keeps the page light.
  const showsLiveScreen = previewTab === "screen" || !example;
  const absolute = () => new URL(href, window.location.origin).toString();

  const steps: Array<{ id: StepId; label: string; short: string; title: string }> = [
    { id: "setup", label: "Set up", short: "Setup", title: "Choose how you'll record" },
    { id: "open", label: "Open screen", short: "Screen", title: setup === "phone" ? "Open the recording screen on your phone" : "Open the recording screen on a laptop" },
    { id: "shoot", label: "Shoot", short: "Shoot", title: "Shoot the take, scene by scene" },
    { id: "post", label: kit.caption ? "Caption & post" : "Post", short: "Post", title: kit.caption ? "Add the caption, then post" : "Edit and post" },
  ];
  const activeIndex = STEP_IDS.indexOf(active);
  const complete = done.size === STEP_IDS.length;

  const copy = async (text: string, flash: (message: string) => void, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(message);
    } catch {
      flash("Copy failed. Select the text instead.");
    }
  };
  const markDoneAndContinue = () => {
    const next = new Set(done);
    next.add(active);
    saveDone(next);
    const following = STEP_IDS.slice(activeIndex + 1).find((id) => !next.has(id)) ?? STEP_IDS[activeIndex + 1];
    if (following) setActive(following);
    document.getElementById(panelId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const toggleDone = (id: StepId) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveDone(next);
  };

  return (
    <section id="reel-kit" aria-labelledby={headingId} className="@container min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border border-[#cfe3d4] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.05),0_18px_40px_-30px_rgba(31,64,45,0.45)]">
      {/* Header */}
      <header className="relative border-b border-[#e3efe0] bg-[radial-gradient(120%_140%_at_0%_0%,#e6f3e2_0%,#f6fbf4_45%,#ffffff_100%)] px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
          <div className="flex w-full min-w-0 items-start gap-3 @2xl:w-auto @2xl:flex-1">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#1f2b24] text-white shadow-[0_6px_16px_-8px_rgba(16,24,20,0.7)]" aria-hidden="true">
              <Icon.Video className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#2e7d4f]">Reel kit · from {company}</div>
              <h3 id={headingId} className="mt-0.5 text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#1a201c]">Record this reel</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#4b544e]">A demo wallet to film, a timed storyboard and a ready-made caption. Work through the four steps and your reel is ready to post.</p>
              <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Reel at a glance">
                {[`About ${Math.round(TAKE_TIMELINE.endMs / 1000)}s take`, `${scenes.length} scenes`, "9:16 vertical", ...(kit.caption ? ["Caption ready"] : [])].map((chip) => (
                  <li key={chip} className="rounded-full border border-[#d6e6d3] bg-white/80 px-2 py-0.5 text-[11px] font-medium text-[#41695b]">{chip}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center gap-3 @2xl:shrink-0">
            <ProgressRing value={done.size} total={STEP_IDS.length} />
            <div className="hidden min-w-0 @md:block @2xl:hidden @4xl:block">
              <div className="text-[12.5px] font-semibold text-[#1a201c]">{complete ? "All steps done" : `Step ${activeIndex + 1}: ${steps[activeIndex].label}`}</div>
              <div className="text-[11.5px] text-[#7a827c]">{complete ? "Post it and submit the link" : "Progress saves on this device"}</div>
            </div>
            <a href={href} target="_blank" rel="noopener" className={buttonClassName("primary", "md", "ml-auto h-11 flex-1 @md:flex-none sm:h-10")}>
              Open recording screen <Icon.External className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      <div className="grid gap-5 p-4 sm:p-5 @3xl:grid-cols-[minmax(0,16.5rem)_minmax(0,1fr)] @3xl:gap-6">
        {/* Preview */}
        {/* Narrow: stacked. Medium: the mock beside the tabs and timeline. Wide: a sticky column beside the steps. */}
        <aside className="grid min-w-0 gap-3 @xl:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] @xl:items-start @3xl:sticky @3xl:top-4 @3xl:grid-cols-1 @3xl:self-start" aria-label="Reel preview">
          <div role="group" aria-label="Preview" className="mx-auto grid w-full max-w-[18rem] grid-cols-2 gap-1 rounded-lg bg-[#eef1ed] p-1 @xl:col-start-2 @xl:row-start-1 @xl:mx-0 @3xl:col-start-1 @3xl:mx-auto">
            {([["reel", example ? "Example reel" : "Finished look"], ["screen", "Recording screen"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={previewTab === value}
                onClick={() => setPreviewTab(value)}
                className={cx("min-h-9 rounded-md px-2 text-[12px] font-semibold transition focus-visible:outline-2 focus-visible:outline-[#2e7d4f]", previewTab === value ? "bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.12)]" : "text-[#616a64] hover:text-[#1a201c]")}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-w-0 @xl:col-start-1 @xl:row-span-3 @xl:row-start-1 @3xl:row-span-1 @3xl:row-start-2">
            {previewTab === "reel" ? (
              <figure className="mx-auto w-full max-w-[11.5rem] @md:max-w-[13rem] @3xl:max-w-[15rem]">
                <div className="relative aspect-[9/16] overflow-hidden rounded-[1.5rem] bg-[#101814] shadow-[0_22px_44px_-20px_rgba(16,24,20,0.75)] ring-[5px] ring-[#1f2b24]">
                  {example?.kind === "video" ? (
                    <video src={`${example.url}#t=0.5`} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" aria-label={`Example reel from ${company}`} />
                  ) : example ? (
                    <img src={example.url} alt={`Example reel from ${company}`} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    // No example uploaded: compose one from the live screen and the caption, like a phone filming a laptop.
                    <div className="absolute inset-0 bg-[radial-gradient(130%_90%_at_50%_0%,#46584c,#0e1511_70%)]">
                      <div className="absolute inset-x-[-20%] top-[22%] [perspective:900px]">
                        <div className="[transform:rotateX(10deg)_rotateZ(-3deg)]">
                          <LiveScreen src={previewSrc} className="rounded-[4px] shadow-[0_24px_40px_-12px_rgba(0,0,0,0.85)] ring-[3px] ring-[#0b0f0c]" />
                          <div className="mx-auto h-2 w-[108%] -translate-x-[3.5%] rounded-b-lg bg-[linear-gradient(#5a625d,#2a302c)]" />
                        </div>
                      </div>
                      <div className="absolute inset-x-[8%] bottom-[25%]">
                        <CaptionSticker text={kit.caption || "Your caption here"} className="text-[14px]" />
                      </div>
                      {/* Faux reel UI so the frame reads as a reel. */}
                      <div aria-hidden="true" className="absolute bottom-[4%] left-[6%] right-[18%] space-y-1.5">
                        <div className="flex items-center gap-1.5"><span className="h-5 w-5 rounded-full bg-white/85" /><span className="h-1.5 w-16 rounded-full bg-white/85" /></div>
                        <span className="block h-1.5 w-[80%] rounded-full bg-white/55" />
                      </div>
                      <div aria-hidden="true" className="absolute bottom-[6%] right-[5%] flex flex-col gap-2.5">
                        {[0, 1, 2].map((dot) => <span key={dot} className="h-5 w-5 rounded-full bg-white/75" />)}
                      </div>
                    </div>
                  )}
                </div>
                <figcaption className="mt-2 text-center text-[11.5px] text-[#616a64]">{example ? `Example reel from ${company}` : "Auto preview of the finished reel"}</figcaption>
              </figure>
            ) : (
              <figure>
                <div className="rounded-xl bg-[#1f2b24] p-1.5 shadow-[0_18px_36px_-20px_rgba(16,24,20,0.7)]">
                  <LiveScreen src={previewSrc} className="rounded-lg" />
                </div>
                <figcaption className="mt-2 text-center text-[11.5px] text-[#616a64]">The screen you&apos;ll film, playing a take on a loop</figcaption>
              </figure>
            )}
          </div>

          {showsLiveScreen ? (
            <div className="rounded-xl border border-[#e3e7df] bg-[#fafbf9] p-3 @xl:col-start-2 @xl:row-start-2 @3xl:col-start-1 @3xl:row-start-3" aria-live="off">
              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="font-semibold text-[#1a201c]">Take timeline</span>
                <span className="flex items-center gap-1.5 tabular-nums text-[#616a64]">
                  {elapsed !== null ? <span className="h-1.5 w-1.5 rounded-full bg-[#d33f2f] motion-safe:animate-pulse" aria-hidden="true" /> : null}
                  {elapsed !== null ? `${takeSeconds(elapsed)}s · ${scenes[currentScene]?.title}` : "Waiting for the next take"}
                </span>
              </div>
              <div className="relative mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full">
                {scenes.map((scene, index) => (
                  <span
                    key={scene.title}
                    className={cx("h-full transition-colors", index === currentScene ? "bg-[#2e7d4f]" : index < currentScene ? "bg-[#7cb68a]" : "bg-[#dfe6dc]")}
                    style={{ width: `${((scene.toMs - scene.fromMs) / TAKE_TIMELINE.endMs) * 100}%` }}
                  />
                ))}
                {elapsed !== null ? <span className="absolute inset-y-[-2px] w-0.5 rounded-full bg-[#1a201c]" style={{ left: `${(elapsed / TAKE_TIMELINE.endMs) * 100}%` }} aria-hidden="true" /> : null}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-[#9aa29c]"><span>0s</span><span>{takeSeconds(TAKE_TIMELINE.endMs)}s</span></div>
            </div>
          ) : null}

          {/* Medium widths only: the storyboard at a glance fills the space beside the mock. */}
          <ol className="hidden space-y-1.5 @xl:col-start-2 @xl:row-start-3 @xl:block @3xl:hidden" aria-label="Scenes in this take">
            {scenes.map((scene, index) => (
              <li key={scene.title} className={cx("flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[12px] transition", index === currentScene ? "border-[#2e7d4f] bg-[#f4f9f2]" : "border-[#e3e7df] bg-white")}>
                <span className={cx("rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white", index === currentScene ? "bg-[#2e7d4f]" : "bg-[#1f2b24]")}>{takeSeconds(scene.fromMs)}–{takeSeconds(scene.toMs)}s</span>
                <span className="min-w-0 truncate font-semibold text-[#1a201c]">{scene.title}</span>
              </li>
            ))}
          </ol>
        </aside>

        {/* Steps */}
        <div id={panelId} className="min-w-0 scroll-mt-24">
          {kit.steps.length ? (
            <figure className="mb-4 rounded-xl border-l-4 border-[#2e7d4f] bg-[#f1f8ef] px-4 py-3">
              <figcaption className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">Notes from {company}</figcaption>
              <ul className="mt-1.5 space-y-1">
                {kit.steps.map((step) => (
                  <li key={step} className="flex gap-2 text-[13px] leading-5 text-[#1a201c]"><Icon.Check className="mt-1 h-3 w-3 shrink-0 text-[#2e7d4f]" />{step}</li>
                ))}
              </ul>
            </figure>
          ) : null}

          <nav aria-label="Reel kit steps">
            <ol className="relative grid grid-cols-4 gap-1">
              <span className="absolute left-[12.5%] right-[12.5%] top-[17px] h-0.5 rounded-full bg-[#e3e7df]" aria-hidden="true" />
              <span className="absolute left-[12.5%] top-[17px] h-0.5 rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${(activeIndex / (STEP_IDS.length - 1)) * 75}%` }} aria-hidden="true" />
              {steps.map((step, index) => {
                const isDone = done.has(step.id);
                const isActive = step.id === active;
                return (
                  <li key={step.id} className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => setActive(step.id)}
                      aria-current={isActive ? "step" : undefined}
                      className="group flex w-full flex-col items-center gap-1.5 rounded-lg px-1 pb-1 text-center focus-visible:outline-2 focus-visible:outline-[#2e7d4f]"
                    >
                      <span className={cx(
                        "relative z-10 grid h-9 w-9 place-items-center rounded-full text-[12.5px] font-bold ring-4 ring-white transition",
                        isActive ? "bg-[#1f2b24] text-white shadow-[0_6px_14px_-6px_rgba(16,24,20,0.7)]" : isDone ? "bg-[#2e7d4f] text-white" : "bg-[#eef1ed] text-[#7a827c] group-hover:bg-[#e3e8e1]"
                      )}>
                        {isDone && !isActive ? <Icon.Check className="h-4 w-4" /> : index + 1}
                      </span>
                      <span className={cx("block w-full truncate text-[11px] font-semibold leading-tight @md:text-[12px]", isActive ? "text-[#1a201c]" : "text-[#7a827c]")}>
                        <span className="@md:hidden">{step.short}</span>
                        <span className="hidden @md:inline">{step.label}</span>
                      </span>
                      <span className="sr-only">{isDone ? " (done)" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div key={active} className="mt-3 rounded-xl border border-[#e3e7df] bg-white p-4 motion-safe:animate-[reelkit-in_220ms_ease-out] sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a827c]">Step {activeIndex + 1} of {STEP_IDS.length}</div>
                <h4 className="mt-0.5 text-[15.5px] font-semibold leading-snug text-[#1a201c]">{steps[activeIndex].title}</h4>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[#e3e7df] px-2.5 py-1 text-[11.5px] font-semibold text-[#4b544e] hover:bg-[#fafbf9]">
                <input type="checkbox" checked={done.has(active)} onChange={() => toggleDone(active)} className="h-3.5 w-3.5 accent-[#2e7d4f]" />
                Done
              </label>
            </div>

            <div className="mt-4">
              {active === "setup" ? (
                <>
                  <div role="group" aria-label="Recording setup" className="grid gap-2 @md:grid-cols-2">
                    {([["laptop", "Laptop + phone camera", "Film the laptop with your phone. Looks the most natural."], ["phone", "Phone only", "Screen-record the demo on your phone. Quickest to make."]] as const).map(([value, label, hint]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={setup === value}
                        onClick={() => setSetup(value)}
                        className={cx(
                          "flex min-h-16 items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-[#2e7d4f]",
                          setup === value ? "border-[#2e7d4f] bg-[#f4f9f2] ring-1 ring-[#2e7d4f]/30" : "border-[#e3e7df] hover:border-[#cdd9c9] hover:bg-[#fafbf9]"
                        )}
                      >
                        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", setup === value ? "bg-[#2e7d4f] text-white" : "bg-[#eef1ed] text-[#41695b]")}>{SetupIcons[value]}</span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-[#1a201c]">{label}</span>
                          <span className="mt-0.5 block text-[11.5px] leading-4 text-[#616a64]">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7a827c]">You&apos;ll need</div>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {(setup === "laptop" ? ["A laptop", "Your phone", "Soft, even light", "About 10 minutes"] : ["Your phone", "Screen recorder", "Do Not Disturb on", "About 5 minutes"]).map((item) => (
                      <li key={item} className="rounded-full bg-[#eef1ed] px-2.5 py-1 text-[11.5px] font-medium text-[#3b443e]">{item}</li>
                    ))}
                  </ul>
                  <ol className="mt-4 space-y-2.5">
                    {SETUP_STEPS[setup].map((step, index) => (
                      <li key={step} className="flex gap-2.5 text-[13px] leading-5 text-[#3b443e]">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef6ec] text-[10.5px] font-bold text-[#2b5d4a]" aria-hidden="true">{index + 1}</span>
                        <span className="min-w-0">{step}</span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : active === "open" ? (
                <>
                  <p className="text-[13px] leading-5 text-[#3b443e]">
                    A demo wallet with the gig&apos;s figures, labelled as a demo workspace.{" "}
                    {setup === "phone" ? "Open it on this phone, start your screen recorder, then tap Play take." : "On your phone right now? Copy the link and open it on your laptop."}
                  </p>
                  <div className="mt-3 grid gap-2 @md:flex @md:flex-wrap">
                    <a href={href} target="_blank" rel="noopener" className={buttonClassName("primary", "md", "h-11 sm:h-10")}>
                      Open recording screen <Icon.External className="h-3.5 w-3.5" />
                    </a>
                    <button type="button" onClick={() => void copy(absolute(), flashLink, "Link copied")} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
                      <Icon.Clipboard className="h-3.5 w-3.5" /> Copy link
                    </button>
                    {canShare ? (
                      <button type="button" onClick={() => void navigator.share({ title: "Reelencer recording screen", url: absolute() }).catch(() => undefined)} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
                        {setup === "laptop" ? "Send to laptop" : "Share link"}
                      </button>
                    ) : null}
                  </div>
                  <p role="status" aria-live="polite" className="mt-1.5 min-h-4 text-[11.5px] font-medium text-[#2e7d4f]">{linkFlash}</p>

                  <div className="mt-2 rounded-xl bg-[#fafbf9] p-3.5">
                    <div className="text-[12.5px] font-semibold text-[#1a201c]">{setup === "phone" ? "On the screen" : "Keyboard controls"}</div>
                    {setup === "phone" ? (
                      <ul className="mt-2 space-y-1.5 text-[12.5px] leading-5 text-[#3b443e]">
                        <li>Tap <span className="font-semibold">Play take</span>: the figures count up and the controls hide themselves.</li>
                        <li>Tap anywhere to bring the controls back; use <span className="font-semibold">Reset</span> to start over.</li>
                        <li>Turn <span className="font-semibold">Auto-scroll</span> off if you only want the earnings and the payout alert.</li>
                      </ul>
                    ) : (
                      <dl className="mt-2 grid gap-x-4 gap-y-2 text-[12.5px] text-[#3b443e] @md:grid-cols-2">
                        {([["Space", "Play a take (3s countdown)"], ["F", "Full screen"], ["S", "Auto-scroll on or off"], ["T", "Payout alert on or off"], ["R", "Reset to final figures"], ["H", "Hide the controls"]] as const).map(([key, action]) => (
                          <div key={key} className="flex items-center gap-2.5">
                            <dt><Kbd>{key}</Kbd></dt>
                            <dd>{action}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </>
              ) : active === "shoot" ? (
                <>
                  <p className="text-[13px] leading-5 text-[#3b443e]">
                    Start recording, then play a take. It runs about {Math.round(TAKE_TIMELINE.endMs / 1000)} seconds after the countdown; times count from when the numbers start moving.
                    {showsLiveScreen ? " The scene playing in the preview is highlighted." : ""}
                  </p>
                  <ol className="mt-3 grid gap-2.5 @2xl:grid-cols-2">
                    {scenes.map((scene, index) => {
                      const live = index === currentScene;
                      return (
                        <li key={scene.title} className={cx("flex min-w-0 gap-3 rounded-xl border p-2.5 transition", live ? "border-[#2e7d4f] bg-[#f4f9f2] shadow-[0_8px_20px_-14px_rgba(46,125,79,0.7)]" : "border-[#e3e7df] bg-white")}>
                          <span className="relative shrink-0">
                            <SceneThumb focus={scene.focus} toast={index >= 2} className="w-[6.5rem] @md:w-28" />
                            <span className={cx("absolute -left-1 -top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums shadow-sm", live ? "bg-[#2e7d4f] text-white" : "bg-[#1f2b24] text-white")}>
                              {takeSeconds(scene.fromMs)}–{takeSeconds(scene.toMs)}s
                            </span>
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-[#1a201c]">{index + 1}. {scene.title}</span>
                              {live ? <span className="rounded-full bg-[#2e7d4f] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white">Now</span> : null}
                            </div>
                            <p className="mt-0.5 text-[12px] leading-[1.1rem] text-[#3b443e]"><span className="font-semibold text-[#2e7d4f]">Screen · </span>{scene.screen}</p>
                            {setup === "laptop" ? <p className="mt-0.5 text-[12px] leading-[1.1rem] text-[#3b443e]"><span className="font-semibold text-[#2e7d4f]">Camera · </span>{scene.camera}</p> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="mt-3 rounded-lg bg-[#fff8e6] px-3 py-2 text-[12px] leading-5 text-[#6b4a05]">
                    Not happy with a take? Press <Kbd>R</Kbd> or tap Reset and play it again. Record a few and keep the steadiest.
                  </p>
                </>
              ) : (
                <>
                  {kit.caption ? (
                    <>
                      <div className="rounded-xl bg-[linear-gradient(135deg,#2c3a31,#121a15)] px-3 py-6">
                        <CaptionSticker text={kit.caption} className="text-[18px] @md:text-[22px]" />
                      </div>
                      <div className="mt-3 grid gap-2 @md:flex @md:flex-wrap @md:items-center">
                        <button type="button" onClick={() => void copy(kit.caption, flashCaption, "Caption copied")} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
                          <Icon.Clipboard className="h-3.5 w-3.5" /> Copy text
                        </button>
                        <button type="button" onClick={() => void downloadSticker(kit.caption).then(() => flashCaption("Sticker downloaded"))} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true"><path d="M10 3v10m-4-4 4 4 4-4M4 16h12" /></svg>
                          Download sticker (PNG)
                        </button>
                        <span role="status" aria-live="polite" className="text-[11.5px] font-medium text-[#2e7d4f]">{captionFlash}</span>
                      </div>
                    </>
                  ) : null}
                  <div className={cx("text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7a827c]", kit.caption && "mt-4")}>Finish in your editor</div>
                  <ol className="mt-2 space-y-2.5">
                    {[
                      "Trim the countdown so the reel opens on the figures counting up.",
                      ...(kit.caption ? ["Place the caption in the lower middle, above the reel's own caption area, for the whole reel."] : []),
                      "Export in 9:16 at the highest quality, then post it on your linked account.",
                      "Copy the reel's link and submit it from Linked so it counts towards your earnings.",
                    ].map((item, index) => (
                      <li key={item} className="flex gap-2.5 text-[13px] leading-5 text-[#3b443e]">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef6ec] text-[10.5px] font-bold text-[#2b5d4a]" aria-hidden="true">{index + 1}</span>
                        <span className="min-w-0">{item}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[#ebedea] pt-4 @md:flex-row @md:items-center @md:justify-between">
              <button type="button" onClick={() => setActive(STEP_IDS[Math.max(0, activeIndex - 1)])} disabled={activeIndex === 0} className={buttonClassName("plain", "md", "h-11 disabled:invisible sm:h-10")}>
                <Icon.ChevronLeft className="h-4 w-4" /> Back
              </button>
              {complete && active === "post" ? (
                <p className="flex items-center justify-center gap-2 rounded-lg bg-[#e3f1df] px-3 py-2 text-[12.5px] font-semibold text-[#1f5131]">
                  <Icon.Check className="h-4 w-4" /> All done. Post the reel and submit its link.
                </p>
              ) : (
                <button type="button" onClick={markDoneAndContinue} className={buttonClassName("primary", "md", "h-11 sm:h-10")}>
                  {activeIndex === STEP_IDS.length - 1 ? "Mark done" : "Mark done & continue"} {activeIndex < STEP_IDS.length - 1 ? <Icon.ChevronRight className="h-4 w-4" /> : <Icon.Check className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
