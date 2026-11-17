"use client";

import { useEffect, useRef, useState } from "react";
import { compactViews, formatINR, payoutBasisPreview, shortPlan, type PayoutTerms } from "@/lib/payoutPlans";
import type { SocialPost } from "@/lib/socialAnalytics";
import { ICONS, Icon, Spinner, btnGhost, fieldClass, formatDate } from "./adminUi";

// Admin: move one reel off the creator's base-pay plan onto the gig's plain CPM from its first view, or back.
// The database rewrites the reel's credited intervals and reprices the wallet
// (202611170001_reel_payout_basis_switch.sql); money already withdrawn can't be taken back.

export type PayoutBasisWalletResult = { walletChangeINR: number; unrecoveredINR: number; clearedCpmINR?: number };
type SwitchResult = { ok: true; wallet?: PayoutBasisWalletResult } | { error: string };

const signed = (amount: number) => `${amount < 0 ? "−" : amount > 0 ? "+" : ""}${formatINR(Math.abs(amount))}`;
const toneOf = (amount: number) => (amount < 0 ? "text-[#b42318]" : amount > 0 ? "text-[#1f5131]" : "text-[#1a201c]");

/** What the server says the switch did, in one sentence. */
function resultText(basis: "cpm" | "plan", wallet: PayoutBasisWalletResult | undefined) {
  const change = wallet?.walletChangeINR ?? 0;
  return [
    basis === "cpm" ? "Switched to plain CPM." : "Back on the base-pay plan.",
    change ? `Wallet ${change > 0 ? "credited" : "reduced by"} ${formatINR(Math.abs(change))}.` : "The wallet didn't change.",
    wallet && wallet.unrecoveredINR > 0 ? `${formatINR(wallet.unrecoveredINR)} was already withdrawn and couldn't be taken back.` : "",
    wallet?.clearedCpmINR ? `The lowered CPM (${formatINR(wallet.clearedCpmINR)}/1K) was cleared.` : "",
  ].filter(Boolean).join(" ");
}

