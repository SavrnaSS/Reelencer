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

export type CpmInput = { rateINR: number | null; reasons: CpmReason[]; note?: string; afterViews: number };
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
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-semibold tabular-nums transition disabled:opacity-50 ${
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
  const [customAfter, setCustomAfter] = useState(() => !!current && !(START_PRESETS as readonly number[]).includes(current.afterViews));
  const [reasons, setReasons] = useState<Set<CpmReason>>(() => new Set((current?.reasons ?? ["low_reel_engagement"]) as CpmReason[]));
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = Number(rate);
  const afterViews = Number(after);
  const validAfter = /^\d+$/.test(after.trim()) && afterViews <= 1_000_000_000;
  const valid = money.test(rate.trim()) && value > 0 && value < standard && validAfter;
  const views = Number.isSafeInteger(post.views) && post.views! >= 0 ? post.views! : 0;
  const base = { mode: terms.mode, baseINR: terms.baseINR, thresholdViews: terms.thresholdViews, rateINR: standard };
  const next = valid ? { ...base, rateINR: value, standardRateINR: standard, cpmAdjusted: true, cpmAfterViews: afterViews } : undefined;
  const standardEarns = Number(cumulativePaise(views, base)) / 100;
  const nowEarns = Number(cumulativePaise(views, terms)) / 100;
  const nextEarns = next ? Number(cumulativePaise(views, next)) / 100 : undefined;
  // Approved views already credited: repriced in the wallet on save (estimate; excluded views aren't known here).
  const credited = post.walletCredit && post.walletCredit.creditedINR > 0 ? post.walletCredit.consumedViews : 0;
  const walletNow = Number(cumulativePaise(credited, terms)) / 100;
  const walletChange = (target: typeof base) => Math.round((Number(cumulativePaise(credited, target)) / 100 - walletNow) * 100) / 100;
  const presets = cpmPresets(standard);
  const changed = !current || value !== current.rateINR || afterViews !== current.afterViews || note.trim() !== (current.note ?? "") || [...reasons].sort().join() !== [...current.reasons].sort().join();

  const submit = async (input: CpmInput, kind: "save" | "restore") => {
    setBusy(kind);
    setError(null);
    const result = await onSave(input);
    setBusy(null);
    if ("error" in result) setError(result.error);
    else onClose();
  };

  return (
    <form
      className="w-full rounded-[12px] border border-[#f0dcc8] bg-[linear-gradient(180deg,#fffaf5,#ffffff)] p-3 sm:p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && reasons.size) void submit({ rateINR: value, reasons: [...reasons], note: note.trim() || undefined, afterViews }, "save");
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#1a201c]">Adjust this reel&apos;s CPM</p>
          <p className="mt-0.5 text-[11.5px] leading-5 text-[#6b746e]">
            Standard rate <b className="font-semibold text-[#1a201c]">{formatINR(standard)} / 1K views</b>
            {terms.mode !== "cpm" ? ` past ${terms.thresholdViews.toLocaleString("en-IN")} views (the plan's ${formatINR(terms.baseINR)} base stays)` : ""}. Saving reprices approved earnings already in the creator&apos;s wallet too.
          </p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6b746e] hover:bg-[#f1f3f0]" aria-label="Close">
          <Icon d={ICONS.x} className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <label htmlFor={`${id}-rate`} className="text-[11.5px] font-semibold text-[#3b443e]">New CPM (₹ per 1K views)</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="relative w-28 shrink-0">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-[#7a827c]">₹</span>
              <input id={`${id}-rate`} inputMode="decimal" autoFocus value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(presets[1] ?? "")} className={`${fieldClass} h-9 w-full pl-6 tabular-nums`} aria-invalid={!!rate && !(money.test(rate.trim()) && value > 0 && value < standard)} />
            </div>
            <div className="flex min-w-0 flex-wrap gap-1">
              {presets.map((preset) => (
                <button key={preset} type="button" onClick={() => setRate(String(preset))} className={`h-7 rounded-full border px-2 text-[11.5px] font-semibold tabular-nums ${value === preset ? "border-[#9a3f0b] bg-[#9a3f0b] text-white" : "border-[#e6d6c6] bg-white text-[#6b3a14] hover:bg-[#fff1e4]"}`}>
                  ₹{preset}
                </button>
              ))}
            </div>
          </div>
          {rate && !(money.test(rate.trim()) && value > 0 && value < standard) ? <p className="mt-1 text-[11.5px] text-[#b42318]">Enter an amount above ₹0 and below {formatINR(standard)}, with at most 2 decimals.</p> : null}

          {/* Where the lower rate starts */}
          <p className="mt-3 text-[11.5px] font-semibold text-[#3b443e]">Lower CPM starts</p>
          <div className="mt-1 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Lower CPM starts">
            {START_PRESETS.map((start) => (
              <button key={start} type="button" role="radio" aria-checked={!customAfter && afterViews === start} onClick={() => { setCustomAfter(false); setAfter(String(start)); }}
                className={`h-8 rounded-lg border px-2.5 text-[12px] font-semibold tabular-nums transition ${!customAfter && afterViews === start ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e] hover:bg-[#f5f6f4]"}`}>
                {start === 0 ? "From the first view" : `After ${compactViews(start)} views`}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={customAfter} onClick={() => setCustomAfter(true)}
              className={`h-8 rounded-lg border px-2.5 text-[12px] font-semibold transition ${customAfter ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e] hover:bg-[#f5f6f4]"}`}>
              Custom
            </button>
            {customAfter ? (
              <input inputMode="numeric" value={after} onChange={(e) => setAfter(e.target.value.replace(/\D/g, ""))} aria-label="Lower CPM starts after this many views" placeholder="e.g. 7500" className={`${fieldClass} h-8 w-28 tabular-nums`} aria-invalid={!validAfter} />
            ) : null}
          </div>
          <CpmSplitBar views={views} afterViews={validAfter ? afterViews : 0} standardRateINR={standard} rateINR={valid ? value : terms.rateINR < standard ? terms.rateINR : standard} />

          {/* What it changes */}
          <div className="mt-2.5 grid grid-cols-2 overflow-hidden rounded-[10px] bg-white text-center ring-1 ring-[#efe4d8] sm:grid-cols-4">
            <div className="px-2 py-2">
              <div className="text-[10.5px] text-[#7a827c]">Full rate</div>
              <div className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{formatINR(standardEarns)}</div>
            </div>
            <div className="border-l border-[#f3ebe2] px-2 py-2">
              <div className="text-[10.5px] text-[#7a827c]">{current ? "Now" : "Adjusted"}</div>
              <div className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{current ? formatINR(nowEarns) : nextEarns === undefined ? "–" : formatINR(nextEarns)}</div>
            </div>
            <div className="border-t border-[#f3ebe2] px-2 py-2 sm:border-l sm:border-t-0">
              <div className="text-[10.5px] text-[#7a827c]">{current ? "After saving" : "Reel change"}</div>
              <div className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-[#b54708]">{nextEarns === undefined ? "–" : current ? formatINR(nextEarns) : signed(nextEarns - standardEarns)}</div>
            </div>
            <div className="border-l border-t border-[#f3ebe2] bg-[#fffaf5] px-2 py-2 sm:border-t-0">
              <div className="text-[10.5px] text-[#7a827c]">Wallet</div>
              <div className={`mt-0.5 text-[13.5px] font-semibold tabular-nums ${next && walletChange(next) < 0 ? "text-[#b42318]" : "text-[#1f5131]"}`}>{next ? signed(walletChange(next)) : "–"}</div>
            </div>
          </div>
          <p className="mt-1 text-[10.5px] leading-4 text-[#8a928c]">
            {at(views)} views · {credited ? `${credited.toLocaleString("en-IN")} views already credited are repriced in the wallet (about). Money already withdrawn can't be taken back.` : "Nothing credited yet: the new rate applies when the reel is approved."}
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-[11.5px] font-semibold text-[#3b443e]">What&apos;s detected? <span className="font-normal text-[#7a827c]">(the creator sees these as signals from their own profile)</span></legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CPM_REASON_IDS.map((reason) => {
              const on = reasons.has(reason);
              return (
                <label key={reason} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition ${on ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e] hover:bg-[#f5f6f4]"}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => setReasons((now) => { const nextSet = new Set(now); if (nextSet.has(reason)) nextSet.delete(reason); else nextSet.add(reason); return nextSet; })} />
                  {on ? <Icon d={ICONS.check} className="h-3 w-3" /> : null}
                  {CPM_REASONS[reason].admin}
                </label>
              );
            })}
          </div>
          {!reasons.size ? <p className="mt-1 text-[11.5px] text-[#b42318]">Pick at least one.</p> : null}
          <label htmlFor={`${id}-note`} className="mt-2.5 block text-[11.5px] font-semibold text-[#3b443e]">Note to the creator <span className="font-normal text-[#7a827c]">(optional)</span></label>
          <input id={`${id}-note`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Most views came without likes or comments" className={`${fieldClass} mt-1 h-9 w-full`} />
        </fieldset>
      </div>

      {error ? <p role="alert" className="mt-2.5 rounded-[8px] bg-[#fdf0ef] px-2.5 py-1.5 text-[12px] text-[#b42318]">{error}</p> : null}

      <div className="mt-3 flex flex-col-reverse gap-1.5 sm:flex-row sm:items-center sm:justify-end">
        {current ? (
          <button type="button" className={`${btnGhost} h-9 sm:mr-auto`} disabled={!!busy} onClick={() => void submit({ rateINR: null, reasons: [], afterViews: 0 }, "restore")} title={credited ? `Wallet about ${signed(walletChange(base))}` : undefined}>
            {busy === "restore" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.undo} className="h-3.5 w-3.5" />}
            Restore {formatINR(standard)}{credited && walletChange(base) > 0 ? ` (${signed(walletChange(base))})` : ""}
          </button>
        ) : null}
        <button type="button" className={`${btnGhost} h-9`} onClick={onClose} disabled={!!busy}>Cancel</button>
        <button type="submit" className={`${btnPrimary} h-9 bg-[#9a3f0b] hover:bg-[#7f330a]`} disabled={!valid || !reasons.size || !!busy || !changed}>
          {busy === "save" ? <Spinner /> : null}
          {valid ? `Set ${formatINR(value)} / 1K${afterViews ? ` after ${compactViews(afterViews)}` : ""}` : "Set CPM"}
        </button>
      </div>
    </form>
  );
}

const at = (views: number) => `At ${views.toLocaleString("en-IN")}`;
