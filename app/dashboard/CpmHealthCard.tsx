"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { CPM_ACTIONS, CPM_REASONS, COMMENT_KEYWORD, SIGNAL_ORDER, SIGNAL_SHORT, cpmSummary, type AdjustedReel, type CpmActionId, type CpmReason } from "@/lib/cpmAdjustments";
import { formatINR } from "@/lib/payoutPlans";
import { countedReels } from "@/lib/reelTracking";
import { formatCompact, isValidViewPayoutRate, parsePayoutAmount, type LinkedSocialAccount, type SocialPost } from "@/lib/socialAnalytics";
import { cx, formatDate } from "./dashboardUi";
import CpmSplitBar from "@/app/_components/CpmSplitBar";

// For creators with reels earning a lower CPM: what was detected and on which reel, each affected reel with only its
// own signals, and a compact checklist (bio link, auto DM, sign-up ask, Reelencer stories) with text ready to copy.

export const CPM_ANCHOR = "cpm-health";
const VISIBLE = 2;
const TICKS = 40;

/** Dashed ring like a speed gauge: lit ticks show the CPM as a share of the full rate. */
function CpmGauge({ share, size = 64, label }: { share: number; size?: number; label: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);
  const lit = Math.round(Math.max(0, Math.min(1, shown)) * TICKS);
  const tone = share >= 0.75 ? "#d97706" : share >= 0.5 ? "#ea580c" : "#dc2626";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label} className="shrink-0">
      {Array.from({ length: TICKS }, (_, index) => (
        <line
          key={index}
          x1="32" y1="4" x2="32" y2={index % 5 === 0 ? 11 : 9.5}
          transform={`rotate(${(index / TICKS) * 360} 32 32)`}
          stroke={index < lit ? tone : "currentColor"}
          strokeWidth={index % 5 === 0 ? 2.4 : 1.8}
          strokeLinecap="round"
          className="text-[#dfe3de] transition-[stroke] duration-300 motion-reduce:transition-none"
          style={{ transitionDelay: `${index * 12}ms` }}
        />
      ))}
    </svg>
  );
}

function DownArrow({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        }).catch(() => undefined);
      }}
      className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold whitespace-nowrap transition", copied ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#1f4f37] text-white hover:bg-[#2a6447]")}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
      )}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

const STEP_ICONS: Record<CpmActionId, string> = {
  bio: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  dm: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Zm-12-1h6m-6 3h4",
  cta: "M12 5v14m-7-7h14",
  // A story ring: a dashed circle around a dot.
  story: "M12 3a9 9 0 0 1 9 9M21 12a9 9 0 0 1-9 9M12 21a9 9 0 0 1-9-9M3 12a9 9 0 0 1 9-9M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
};

/** Ticked steps are a per-device reminder for the creator, never sent anywhere. */
const STEPS_EVENT = "reelencer:cpm-steps";
// In-memory fallback so ticking still works where storage is blocked (private windows).
const memory = new Map<string, string>();
const readStorage = (key: string) => { try { return window.localStorage.getItem(key) ?? memory.get(key) ?? "[]"; } catch { return memory.get(key) ?? "[]"; } };
const subscribeSteps = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(STEPS_EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(STEPS_EVENT, onChange); };
};
function useDoneSteps(accountId: string) {
  const key = `reelencer.cpmSteps.${accountId}`;
  const raw = useSyncExternalStore(subscribeSteps, () => readStorage(key), () => "[]");
  const done = useMemo(() => {
    try {
      const saved: unknown = JSON.parse(raw);
      return new Set(Array.isArray(saved) ? saved.filter((id): id is CpmActionId => CPM_ACTIONS.some(action => action.id === id)) : []);
    } catch { return new Set<CpmActionId>(); }
  }, [raw]);
  const toggle = (id: CpmActionId) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id); else next.add(id);
    memory.set(key, JSON.stringify([...next]));
    try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* storage unavailable: memory only */ }
    window.dispatchEvent(new Event(STEPS_EVENT));
  };
  return { done, toggle };
}

function reelTitle(caption?: string) {
  const text = String(caption ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s{2,}/g, " ").trim();
  return text || "Untitled reel";
}

