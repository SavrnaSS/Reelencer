"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ReelExample } from "@/lib/gigBriefMedia";
import { SETUP_STEPS, demoWalletHref, reelShots, type RecordingSetup, type ReelKit } from "@/lib/reelKit";
import { buttonClassName, cx, Icon } from "./dashboardUi";
import ReelStoryboard from "./ReelStoryboard";
import RecordingSetupArtwork from "./RecordingSetupArtwork";
import setupStyles from "./RecordingSetupArtwork.module.css";

/*
 * Everything a creator needs to record a Content Posting reel: a short header and four steps whose summaries are
 * always visible, the current one opening in place. Lays out by its own width (container queries), so it reads the
 * same in the approval column, full width and on phones.
 */

const STEP_IDS = ["setup", "open", "shoot", "post"] as const;
type StepId = (typeof STEP_IDS)[number];

const subscribeNoop = () => () => {};
const readCanShare = () => typeof navigator.share === "function";

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

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

const TipIcons: Record<"screen" | "glare" | "angle", ReactNode> = {
  screen: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-4 w-4"><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" /></svg>
  ),
  glare: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="4" width="14" height="10" rx="1.5" /><path d="m6 11 4-4M9.5 11.5l3-3M3 17 17 3" /></svg>
  ),
  angle: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="6.5" y="2.5" width="8" height="15" rx="2" transform="rotate(-10 10 10)" /><path d="M3 15.5a7 7 0 0 1 1-6" /></svg>
  ),
};

const StepDot = ({ index, done, open }: { index: number; done: boolean; open: boolean }) => (
  <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12.5px] font-bold transition", done ? "bg-[#2e7d4f] text-white" : open ? "bg-[#1f2b24] text-white" : "bg-[#eef1ed] text-[#616a64]")} aria-hidden="true">
    {done ? <Icon.Check className="h-4 w-4" /> : index + 1}
  </span>
);