export default function ReelPayBasis({ post, terms, gigRate, onSwitch }: {
  post: SocialPost;
  terms: PayoutTerms;
  gigRate: number;
  onSwitch: (basis: "cpm" | "plan", reason?: string) => Promise<SwitchResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; warn: boolean } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // Focus the confirm button (not the reason field, which would pop the keyboard on phones).
  useEffect(() => { if (confirming) confirmRef.current?.focus({ preventScroll: false }); }, [confirming]);

  const preview = payoutBasisPreview(post, terms, gigRate);
  if (!preview) return null;

  const onCpm = preview.to === "plan";
  const views = Number.isSafeInteger(post.views) && post.views! >= 0 ? post.views! : 0;
  const delta = Math.round((preview.afterINR - preview.nowINR) * 100) / 100;
  const credited = post.walletCredit?.creditedINR ?? 0;

  const open = () => { if (!busy) { setConfirming(true); setError(null); setDone(null); } };
  const back = () => { if (busy) return; setConfirming(false); setError(null); requestAnimationFrame(() => openRef.current?.focus()); };
  const submit = async () => {
    if (busy) return;
    const basis = preview.to;
    setBusy(true);
    setError(null);
    const result = await onSwitch(basis, reason.trim() || undefined);
    if (!mounted.current) return;
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setConfirming(false);
    setReason("");
    setDone({ text: resultText(basis, result.wallet), warn: (result.wallet?.unrecoveredINR ?? 0) > 0 });
  };

  const card = (active: boolean, title: string, body: string, tag: string, icon: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={busy}
      onClick={active ? undefined : open}
      className={`group relative flex min-w-0 items-start gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f2b24]/50 disabled:opacity-60 ${
        active ? "cursor-default bg-white ring-2 ring-[#1f2b24]" : confirming ? "bg-[#fffaf0] ring-2 ring-[#e9b949]" : "bg-white/70 ring-1 ring-[#e3e5e1] hover:bg-white hover:ring-[#9aa29c]"
      }`}
    >
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1 transition ${active ? "bg-[#1f2b24] ring-[#1f2b24]" : "ring-[#c9cfc9] group-hover:ring-[#6b746e]"}`} aria-hidden="true">
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="min-w-0 truncate text-[13px] font-semibold text-[#1a201c]">{title}</span>
          <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-[999px] px-1.5 py-px text-[10px] font-semibold ${active ? "bg-[#1f2b24] text-white" : "bg-[#f1f3f0] text-[#4b544e] group-hover:bg-[#1f2b24] group-hover:text-white"}`}>
            {active ? null : <Icon d={icon} className="h-2.5 w-2.5" />}
            {tag}
          </span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-4 tabular-nums text-[#5b645e]">{body}</span>
      </span>
    </button>
  );

  const tiles = [
    { label: `At ${compactViews(views)} views now`, value: formatINR(preview.nowINR), sub: onCpm ? "plain CPM" : "on the plan", tone: "text-[#1a201c]" },
    { label: onCpm ? "Back on the plan" : "On plain CPM", value: formatINR(preview.afterINR), sub: delta === 0 ? "same today" : `${signed(delta)} on this reel`, tone: toneOf(delta) },
    { label: "Wallet now", value: preview.walletChangeINR ? `≈ ${signed(preview.walletChangeINR)}` : formatINR(0), sub: credited ? `${formatINR(credited)} credited` : terms.started ? "nothing credited" : "nothing credited yet", tone: toneOf(preview.walletChangeINR) },
  ];

  return (
    <section className="border-t border-[#f3ece4] bg-[#fbfbfa] px-3 py-3 sm:px-4" aria-label="Pay basis for this reel" aria-busy={busy}>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
        <span className="text-[13px] font-semibold text-[#1a201c]">Pay basis</span>
        <span className="text-[11.5px] leading-4 text-[#8a928c]">
          {onCpm
            ? `Switched to plain CPM${post.payoutBasis?.at ? ` on ${formatDate(post.payoutBasis.at)}` : ""}. The creator's plan doesn't apply to this reel.`
            : "This reel earns under the creator's base-pay plan. Pay it per 1,000 views from the first view instead."}
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How this reel is paid">
        {card(!onCpm, preview.plan.planName ? `Plan · ${preview.plan.planName}` : "Base-pay plan", shortPlan(preview.plan), onCpm ? "Restore" : "Now", ICONS.undo)}
        {card(onCpm, "Plain CPM", `${formatINR(gigRate)} per 1K views from view 1, no base`, onCpm ? "Now" : "Switch", ICONS.refresh)}
      </div>

      {/* Phones: one row per figure. Wider: three tiles. */}
      <dl className="mt-2 grid grid-cols-1 gap-px overflow-hidden rounded-[10px] bg-[#e9ebe7] ring-1 ring-[#e9ebe7] sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex min-w-0 items-center justify-between gap-3 bg-white px-3 py-2 sm:block sm:px-2.5">
            <div className="min-w-0">
              <dt className="truncate text-[11px] text-[#7a827c] sm:text-[10.5px]">{tile.label}</dt>
              <div className="truncate text-[10.5px] text-[#8a928c] sm:hidden">{tile.sub}</div>
            </div>
            <dd className={`shrink-0 text-[15px] font-semibold tabular-nums sm:text-[14px] ${tile.tone}`}>{tile.value}</dd>
            <div className="hidden truncate text-[10.5px] text-[#8a928c] sm:block">{tile.sub}</div>
          </div>
        ))}
      </dl>

      {preview.clearsCpmINR ? (
        <p className="mt-2 text-[11.5px] leading-4 text-[#9a3f0b]">
          The lowered CPM ({formatINR(preview.clearsCpmINR)}/1K) isn&apos;t below the new rate of {formatINR(preview.target.standardRateINR ?? preview.target.rateINR)}, so switching clears it.
        </p>
      ) : post.cpmAdjustment ? (
        <p className="mt-2 text-[11.5px] leading-4 text-[#6b746e]">The lowered CPM ({formatINR(post.cpmAdjustment.rateINR)}/1K) stays on the reel after switching.</p>
      ) : null}

      {confirming ? (
        <div
          className="mt-2.5 rounded-[12px] bg-[#fffaf0] p-2.5 ring-1 ring-[#f3dcae]"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); back(); } }}
        >
          <p className="flex items-start gap-1.5 text-[12px] leading-4 text-[#6b4a00]">
            <Icon d={ICONS.alert} className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {onCpm
                ? `Every view of this reel goes back to the plan, ${formatINR(preview.plan.baseINR)} base included.`
                : `Every view of this reel is repriced at ${formatINR(gigRate)}/1K from view 1 and the ${formatINR(preview.plan.baseINR)} base is dropped.`}
              {preview.walletChangeINR ? ` The wallet ${preview.walletChangeINR > 0 ? "gains" : "loses"} about ${formatINR(Math.abs(preview.walletChangeINR))}.` : " The wallet doesn't change."}
              {preview.walletChangeINR < 0 ? " Money already withdrawn can't be taken back." : ""}
            </span>
          </p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row">
            <input value={reason} maxLength={300} disabled={busy} onChange={(e) => setReason(e.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
              placeholder="Reason for the record (optional, not shown to the creator)" aria-label="Reason for switching pay basis" className={`${fieldClass} h-10 min-w-0 flex-1 md:h-9`} />
            <div className="grid grid-cols-[1fr_2fr] gap-1.5 md:flex">
              <button type="button" className={`${btnGhost} h-10 md:h-9`} disabled={busy} onClick={back}>Back</button>
              <button ref={confirmRef} type="button" disabled={busy} onClick={() => void submit()}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#1f2b24] px-3 text-[12.5px] font-semibold text-white transition hover:bg-[#2c3b32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f2b24]/40 focus-visible:ring-offset-2 disabled:opacity-60 md:h-9">
                {busy ? <Spinner /> : null}
                {busy ? "Repricing…" : onCpm ? "Restore plan" : "Switch to CPM"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className={`min-w-0 text-[11.5px] leading-4 ${done ? (done.warn ? "text-[#6b4a00]" : "text-[#1f5131]") : "text-transparent"}`}>
            {done ? (
              <span className="inline-flex items-start gap-1">
                <Icon d={done.warn ? ICONS.alert : ICONS.check} className="mt-px h-3.5 w-3.5 shrink-0" />
                {done.text}
              </span>
            ) : null}
          </p>
          <button ref={openRef} type="button" onClick={open} disabled={busy}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12px] font-semibold text-[#1f2b24] ring-1 ring-[#1f2b24]/70 transition hover:bg-[#1f2b24] hover:text-white focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 sm:h-8 sm:w-auto sm:px-2.5">
            <Icon d={onCpm ? ICONS.undo : ICONS.refresh} className="h-3.5 w-3.5" />
            {onCpm ? `Restore base-pay plan (${formatINR(preview.plan.baseINR)} base)` : `Pay at ${formatINR(gigRate)}/1K from first view`}
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-[8px] bg-[#fdf0ef] px-2.5 py-1.5 text-[12px] leading-4 text-[#b42318]">
          <Icon d={ICONS.alert} className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