/** The account's adjusted reels, for the card and the per-reel badges. */
export function useAccountCpm(account: LinkedSocialAccount) {
  return useMemo(() => {
    if (String(account.payoutType ?? "").trim().toLowerCase() !== "per 1k views" || !isValidViewPayoutRate(account.payout)) return undefined;
    const gigRate = parsePayoutAmount(account.payout)?.amount ?? 0;
    return cpmSummary(countedReels(account.posts, account.linkedAt), account.payoutPlan, gigRate);
  }, [account.payout, account.payoutType, account.posts, account.linkedAt, account.payoutPlan]);
}

const SIGNAL_ICONS: Record<CpmReason, string> = {
  low_signups: "M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10-2v6m3-3h-6",
  low_reel_engagement: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  low_profile_engagement: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  no_bio_link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  no_auto_dm: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z",
};

/** Pill-sized names, so every signal on a reel fits in a line or two. */
const SIGNAL_PILL: Record<CpmReason, string> = {
  low_signups: "Sign-ups", low_reel_engagement: "Interaction", low_profile_engagement: "Profile visits", no_bio_link: "Bio link", no_auto_dm: "Auto DM",
};

/** What was detected on one reel: one quiet line of icon + name + status, worst first; red for missing/off. */
function ReelSignals({ reasons }: { reasons: CpmReason[] }) {
  const ordered = SIGNAL_ORDER.filter(reason => reasons.includes(reason));
  return (
    <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] leading-5" aria-label="Detected on this reel">
      {ordered.map(reason => {
        const missing = CPM_REASONS[reason].status !== "Low";
        return (
          <li key={reason} title={`${CPM_REASONS[reason].signal}: ${CPM_REASONS[reason].status}. ${CPM_REASONS[reason].text}`}
            className={cx("inline-flex items-center gap-1 whitespace-nowrap", missing ? "text-[#b42318]" : "text-[#9a3412]")}>
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 opacity-80" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SIGNAL_ICONS[reason]} /></svg>
            <span className="font-medium">{SIGNAL_PILL[reason]}</span>
            <span className="opacity-70">{CPM_REASONS[reason].status.toLowerCase()}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Small badge on a reel card: its lowered CPM, linking to the card that explains it. */
export function ReelCpmBadge({ reel, compact }: { reel: AdjustedReel<SocialPost>; compact?: boolean }) {
  return (
    <a
      href={`#${CPM_ANCHOR}`}
      title={`${reel.reasons[0] ? CPM_REASONS[reel.reasons[0]].detected : "Low interaction detected"}: ${formatINR(reel.rateINR)} per 1K views${reel.afterViews ? ` after ${reel.afterViews.toLocaleString("en-IN")} views` : ""} instead of ${formatINR(reel.standardRateINR)}. See how to raise it.`}
      className={cx("inline-flex items-center gap-0.5 rounded-full bg-[#fff1e6] font-semibold tabular-nums text-[#b54708] ring-1 ring-[#fbd9bf] transition hover:bg-[#ffe6d2]", compact ? "px-1.5 py-px text-[10px]" : "px-1.5 py-px text-[10.5px]")}
    >
      <DownArrow className="h-2.5 w-2.5" />
      CPM {formatINR(reel.rateINR)}/1K
      {!compact ? <span className="font-medium text-[#c2410c]/80">{reel.afterViews ? ` after ${formatCompact(reel.afterViews)}` : ` · from ${formatINR(reel.standardRateINR)}`}</span> : null}
    </a>
  );
}

export default function CpmHealthCard({ account }: { account: LinkedSocialAccount }) {
  const id = useId();
  const summary = useAccountCpm(account);
  const [showAll, setShowAll] = useState(false);
  const { done, toggle } = useDoneSteps(account.id);
  if (!summary) return null;

  const { reels } = summary;
  const visible = showAll ? reels : reels.slice(0, VISIBLE);
  const counts = new Map(summary.reasons.map(item => [item.reason, item.count]));
  // The most common signal leads; ties go to the one that matters most (sign-ups first).
  const primary = SIGNAL_ORDER.filter(reason => counts.has(reason)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? "low_reel_engagement";
  // Steps that fix a detected signal come first.
  const steps = [...CPM_ACTIONS].sort((a, b) => Number(b.fixes.some(r => counts.has(r))) - Number(a.fixes.some(r => counts.has(r))));
  // The tag only helps when it singles out some steps, not when every step fixes something detected.
  const tagSteps = !CPM_ACTIONS.every(action => action.fixes.some(r => counts.has(r)));
  const where = reels.length === 1 ? "1 of your reels" : `${reels.length} of your reels`;

  return (
    <section id={CPM_ANCHOR} aria-labelledby={`${id}-title`} className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#f3d9c4] bg-white">
      {/* What was detected, and where */}
      <div className="flex items-start gap-3 bg-[linear-gradient(120deg,#fff3e8,#fffaf6_55%,#ffffff)] px-4 py-3.5 sm:px-5">
        <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fde3d0] text-[#c2410c]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l6 6 4-4 8 8M21 11v6h-6" /></svg>
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ea580c] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ea580c] ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-[15.5px] font-semibold leading-snug text-[#1a201c] sm:text-[17px]">
            {SIGNAL_SHORT[primary]} detected on {where}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-5 text-[#9a3412] sm:text-[13px]">{CPM_REASONS[primary].action}</p>
        </div>
      </div>

      {/* Each affected reel, with only what was found on it */}
      <ul className="divide-y divide-[#f5ede6] border-t border-[#f5ede6]">
        {visible.map(reel => (
          <li key={reel.post.id} className="px-4 py-3 sm:px-5">
            <div className="flex items-start gap-3">
              <div className="relative grid shrink-0 place-items-center">
                <CpmGauge share={reel.share} size={46} label={`CPM at ${Math.round(reel.share * 100)}% of the full rate`} />
                <span className="absolute text-[9.5px] font-bold tabular-nums text-[#c2410c]">−{Math.round((1 - reel.share) * 100)}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={reel.post.url} target="_blank" rel="noreferrer noopener" className="group inline-flex max-w-full items-center gap-1 text-[13.5px] font-semibold text-[#1a201c]">
                      <span className="truncate underline-offset-2 group-hover:underline">{reelTitle(reel.post.caption)}</span>
                      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-[#9aa29c]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6L10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                    </a>
                    <p className="mt-0.5 text-[11.5px] tabular-nums text-[#7a827c]">
                      {reel.post.postedAt ? formatDate(reel.post.postedAt) : "No date"} · {formatCompact(reel.views)} views{reel.afterViews ? ` · lower CPM after ${formatCompact(reel.afterViews)}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[17px] font-semibold leading-none tabular-nums text-[#1a201c]">{formatINR(reel.rateINR)}<span className="text-[11px] font-medium text-[#7a827c]">/1K</span></div>
                    <div className="mt-1 text-[11px] tabular-nums text-[#9aa29c] line-through decoration-[#c2410c]/60">{formatINR(reel.standardRateINR)}/1K</div>
                  </div>
                </div>
                {reel.reasons.length ? <ReelSignals reasons={reel.reasons} /> : null}
                {reel.post.cpmAdjustment?.note ? <p className="mt-1.5 text-[11.5px] leading-4 text-[#5a4a3f]">“{reel.post.cpmAdjustment.note}”</p> : null}
                {reel.afterViews ? <CpmSplitBar views={reel.views} afterViews={reel.afterViews} standardRateINR={reel.standardRateINR} rateINR={reel.rateINR} /> : null}
                {reel.walletChangeINR ? (
                  <p className={cx("mt-1.5 text-[11.5px] font-medium tabular-nums", reel.walletChangeINR < 0 ? "text-[#b42318]" : "text-[#1f5131]")}>
                    Wallet earnings for this reel repriced {reel.walletChangeINR < 0 ? "−" : "+"}{formatINR(Math.abs(reel.walletChangeINR))}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {reels.length > VISIBLE ? (
        <button type="button" onClick={() => setShowAll(value => !value)} className="h-9 w-full border-t border-[#f5ede6] text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#f7faf6]">
          {showAll ? "Show fewer" : `Show ${reels.length - VISIBLE} more ${reels.length - VISIBLE === 1 ? "reel" : "reels"}`}
        </button>
      ) : null}

      {/* How to raise it: a compact checklist, text ready to copy */}
      <div className="border-t border-[#f5ede6] bg-[#fcfdfb] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="min-w-0 text-[13px] font-semibold text-[#1a201c]">Upgrade your CPM value<span className="block text-[11.5px] font-medium text-[#7a827c] sm:inline sm:text-[13px]"><span className="hidden sm:inline"> · </span>up to {formatINR(summary.standardRateINR)}/1K</span></h4>
          <div className="flex items-center gap-2" aria-label={`${done.size} of ${CPM_ACTIONS.length} steps done`}>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e9ece8] sm:w-20">
              <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(done.size / CPM_ACTIONS.length) * 100}%` }} />
            </div>
            <span className="text-[11.5px] font-semibold tabular-nums text-[#1f5131]">{done.size}/{CPM_ACTIONS.length}</span>
          </div>
        </div>
        <ol className="mt-1.5 divide-y divide-[#eef1ed]">
          {steps.map(action => {
            const isDone = done.has(action.id);
            const flagged = action.fixes.some(reason => counts.has(reason));
            return (
              <li key={action.id} className="py-2.5">
                <div className="flex items-start gap-2.5">
                  <button type="button" onClick={() => toggle(action.id)} aria-pressed={isDone} aria-label={isDone ? `Mark "${action.title}" as not done` : `Mark "${action.title}" as done`}
                    className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full transition", isDone ? "bg-[#2e7d4f] text-white" : "bg-white text-[#1f4f37] ring-1 ring-[#cfd8cf] hover:ring-[#2e7d4f]")}>
                    {isDone ? (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={STEP_ICONS[action.id]} /></svg>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className={cx("text-[13px] font-semibold", isDone ? "text-[#7a827c] line-through decoration-[#9aa29c]" : "text-[#1a201c]")}>{action.title}</span>
                      {flagged && !isDone && tagSteps ? <span className="rounded-full bg-[#fde3d0] px-1.5 py-px text-[10px] font-semibold text-[#9a3412]">Fixes what was detected</span> : null}
                    </div>
                    {!isDone ? <p className="mt-0.5 text-[12px] leading-[18px] text-[#5b645e]">{action.text}</p> : null}
                    {!isDone && action.id !== "bio" ? (
                      <details className="group mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11.5px] font-semibold text-[#2b5d4a] [&::-webkit-details-marker]:hidden">
                          See the text
                          <svg viewBox="0 0 24 24" className="h-3 w-3 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                        </summary>
                        <p className="mt-1.5 rounded-lg bg-white px-2.5 py-2 text-[12px] leading-5 text-[#3b443e] ring-1 ring-[#eef0ec]">{action.copy}</p>
                        {action.id === "dm" ? <p className="mt-1 text-[11px] text-[#7a827c]">Trigger word: <b className="font-semibold text-[#3b443e]">{COMMENT_KEYWORD}</b></p> : null}
                      </details>
                    ) : null}
                  </div>
                  {!isDone ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {"href" in action && action.href ? (
                        <a href={action.href} target="_blank" rel="noreferrer noopener" aria-label={action.hrefLabel} title={action.hrefLabel} className="hidden h-8 w-8 place-items-center rounded-lg text-[#2b5d4a] ring-1 ring-[#dfe6df] transition hover:bg-[#f3f7f1] sm:grid">
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6L10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                        </a>
                      ) : null}
                      <CopyButton text={action.copy} label={action.id === "bio" ? "Copy link" : "Copy"} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-1 text-[11px] leading-4 text-[#8a928c]">
          {done.size === CPM_ACTIONS.length
            ? "All done. Keep them on: your CPM goes back up as sign-ups and comments come in."
            : "A lower CPM covers that reel's views past the point shown, including its earnings in your wallet. It goes back up as the signals improve."}
        </p>
      </div>
    </section>
  );
}