export default function ReelKitPanel({ kit, example, company, creatorName, storageId }: { kit: ReelKit; example?: ReelExample; company: string; creatorName?: string; storageId: string }) {
  const headingId = useId();
  const stepsId = useId();
  const name = creatorName && !creatorName.includes("@") ? creatorName.trim().split(/\s+/)[0] : "";
  const href = demoWalletHref(kit, name);
  const canShare = useSyncExternalStore(subscribeNoop, readCanShare, () => false);
  const [linkFlash, flashLink] = useFlash();
  const [setup, setSetup] = useState<RecordingSetup>("laptop");
  const [done, saveDone] = useDoneSteps(`reelencer:reel-kit:${storageId}`);
  // undefined: follow progress (first unfinished step open); null: everything collapsed by the creator.
  const [openChoice, setOpen] = useState<StepId | null | undefined>(undefined);
  const open = openChoice === undefined ? STEP_IDS.find((id) => !done.has(id)) ?? null : openChoice;
  const shots = reelShots(kit);
  const screenDevice = setup === "laptop" ? "laptop" : "second phone or tablet";
  const absolute = () => new URL(href, window.location.origin).toString();
  const complete = done.size === STEP_IDS.length;

  const steps: Array<{ id: StepId; title: string; summary: string }> = [
    { id: "setup", title: "Set up", summary: `Film a ${screenDevice} screen with your phone camera` },
    { id: "open", title: "Open the demo wallet", summary: setup === "laptop" ? "On the laptop, full screen" : "On the second phone or tablet" },
    { id: "shoot", title: "Film the clips", summary: `${shots.length} short clips: a selfie hook, then the site, ending on the wallet` },
    { id: "post", title: "Edit and post", summary: "Put the clips in order, add your captions and a sound, then submit" },
  ];

  const copy = async (text: string, flash: (message: string) => void, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(message);
    } catch {
      flash("Copy failed. Select the text instead.");
    }
  };
  const finishStep = (id: StepId) => {
    const next = new Set(done);
    next.add(id);
    saveDone(next);
    setOpen(STEP_IDS.find((step) => !next.has(step)) ?? null);
    window.requestAnimationFrame(() => document.getElementById(stepsId)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const toggleDone = (id: StepId) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveDone(next);
  };

  const stepBody = (id: StepId) => {
    if (id === "setup") {
      return (
        <>
          <div role="group" aria-label="Device that shows the screen" className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef1ed] p-1 @md:inline-grid">
            {([["laptop", "Laptop"], ["phone", "Second phone"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={setup === value}
                onClick={() => setSetup(value)}
                className={cx("flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[12.5px] font-semibold transition focus-visible:outline-2 focus-visible:outline-[#2e7d4f]", setup === value ? "bg-white text-[#1a201c] shadow-[0_1px_3px_rgba(26,32,28,0.14)]" : "text-[#616a64] hover:text-[#1a201c]")}
              >
                <span className="[&_svg]:h-4 [&_svg]:w-4">{SetupIcons[value]}</span>{label}
              </button>
            ))}
          </div>

          <div className={setupStyles.panel}>
            <div className={setupStyles.layout}>
              <RecordingSetupArtwork setup={setup} approved={kit.approved} pending={kit.pending} />
              <ol className="space-y-2.5">
                {SETUP_STEPS[setup].map((tip) => (
                  <li key={tip.kind} className="flex gap-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-[#2e7d4f] shadow-[0_1px_2px_rgba(26,32,28,0.08)]" aria-hidden="true">{TipIcons[tip.kind]}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold leading-5 text-[#1a201c]">{tip.title}</span>
                      <span className="block text-[12px] leading-[1.1rem] text-[#616a64]">{tip.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#4b544e]">
            <span className="font-semibold text-[#7a827c]">You&apos;ll need</span>
            {(setup === "laptop" ? ["A laptop", "Your phone", "A bright spot for the selfie"] : ["A second phone or tablet", "Your phone", "A bright spot for the selfie"]).map((item) => (
              <span key={item} className="inline-flex items-center gap-1"><Icon.Check className="h-3 w-3 text-[#2e7d4f]" />{item}</span>
            ))}
          </p>
        </>
      );
    }
    if (id === "open") {
      return (
        <>
          <p className="text-[13px] leading-5 text-[#3b443e]">
            It&apos;s the real Reelencer wallet filled with this gig&apos;s figures and labelled as a demo workspace, so you can film it safely.{" "}
            {`Open it on the ${screenDevice}, not on the phone you film with. On the wrong device? Copy or send the link.`}
          </p>
          <div className="mt-3 grid gap-2 @md:flex @md:flex-wrap">
            <a href={href} target="_blank" rel="noopener" className={buttonClassName("primary", "md", "h-11 sm:h-10")}>
              Open demo wallet <Icon.External className="h-3.5 w-3.5" />
            </a>
            <button type="button" onClick={() => void copy(absolute(), flashLink, "Link copied")} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
              <Icon.Clipboard className="h-3.5 w-3.5" /> Copy link
            </button>
            {canShare ? (
              <button type="button" onClick={() => void navigator.share({ title: "Reelencer demo wallet", url: absolute() }).catch(() => undefined)} className={buttonClassName("secondary", "md", "h-11 sm:h-10")}>
                Send the link
              </button>
            ) : null}
          </div>
          <p role="status" aria-live="polite" className="mt-1.5 min-h-4 text-[11.5px] font-medium text-[#2e7d4f]">{linkFlash}</p>
          <div className="mt-1 rounded-xl bg-[#fafbf9] p-3.5">
            <div className="text-[12.5px] font-semibold text-[#1a201c]">{setup === "laptop" ? "Keyboard controls on the screen" : "Controls on the screen"}</div>
            {setup === "laptop" ? (
              <dl className="mt-2 grid gap-x-4 gap-y-2 text-[12.5px] text-[#3b443e] @md:grid-cols-2">
                {([["Space", "Play a take (3s countdown)"], ["F", "Full screen"], ["S", "Auto-browse on or off"], ["R", "Reset"], ["Esc", "Stop a take early"], ["H", "Hide the controls"]] as const).map(([key, action]) => (
                  <div key={key} className="flex items-center gap-2.5">
                    <dt><Kbd>{key}</Kbd></dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-5 text-[#3b443e]">
                <li>Tap <span className="font-semibold">Play take</span>: the controls disappear, a silent 3-second countdown runs, then the figures count up and the screen is browsed down to the payouts.</li>
                <li>Nothing else appears until the take ends. Tap the screen afterwards to bring the controls back; <span className="font-semibold">Reset</span> starts over.</li>
              </ul>
            )}
          </div>
        </>
      );
    }
    if (id === "shoot") {
      return <ReelStoryboard kit={kit} example={example} href={href} setup={setup} />;
    }
    return (
      <>
        <p className="text-[13px] leading-5 text-[#3b443e]">
          In CapCut, InShot or Instagram&apos;s editor, put the clips in the example&apos;s order, about 14 seconds in total.
        </p>
        <ol className="mt-3 space-y-2.5">
          {[
            "Write a short, relatable caption for each clip in your own words, as a white box with bold black text: the hook mid-screen over your face, the rest in the lower middle.",
            "Keep it quick, about one caption every one or two seconds, and cut on the beat of an upbeat trending sound.",
            "Export in 9:16 at the highest quality and post it on your linked account.",
            "Copy the reel's link and submit it from Linked so it counts towards your earnings.",
          ].map((item, index) => (
            <li key={item} className="flex gap-2.5 text-[13px] leading-5 text-[#3b443e]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef6ec] text-[10.5px] font-bold text-[#2b5d4a]" aria-hidden="true">{index + 1}</span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ol>
      </>
    );
  };

  return (
    <section id="reel-kit" aria-labelledby={headingId} className="@container min-w-0 scroll-mt-24">
      {/* Header: what this is, progress, and the one action that matters most. */}
      <header className="rounded-2xl bg-[radial-gradient(120%_140%_at_0%_0%,#e3f1df_0%,#f3f9f1_50%,#f7faf6_100%)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1f2b24] text-white" aria-hidden="true"><Icon.Video className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h3 id={headingId} className="text-[17px] font-semibold leading-tight text-[#1a201c]">Record your reel</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#4b544e]">
                Follow the sample reel: a selfie hook, a few quick clips of Reelencer, then a demo wallet that&apos;s ready to film. Shoot it all on your phone, add your own captions and post.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 @2xl:shrink-0">
            <ProgressRing value={done.size} total={STEP_IDS.length} />
            <span className="hidden min-w-0 text-[12px] leading-4 text-[#616a64] @md:block @2xl:hidden @4xl:block">{complete ? "All steps done" : done.size ? `${done.size} of ${STEP_IDS.length} steps done` : "4 quick steps"}</span>
            <a href={href} target="_blank" rel="noopener" className={buttonClassName("primary", "md", "ml-auto h-11 sm:h-10")}>
              Open demo wallet <Icon.External className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* How to make it */}
      <div id={stepsId} className="mt-5 scroll-mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-[14.5px] font-semibold text-[#1a201c]">How to make it</h4>
          <span className="text-[11.5px] text-[#7a827c]">Progress saves on this device</span>
        </div>

        {kit.steps.length ? (
          <figure className="mt-3 rounded-xl border-l-4 border-[#2e7d4f] bg-[#f1f8ef] px-4 py-3">
            <figcaption className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">Notes from {company}</figcaption>
            <ul className="mt-1.5 space-y-1">
              {kit.steps.map((step) => (
                <li key={step} className="flex gap-2 text-[13px] leading-5 text-[#1a201c]"><Icon.Check className="mt-1 h-3 w-3 shrink-0 text-[#2e7d4f]" />{step}</li>
              ))}
            </ul>
          </figure>
        ) : null}

        <ol className="mt-2">
          {steps.map((step, index) => {
            const isOpen = open === step.id;
            const isDone = done.has(step.id);
            const bodyId = `${stepsId}-${step.id}`;
            return (
              <li key={step.id} className="relative">
                {/* A thin line joins the step numbers, so the steps read as one path without boxes. */}
                {index < steps.length - 1 ? <span aria-hidden="true" className={cx("absolute -bottom-1 left-4 top-11 w-px -translate-x-1/2", isDone ? "bg-[#9cc9a8]" : "bg-[#e3e7df]", isOpen && "hidden @md:block")} /> : null}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpen(isOpen ? null : step.id)}
                  className="group flex w-full items-center gap-3 rounded-xl py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e7d4f]"
                >
                  <StepDot index={index} done={isDone} open={isOpen} />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block text-[13.5px] font-semibold group-hover:text-[#2e7d4f]", isDone && !isOpen ? "text-[#4b544e]" : "text-[#1a201c]")}>{step.title}{isDone ? <span className="sr-only"> (done)</span> : null}</span>
                    <span className="line-clamp-2 block text-[12px] leading-4 text-[#7a827c]">{step.summary}</span>
                  </span>
                  <Icon.ChevronDown className={cx("h-4 w-4 shrink-0 text-[#7a827c] transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen ? (
                  <div id={bodyId} className="pb-5 pt-1 motion-safe:animate-[reelkit-in_200ms_ease-out] @md:pl-11">
                    {stepBody(step.id)}
                    <div className="mt-4 flex items-center justify-end gap-3">
                      {isDone ? (
                        <p className="flex items-center gap-2 text-[12.5px] font-medium text-[#2e7d4f]">
                          <Icon.Check className="h-4 w-4" /> Done
                          <button type="button" onClick={() => toggleDone(step.id)} className="rounded px-1 font-semibold text-[#7a827c] underline-offset-2 hover:text-[#1a201c] hover:underline">Undo</button>
                        </p>
                      ) : (
                        <button type="button" onClick={() => finishStep(step.id)} className={buttonClassName("primary", "md", "h-11 w-full sm:h-10 @md:w-auto")}>
                          {index < steps.length - 1 ? <>Done, next step <Icon.ChevronRight className="h-4 w-4" /></> : <>Done <Icon.Check className="h-4 w-4" /></>}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {complete ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-[#e3f1df] px-4 py-3 text-[13px] font-semibold text-[#1f5131]">
            <Icon.Check className="h-4 w-4 shrink-0" /> All set. Post the reel and submit its link from Linked so it counts.
          </p>
        ) : null}
      </div>
    </section>
  );
}
