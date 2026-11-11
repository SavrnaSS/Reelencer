"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { CPM_ACTIONS, CPM_REASONS, COMMENT_KEYWORD, SIGNAL_ORDER, cpmSummary, type AdjustedReel, type CpmActionId } from "@/lib/cpmAdjustments";
import { formatINR } from "@/lib/payoutPlans";
import { countedReels } from "@/lib/reelTracking";
import { formatCompact, isValidViewPayoutRate, parsePayoutAmount, type LinkedSocialAccount, type SocialPost } from "@/lib/socialAnalytics";
import { cx, formatDate } from "./dashboardUi";
import CpmSplitBar from "@/app/_components/CpmSplitBar";

// For creators whose reels the team gave a lower CPM: how far it dropped and why, what it costs at today's views,
// and three concrete steps (bio link, auto DM, sign-up ask) that bring it back up, with text ready to copy.

export const CPM_ANCHOR = "cpm-health";
const VISIBLE = 3;
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
      className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition", copied ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#1f4f37] text-white hover:bg-[#2a6447]")}
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
  const reasonSet = new Set(summary.reasons.map(item => item.reason));
  const detected = SIGNAL_ORDER.filter(reason => reasonSet.has(reason));
  // The most common signal leads; ties go to the one that matters most (sign-ups first).
  const primary = [...detected].sort((a, b) => (summary.reasons.find(r => r.reason === b)?.count ?? 0) - (summary.reasons.find(r => r.reason === a)?.count ?? 0))[0];
  const progress = done.size / CPM_ACTIONS.length;

  return (
    <section id={CPM_ANCHOR} aria-labelledby={`${id}-title`} className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#f3d9c4] bg-white">
      {/* Headline: what was detected on the creator's own profile */}
      <div className="bg-[radial-gradient(120%_140%_at_0%_0%,#fff3e8_0%,#fffaf6_45%,#ffffff_100%)] px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fde3d0] px-2 py-0.5 text-[11px] font-semibold text-[#9a3412]">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ea580c] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ea580c]" />
            </span>
            Detected on @{account.handle}
          </span>
          <span className="text-[11.5px] text-[#8a6a55]">{detected.length} {detected.length === 1 ? "signal is" : "signals are"} holding your CPM down on {reels.length} {reels.length === 1 ? "reel" : "reels"}</span>
        </div>
        <h3 id={`${id}-title`} className="mt-2.5 text-[19px] font-semibold leading-tight tracking-[-0.01em] text-[#1a201c] sm:text-[23px]">{primary ? CPM_REASONS[primary].detected : "Low interaction detected on your reels"}</h3>
        <p className="mt-1 max-w-[62ch] text-[13.5px] leading-5 text-[#5a4a3f]">
          <b className="font-semibold text-[#9a3412]">{primary ? CPM_REASONS[primary].action : CPM_REASONS.low_reel_engagement.action}</b>{" "}
          CPM, what you earn per 1,000 views, follows how well your reels turn viewers into comments and sign-ups.
        </p>

        <div className="mt-3.5 grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {/* Profile signal check */}
          <div className="rounded-2xl bg-white/90 p-3 ring-1 ring-[#f3e3d6] sm:p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-[#3b443e]">Your profile check</p>
              <span className="text-[11px] tabular-nums text-[#8a928c]">{SIGNAL_ORDER.length - detected.length}/{SIGNAL_ORDER.length} clear</span>
            </div>
            <ul className="mt-2 divide-y divide-[#f5efe9]">
              {SIGNAL_ORDER.map(reason => {
                const flagged = reasonSet.has(reason);
                const count = summary.reasons.find(item => item.reason === reason)?.count ?? 0;
                return (
                  <li key={reason} className="flex items-center gap-2.5 py-2">
                    <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full", flagged ? "bg-[#fde3d0] text-[#c2410c]" : "bg-[#eef1ed] text-[#9aa29c]")} aria-hidden="true">
                      {flagged ? (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 7v6m0 4h.01" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 12h12" /></svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cx("truncate text-[12.5px]", flagged ? "font-semibold text-[#1a201c]" : "text-[#7a827c]")}>{CPM_REASONS[reason].signal}</span>
                        <span className={cx("shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold", flagged ? "bg-[#fee4e2] text-[#b42318]" : "bg-[#f1f3f0] text-[#8a928c]")}>{flagged ? CPM_REASONS[reason].status : "Not flagged"}</span>
                      </div>
                      {flagged ? (
                        <>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#f5ebe2]" aria-hidden="true">
                            <div className="h-full rounded-full bg-[linear-gradient(90deg,#dc2626,#f59e0b)]" style={{ width: `${Math.max(12, 32 - count * 6)}%` }} />
                          </div>
                          <p className="mt-1 text-[11.5px] leading-4 text-[#6b5a4e]">{CPM_REASONS[reason].text}{reels.length > 1 ? ` Found on ${count} of ${reels.length} reels.` : ""}</p>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* What those signals do to the CPM */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl bg-white/90 p-3.5 ring-1 ring-[#f3e3d6] sm:p-4">
            <div className="flex items-center gap-3">
              <CpmGauge share={summary.share} size={72} label={`CPM at ${Math.round(summary.share * 100)}% of the full rate`} />
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-[#616a64]">CPM on {reels.length === 1 ? "this reel" : "these reels"}</div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#1a201c] sm:text-[34px]">{formatINR(summary.rateINR)}</span>
                  <span className="text-[13px] font-medium text-[#7a827c]">/ 1K</span>
                </div>
                <div className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#c2410c]">
                  <DownArrow className="h-3.5 w-3.5" />
                  {Math.round(summary.dropPct)}% below the full {formatINR(summary.standardRateINR)}
                </div>
              </div>
            </div>
            <p className="rounded-xl bg-[#f4f9f2] px-3 py-2 text-[12px] leading-5 text-[#1f5131]">
              Clear the signals on the left and your reels go back to <b className="font-semibold">{formatINR(summary.standardRateINR)} per 1K views</b>.
            </p>
          </div>
        </div>
      </div>

      {/* The plan: three steps */}
      <div className="border-t border-[#f5ebe2] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-[14px] font-semibold text-[#1a201c]">3 steps to a higher CPM</h4>
            <p className="mt-0.5 text-[12px] text-[#616a64]">Each one turns your viewers into sign-ups, which is what the full rate pays for.</p>
          </div>
          <div className="flex items-center gap-2" aria-label={`${done.size} of ${CPM_ACTIONS.length} steps done`}>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#eef0ed]">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#2e7d4f,#5fb27f)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="text-[12px] font-semibold tabular-nums text-[#1f5131]">{done.size}/{CPM_ACTIONS.length}</span>
          </div>
        </div>

        <ol className="mt-3 grid gap-2.5 lg:grid-cols-3">
          {CPM_ACTIONS.map((action, index) => {
            const isDone = done.has(action.id);
            const flagged = action.fixes.some(reason => reasonSet.has(reason));
            return (
              <li key={action.id} className={cx("flex flex-col rounded-xl border p-3.5 transition", isDone ? "border-[#cfe3d4] bg-[#f4f9f2]" : flagged ? "border-[#f3d3bb] bg-[#fffaf5]" : "border-[#ebedea] bg-white")}>
                <div className="flex items-start gap-2.5">
                  <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", isDone ? "bg-[#2e7d4f] text-white" : "bg-[#1f4f37]/10 text-[#1f4f37]")}>
                    {isDone ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={STEP_ICONS[action.id]} /></svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-[#8a928c]">Step {index + 1}</span>
                      {flagged && !isDone ? <span className="rounded-full bg-[#fde3d0] px-1.5 py-px text-[10px] font-semibold text-[#9a3412]">Raises your CPM</span> : null}
                    </div>
                    <p className={cx("mt-0.5 text-[13.5px] font-semibold leading-snug", isDone ? "text-[#1f5131]" : "text-[#1a201c]")}>{action.title}</p>
                  </div>
                </div>
                <p className="mt-2 text-[12.5px] leading-5 text-[#4d5a51]">{action.text}</p>
                {action.id !== "bio" ? (
                  <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[12px] leading-5 text-[#3b443e] ring-1 ring-[#eef0ec]">{action.copy}</p>
                ) : (
                  <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[12.5px] font-semibold text-[#1f4f37] ring-1 ring-[#eef0ec]">reelencer.com</p>
                )}
                {action.id === "dm" ? <p className="mt-1.5 text-[11px] leading-4 text-[#7a827c]">Trigger word: <b className="font-semibold text-[#3b443e]">{COMMENT_KEYWORD}</b>. Use Instagram&apos;s automated replies or any auto-DM tool you trust.</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-0.5 lg:mt-auto">
                  <CopyButton text={action.copy} label={action.copyLabel} />
                  {"href" in action && action.href ? (
                    <a href={action.href} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-[#2b5d4a] ring-1 ring-[#dfe6df] transition hover:bg-[#f3f7f1]">
                      {action.hrefLabel}
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6L10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                    </a>
                  ) : null}
                  <button type="button" onClick={() => toggle(action.id)} aria-pressed={isDone} className={cx("ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold transition", isDone ? "text-[#1f5131] hover:bg-[#e8f2e6]" : "text-[#616a64] hover:bg-[#f1f3f0]")}>
                    <span className={cx("grid h-4 w-4 place-items-center rounded border", isDone ? "border-[#2e7d4f] bg-[#2e7d4f] text-white" : "border-[#c9cfc9] bg-white")}>
                      {isDone ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg> : null}
                    </span>
                    {isDone ? "Done" : "Mark done"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {done.size === CPM_ACTIONS.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#eef7ea] px-3 py-2.5 text-[12.5px] leading-5 text-[#1f5131]">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="#e0a800" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9Z" /></svg>
            <span>Great work. Keep the link in your bio and the auto DM on. The team re-checks your reels and profile, and raises your CPM as comments and sign-ups come in.</span>
          </p>
        ) : null}
      </div>

      {/* Each adjusted reel */}
      <div className="border-t border-[#f5ebe2] px-4 py-4 sm:px-5">
        <h4 className="text-[13.5px] font-semibold text-[#1a201c]">Where it was detected</h4>
        <ul className="mt-2.5 grid gap-2 md:grid-cols-2">
          {visible.map(reel => (
            <li key={reel.post.id} className="flex gap-3 rounded-xl border border-[#f1e6dc] p-3">
              <div className="relative grid place-items-center">
                <CpmGauge share={reel.share} size={52} label={`CPM at ${Math.round(reel.share * 100)}% of the full rate`} />
                <span className="absolute text-[10.5px] font-bold tabular-nums text-[#c2410c]">−{Math.round((1 - reel.share) * 100)}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <a href={reel.post.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[13px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">{reelTitle(reel.post.caption)}</a>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
                  <span className="font-semibold tabular-nums text-[#1a201c]">{formatINR(reel.rateINR)}/1K</span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-[#c2410c]"><DownArrow className="h-3 w-3" />{reel.afterViews ? `after ${formatCompact(reel.afterViews)} views` : `from ${formatINR(reel.standardRateINR)}`}</span>
                  <span className="text-[#8a928c]">· {formatCompact(reel.views)} views{reel.post.postedAt ? ` · ${formatDate(reel.post.postedAt)}` : ""}</span>
                </div>
                {reel.reasons.length ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10.5px] font-medium text-[#8a6a55]">Detected:</span>
                    {reel.reasons.map(reason => <span key={reason} className="rounded-full bg-[#fff1e6] px-1.5 py-px text-[10.5px] font-medium text-[#9a3412]">{CPM_REASONS[reason].title}</span>)}
                  </div>
                ) : null}
                {reel.afterViews ? <CpmSplitBar views={reel.views} afterViews={reel.afterViews} standardRateINR={reel.standardRateINR} rateINR={reel.rateINR} /> : null}
                {reel.post.cpmAdjustment?.note ? <p className="mt-1.5 text-[11.5px] leading-4 text-[#5a4a3f]"><span className="font-semibold">Note: </span>{reel.post.cpmAdjustment.note}</p> : null}
                {reel.walletChangeINR ? <p className={cx("mt-1.5 text-[11.5px] font-medium", reel.walletChangeINR < 0 ? "text-[#b42318]" : "text-[#1f5131]")}>Earnings in your wallet {reel.walletChangeINR < 0 ? "repriced by −" : "repriced by +"}{formatINR(Math.abs(reel.walletChangeINR))}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        {reels.length > VISIBLE ? (
          <button type="button" onClick={() => setShowAll(value => !value)} className="mt-2 h-9 w-full rounded-lg text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#f3f7f1]">
            {showAll ? "Show fewer" : `Show all ${reels.length} reels`}
          </button>
        ) : null}
        <p className="mt-3 text-[11.5px] leading-5 text-[#8a928c]">A lower CPM covers all of a reel&apos;s views past the point shown, including earnings already in your wallet. When the signals improve, your CPM and those earnings go back up.</p>
      </div>
    </section>
  );
}
