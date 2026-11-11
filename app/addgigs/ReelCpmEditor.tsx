"use client";

import { useId, useState } from "react";
import { CPM_REASONS, CPM_REASON_IDS, cpmPresets, type CpmReason } from "@/lib/cpmAdjustments";
import { compactViews, cumulativePaise, formatINR, type PayoutTerms } from "@/lib/payoutPlans";
import type { SocialPost } from "@/lib/socialAnalytics";
import { ICONS, Icon, Spinner, btnGhost, btnPrimary, fieldClass } from "./adminUi";
import CpmSplitBar from "@/app/_components/CpmSplitBar";

// Admin: lower one reel's CPM (rate per 1K views) from a view count on, with the reasons the creator will see, or
// restore the standard rate. The database reprices the reel's credited earnings too
// (202611110002_reel_cpm_after_views_and_wallet.sql); money already withdrawn can't be taken back.

export type CpmInput = { rateINR: number | null; reasons: CpmReason[]; note?: string; afterViews: number; fromNow?: boolean };
export type CpmWalletResult = { walletChangeINR: number; unrecoveredINR: number };

const money = /^\d+(\.\d{1,2})?$/;
const START_PRESETS = [0, 5_000, 10_000] as const;
const signed = (amount: number) => `${amount < 0 ? "−" : amount > 0 ? "+" : ""}${formatINR(Math.abs(amount))}`;

/** The chip in a reel row: the reel's current CPM, highlighted when the team lowered it. */
export function CpmChip({ terms, open, onClick, disabled }: { terms: PayoutTerms; open: boolean; onClick: () => void; disabled?: boolean }) {
  const standard = terms.standardRateINR ?? terms.rateINR;
  const adjusted = !!terms.cpmAdjusted && standard > terms.rateINR;
  const drop = adjusted ? Math.round((1 - terms.rateINR / standard) * 100) : 0;
  const after = terms.cpmAfterViews ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
      title={adjusted ? `CPM lowered from ${formatINR(standard)} to ${formatINR(terms.rateINR)} per 1K views${after ? ` after ${after.toLocaleString("en-IN")} views` : ""}. Click to change.` : `Standard CPM ${formatINR(standard)} per 1K views. Click to lower it for this reel.`}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-[999px] border px-2 text-[11.5px] font-semibold tabular-nums transition disabled:opacity-50 ${
        adjusted ? "border-[#f3c9a8] bg-[#fff4ea] text-[#9a3f0b] hover:bg-[#ffe9d6]" : open ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e] hover:bg-[#f5f6f4]"
      }`}
    >
      {adjusted ? (
        <>
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg>
          {formatINR(terms.rateINR)}/1K
          {after ? <span className="font-medium opacity-75">after {compactViews(after)}</span> : <span className="font-medium opacity-75">−{drop}%</span>}
        </>
      ) : (
        <>CPM {formatINR(standard)}/1K</>
      )}
    </button>
  );
}

export default function ReelCpmEditor({ post, terms, onSave, onClose }: {
  post: SocialPost;
  terms: PayoutTerms;
  onSave: (input: CpmInput) => Promise<{ ok: true } | { error: string }>;
  onClose: () => void;
}) {
  const id = useId();
  const standard = terms.standardRateINR ?? terms.rateINR;
  const current = post.cpmAdjustment;
  const [rate, setRate] = useState(current ? String(current.rateINR) : "");
  const [after, setAfter] = useState(String(current?.afterViews ?? 0));
  // "From now" is the default for a new adjustment: nothing the reel already earned changes.
  const [fromNow, setFromNow] = useState(() => (current ? !!current.fromNow : true));
  const [customAfter, setCustomAfter] = useState(() => !!current && !current.fromNow && !(START_PRESETS as readonly number[]).includes(current.afterViews));
  const [reasons, setReasons] = useState<Set<CpmReason>>(() => new Set((current?.reasons ?? ["low_signups"]) as CpmReason[]));
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = Number(rate);
  const validRate = money.test(rate.trim()) && value > 0 && value < standard;
  const views = Number.isSafeInteger(post.views) && post.views! >= 0 ? post.views! : 0;
  // Approved views already credited: repriced in the wallet on save (estimate; excluded views aren't known here).
  const credited = post.walletCredit && post.walletCredit.creditedINR > 0 ? post.walletCredit.consumedViews : 0;
  // From now: the server starts at the reel's count when saved (never below credited views); preview the same.
  const afterViews = fromNow ? Math.max(views, credited) : Number(after);
  const validAfter = fromNow || (/^\d+$/.test(after.trim()) && afterViews <= 1_000_000_000);
  const valid = validRate && validAfter;
  const plan = terms.mode !== "cpm";
  const base = { mode: terms.mode, baseINR: terms.baseINR, thresholdViews: terms.thresholdViews, rateINR: standard };
  const next = valid ? { ...base, rateINR: value, standardRateINR: standard, cpmAdjusted: true, cpmAfterViews: afterViews } : undefined;
  const nowEarns = Number(cumulativePaise(views, terms)) / 100;
  const nextEarns = next ? Number(cumulativePaise(views, next)) / 100 : undefined;
  const walletNow = Number(cumulativePaise(credited, terms)) / 100;
  const walletChange = (target: typeof base) => Math.round((Number(cumulativePaise(credited, target)) / 100 - walletNow) * 100) / 100;
  const presets = cpmPresets(standard);
  const drop = validRate ? Math.round((1 - value / standard) * 100) : 0;
  const changed = !current || value !== current.rateINR || fromNow !== !!current.fromNow || (!fromNow && afterViews !== current.afterViews) || note.trim() !== (current.note ?? "") || [...reasons].sort().join() !== [...current.reasons].sort().join();
  const lead = CPM_REASON_IDS.find((reason) => reasons.has(reason));
  const title = String(post.caption ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s{2,}/g, " ").trim() || post.url;

  const submit = async (input: CpmInput, kind: "save" | "restore") => {
    setBusy(kind);
    setError(null);
    const result = await onSave(input);
    setBusy(null);
    if ("error" in result) setError(result.error);
    else onClose();
  };
  const toggleReason = (reason: CpmReason) => setReasons((now) => { const nextSet = new Set(now); if (nextSet.has(reason)) nextSet.delete(reason); else nextSet.add(reason); return nextSet; });
  const step = (n: number, label: string, hint?: string) => (
    <div className="flex items-baseline gap-2">
      <span className="grid h-5 w-5 shrink-0 translate-y-[3px] place-items-center rounded-[999px] bg-[#1f2b24] text-[10.5px] font-bold text-white" aria-hidden="true">{n}</span>
      <span className="text-[13px] font-semibold text-[#1a201c]">{label}</span>
      {hint ? <span className="min-w-0 truncate text-[11.5px] text-[#8a928c]">{hint}</span> : null}
    </div>
  );

  return (
    <form
      className="w-full overflow-hidden rounded-[16px] bg-white shadow-[0_8px_30px_-12px_rgba(26,32,28,0.25)] ring-1 ring-[#eadfd3]"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && reasons.size) void submit({ rateINR: value, reasons: [...reasons], note: note.trim() || undefined, afterViews: fromNow ? 0 : afterViews, fromNow }, "save");
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 bg-[linear-gradient(135deg,#fff5ec,#fffaf6_55%,#ffffff)] px-3.5 py-3 sm:px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#fde3d0] text-[#9a3f0b]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l6 6 4-4 8 8M21 11v6h-6" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#1a201c]">{current ? "Change this reel's CPM" : "Lower this reel's CPM"}</p>
          <p className="truncate text-[12px] text-[#6b746e]" title={title}>{title}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-medium tabular-nums">
            <span className="rounded-[6px] bg-white px-1.5 py-0.5 text-[#1a201c] ring-1 ring-[#ece4da]">Full rate {formatINR(standard)}/1K</span>
            {plan ? <span className="rounded-[6px] bg-white px-1.5 py-0.5 text-[#3b443e] ring-1 ring-[#ece4da]">Plan: {formatINR(terms.baseINR)} base up to {compactViews(terms.thresholdViews)}</span> : null}
            <span className="rounded-[6px] bg-white px-1.5 py-0.5 text-[#3b443e] ring-1 ring-[#ece4da]">{views.toLocaleString("en-IN")} views</span>
            {current ? <span className="rounded-[6px] bg-[#fff1e6] px-1.5 py-0.5 text-[#9a3f0b] ring-1 ring-[#f6d5bb]">Now {formatINR(current.rateINR)}/1K{current.fromNow ? ` from ${compactViews(current.afterViews)} views` : current.afterViews ? ` after ${compactViews(current.afterViews)}` : ""}</span> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#6b746e] transition hover:bg-white hover:text-[#1a201c]" aria-label="Close">
          <Icon d={ICONS.x} className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-x-5 gap-y-4 border-t border-[#f3ece4] px-3.5 py-3.5 sm:px-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Left: rate and when it starts */}
        <div className="min-w-0 space-y-4">
          <section>
            {step(1, "New CPM", "₹ per 1,000 views")}
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <div className={`flex h-11 w-40 items-center rounded-[12px] bg-white px-3 ring-1 transition focus-within:ring-2 ${rate && !validRate ? "ring-[#e5a29a] focus-within:ring-[#b42318]/40" : "ring-[#d9ddd8] focus-within:ring-[#9a3f0b]/40"}`}>
                <span className="text-[15px] text-[#7a827c]">₹</span>
                <input id={`${id}-rate`} inputMode="decimal" autoFocus value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(presets[1] ?? "")} aria-label="New CPM in rupees per 1,000 views" aria-invalid={!!rate && !validRate}
                  className="min-w-0 flex-1 bg-transparent px-1.5 text-[18px] font-semibold tabular-nums text-[#1a201c] outline-none placeholder:font-normal placeholder:text-[#b5bbb6]" />
                <span className="text-[12px] text-[#8a928c]">/ 1K</span>
              </div>
              {validRate ? (
                <span className="inline-flex items-center gap-1 rounded-[999px] bg-[#fff1e6] px-2 py-1 text-[12px] font-semibold tabular-nums text-[#9a3f0b] ring-1 ring-[#f6d5bb]">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg>
                  {drop}% below {formatINR(standard)}
                </span>
              ) : rate ? (
                <span className="text-[11.5px] text-[#b42318]">Above ₹0 and below {formatINR(standard)}, max 2 decimals</span>
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {presets.map((preset) => {
                const on = value === preset;
                return (
                  <button key={preset} type="button" onClick={() => setRate(String(preset))} aria-pressed={on}
                    className={`flex flex-col items-center rounded-[10px] px-1 py-1.5 tabular-nums ring-1 transition ${on ? "bg-[#9a3f0b] text-white ring-[#9a3f0b]" : "bg-white text-[#1a201c] ring-[#e6ddd3] hover:bg-[#fff6ee]"}`}>
                    <span className="text-[13px] font-semibold">₹{preset}</span>
                    <span className={`text-[10px] ${on ? "text-white/80" : "text-[#8a928c]"}`}>−{Math.round((1 - preset / standard) * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            {step(2, "Lower CPM starts", "earlier views keep the full rate")}
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-[12px] bg-[#f3f4f2] p-1 sm:grid-cols-5" role="radiogroup" aria-label="Lower CPM starts">
              {[{ key: "now", label: "From now", on: fromNow, pick: () => { setFromNow(true); setCustomAfter(false); } },
                ...START_PRESETS.map((start) => ({ key: String(start), label: start === 0 ? "First view" : `After ${compactViews(start)}`, on: !fromNow && !customAfter && Number(after) === start, pick: () => { setFromNow(false); setCustomAfter(false); setAfter(String(start)); } })),
                { key: "custom", label: "Custom", on: !fromNow && customAfter, pick: () => { setFromNow(false); setCustomAfter(true); } }].map((option) => (
                <button key={option.key} type="button" role="radio" aria-checked={option.on} onClick={option.pick}
                  className={`h-8 rounded-[9px] text-[12.5px] font-semibold transition ${option.on ? "bg-white text-[#1a201c] shadow-[0_1px_3px_rgba(26,32,28,0.15)]" : "text-[#5b645e] hover:text-[#1a201c]"}`}>
                  {option.label}
                </button>
              ))}
            </div>
            {fromNow ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-[#f4f9f2] px-2.5 py-2 text-[11.5px] leading-4 text-[#1f5131] ring-1 ring-[#d6e9d4]">
                <svg viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                <span>Starts at the reel&apos;s views when you save ({afterViews.toLocaleString("en-IN")} now). Everything it earned so far keeps {formatINR(standard)}; only new views earn the lower CPM. The wallet doesn&apos;t change.</span>
              </p>
            ) : customAfter ? (
              <div className="mt-2 flex items-center gap-2">
                <input inputMode="numeric" autoFocus value={after} onChange={(e) => setAfter(e.target.value.replace(/\D/g, ""))} aria-label="Lower CPM starts after this many views" placeholder="e.g. 7500" aria-invalid={!validAfter}
                  className={`${fieldClass} h-9 w-36 tabular-nums`} />
                <span className="text-[12px] text-[#6b746e]">views at the full rate first</span>
              </div>
            ) : null}
            <CpmSplitBar views={views} afterViews={validAfter ? afterViews : 0} standardRateINR={standard} rateINR={validRate ? value : undefined} />
          </section>
        </div>

        {/* Right: what the creator is told */}
        <div className="min-w-0 space-y-4">
          <section>
            {step(3, "What's detected", "shown to the creator as their profile signals")}
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {CPM_REASON_IDS.map((reason) => {
                const on = reasons.has(reason);
                return (
                  <button key={reason} type="button" aria-pressed={on} onClick={() => toggleReason(reason)}
                    className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left ring-1 transition ${on ? "bg-[#f4f9f2] ring-[#2e7d4f]" : "bg-white ring-[#e3e5e1] hover:bg-[#fafbf9]"}`}>
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] ${on ? "bg-[#2e7d4f] text-white" : "bg-white ring-1 ring-[#c9cfc9]"}`} aria-hidden="true">
                      {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg> : null}
                    </span>
                    <span className={`min-w-0 text-[12.5px] leading-4 ${on ? "font-semibold text-[#1a201c]" : "text-[#3b443e]"}`}>{CPM_REASONS[reason].admin}</span>
                  </button>
                );
              })}
            </div>
            {lead ? (
              <p className="mt-2 rounded-[10px] bg-[#fffaf5] px-2.5 py-2 text-[11.5px] leading-4 text-[#6b5a4e] ring-1 ring-[#f3e6d9]">
                <span className="font-semibold text-[#9a3f0b]">Creator sees: </span>“{CPM_REASONS[lead].detected}. {CPM_REASONS[lead].action}”
              </p>
            ) : (
              <p className="mt-2 text-[11.5px] text-[#b42318]">Pick at least one, so the creator knows what to fix.</p>
            )}
          </section>

          <section>
            {step(4, "Note to the creator", "optional")}
            <textarea id={`${id}-note`} value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Most views came without likes or comments"
              className={`${fieldClass} mt-2 resize-none py-2 leading-5`} />
            <p className="mt-0.5 text-right text-[10.5px] tabular-nums text-[#9aa29c]">{note.length}/300</p>
          </section>
        </div>
      </div>

      {/* Impact */}
      <div className="grid grid-cols-2 gap-px border-t border-[#f3ece4] bg-[#f3ece4] sm:grid-cols-4">
        {[
          { label: "Reel earns now", value: formatINR(nowEarns), sub: plan && views <= terms.thresholdViews ? `${formatINR(terms.baseINR)} base, under ${compactViews(terms.thresholdViews)}` : `at ${compactViews(views)} views`, tone: "text-[#1a201c]" },
          { label: "After saving", value: nextEarns === undefined ? "–" : formatINR(nextEarns), sub: nextEarns === undefined ? "enter a rate" : nextEarns === nowEarns ? "no change yet" : `${signed(nextEarns - nowEarns)} on this reel`, tone: "text-[#1a201c]" },
          { label: "Wallet now", value: next ? signed(walletChange(next)) : "–", sub: credited ? `${compactViews(credited)} credited views repriced` : "nothing credited yet", tone: next && walletChange(next) < 0 ? "text-[#b42318]" : next && walletChange(next) > 0 ? "text-[#1f5131]" : "text-[#1a201c]" },
          { label: "At 2× views", value: next ? formatINR(Number(cumulativePaise(views * 2, next)) / 100) : "–", sub: next ? `vs ${formatINR(Number(cumulativePaise(views * 2, base)) / 100)} at full rate` : "projection", tone: "text-[#1a201c]" },
        ].map((tile) => (
          <div key={tile.label} className="bg-[#fffdfb] px-3 py-2.5">
            <div className="text-[11px] text-[#7a827c]">{tile.label}</div>
            <div className={`mt-0.5 text-[16px] font-semibold tabular-nums ${tile.tone}`}>{tile.value}</div>
            <div className="truncate text-[10.5px] text-[#8a928c]">{tile.sub}</div>
          </div>
        ))}
      </div>

      {error ? <p role="alert" className="border-t border-[#f6d5d1] bg-[#fdf0ef] px-4 py-2 text-[12px] text-[#b42318]">{error}</p> : null}

      {/* Actions */}
      <div className="flex flex-col gap-2 border-t border-[#eef0ec] bg-[#fafbf9] px-3.5 py-2.5 sm:flex-row sm:items-center sm:px-4">
        <p className="min-w-0 flex-1 text-[11.5px] leading-4 text-[#6b746e]">
          {fromNow ? "From now: only views after saving earn the lower CPM. The wallet doesn't change." : credited ? "Saving reprices approved earnings in the wallet. Money already withdrawn can't be taken back." : "The new rate applies when the reel is approved."}
        </p>
        <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
          {current ? (
            <button type="button" className={`${btnGhost} h-9 flex-1 sm:flex-none`} disabled={!!busy} onClick={() => void submit({ rateINR: null, reasons: [], afterViews: 0 }, "restore")}>
              {busy === "restore" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.undo} className="h-3.5 w-3.5" />}
              Restore {formatINR(standard)}{credited && walletChange(base) > 0 ? ` (${signed(walletChange(base))})` : ""}
            </button>
          ) : null}
          <button type="button" className={`${btnGhost} h-9 flex-1 sm:flex-none`} onClick={onClose} disabled={!!busy}>Cancel</button>
          <button type="submit" disabled={!valid || !reasons.size || !!busy || !changed}
            className={`${btnPrimary} h-9 flex-[2] bg-[#9a3f0b] hover:bg-[#7f330a] disabled:bg-[#e8e3de] disabled:text-[#8a8079] disabled:opacity-100 disabled:shadow-none sm:flex-none`}>
            {busy === "save" ? <Spinner /> : null}
            {valid ? `Set ${formatINR(value)}/1K${fromNow ? " from now" : afterViews ? ` after ${compactViews(afterViews)}` : ""}` : "Set CPM"}
          </button>
        </div>
      </div>
    </form>
  );
}
