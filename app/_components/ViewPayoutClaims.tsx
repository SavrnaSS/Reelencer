"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import { apiFetch } from "@/lib/api/client";
import ViewClaimReview from "./ViewClaimReview";
import type { ViewClaim as Claim, ViewReviewRequest } from "@/lib/viewPayoutReview";
import { formatAmount as money } from "@/lib/money";

type Quote = { claimableINR: number; claimableViews: number; rateINR: number; missingCounts: number; pendingClaimId: string | null; active: boolean };
const ASSESSMENT_LABELS: Record<string, string> = { unreviewed: "Assessment not recorded", organic: "No artificial activity found in review", mixed: "Views adjusted after review", suspected: "Suspected artificial activity", insufficient: "Insufficient evidence" };
const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-[#fdf0d2] text-[#6b4a05]",
  Approved: "bg-[#e3f1df] text-[#1f5131]",
  Rejected: "bg-[#fde4e1] text-[#8e1f1a]",
  "Hard rejected": "bg-[#f6d4cf] text-[#6e130d]",
};
const views = (n: number) => Number(n).toLocaleString("en-IN");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
export default function ViewPayoutClaims({ accountId, admin = false }: { accountId?: string; admin?: boolean }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const request = useRef<Promise<void> | null>(null);
  const actionRunning = useRef(false);
  const generation = useRef(0);
  const url = `/api/view-payout-claims?${admin ? "scope=all" : `accountId=${encodeURIComponent(accountId ?? "")}`}`;
  const load = useCallback(async (force = false) => {
    if (actionRunning.current) return;
    if (request.current) {
      if (!force) return request.current;
      await request.current;
    }
    if (actionRunning.current) return;
    const version = generation.current;
    const task = (async () => { try {
      const response = await apiFetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load claims.");
      if (version !== generation.current) return;
      setClaims(data.claims); setQuote(data.quote); setLoaded(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load claims."); }
    })();
    request.current = task;
    try { await task; } finally { if (request.current === task) request.current = null; }
  }, [url]);
  useVisibleRefresh(load, 10_000);
  useEffect(() => {
    if (admin) return;
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("social-accounts-refreshed", refresh);
    return () => window.removeEventListener("social-accounts-refreshed", refresh);
  }, [admin, load]);
  const act = async (body: { action: "claim"; accountId: string } | ViewReviewRequest) => {
    if (actionRunning.current) return false;
    actionRunning.current = true; generation.current++; setBusy(true); setMessage("");
    try {
      const response = await apiFetch("/api/view-payout-claims", { method: "POST", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update claim.");
      generation.current++;
      if (body.action === "review") setClaims(previous => previous.map(claim => claim.id === body.claimId ? { ...claim, ...data.claim } : claim));
      else if (data.claim?.id) setQuote(previous => previous ? { ...previous, pendingClaimId: data.claim.id } : previous);
      setMessage(body.action === "claim" ? "Claim submitted for review." : body.decision === "Approved" ? `${money(data.claim.approved_amount_inr)} credited after authenticity review.` : "Claim review saved.");
      window.dispatchEvent(new Event("view-payout-claims-updated"));
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update claim."); return false; }
    finally { actionRunning.current = false; setBusy(false); await load(true); }
  };
  const blocked = !quote
    ? null
    : quote.pendingClaimId
      ? "Your last claim is being reviewed. You can claim again once it's decided."
      : !quote.active
        ? "Claims are paused while the account isn't active."
        : Number(quote.claimableINR) <= 0
          ? "No new eligible views yet. Views on approved reels become claimable as they're measured."
          : null;
  const statusPill = quote?.pendingClaimId
    ? { label: "Awaiting review", style: STATUS_STYLE.Pending }
    : quote && Number(quote.claimableINR) > 0 && quote.active
      ? { label: "Ready to claim", style: STATUS_STYLE.Approved }
      : { label: "Nothing to claim", style: "bg-[#eef0ed] text-[#616a64]" };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dce5dc] bg-white" aria-label="View payout claims">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#1a201c]">{admin ? "View earnings claims" : "Claim view earnings"}</h3>
          <p className="mt-1 max-w-[70ch] text-[12.5px] leading-5 text-[#616a64]">
            {admin
              ? "Review view trends and supporting evidence. Exclude artificial views before crediting the worker’s wallet once. Reject allows a corrected claim; hard rejection blocks the covered views permanently."
              : "Claim new measured views on approved reels. The team reviews authenticity and may exclude artificial views. Approval credits eligible earnings to your wallet; withdrawal follows the wallet’s KYC, UPI and minimum-balance rules."}
          </p>
        </div>
        {!admin && quote ? <span className={`self-start whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${statusPill.style}`}>{statusPill.label}</span> : null}
      </div>

      {!admin && quote ? (
        <div className="mx-4 mb-4 grid gap-4 rounded-xl border border-[#e3ece4] bg-[linear-gradient(135deg,#f6faf5,#eef6ef)] p-4 sm:mx-5 sm:mb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-[#3b5a47]">Claimable now</div>
            <div className="mt-1 break-words text-[28px] font-semibold leading-tight tabular-nums text-[#1a201c] sm:text-[32px]">{money(quote.claimableINR)}</div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
              <div className="min-w-0 rounded-lg bg-white/70 px-2.5 py-1.5">
                <dt className="text-[#5d7466]">Eligible views</dt>
                <dd className="font-semibold tabular-nums text-[#1a201c]">{views(quote.claimableViews)}</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white/70 px-2.5 py-1.5">
                <dt className="text-[#5d7466]">Rate</dt>
                <dd className="break-words font-semibold tabular-nums text-[#1a201c]">{money(quote.rateINR)} / 1K</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white/70 px-2.5 py-1.5">
                <dt className="text-[#5d7466]">Claims</dt>
                <dd className="font-semibold tabular-nums text-[#1a201c]">{loaded ? claims.length : "–"}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col gap-1.5 md:w-56">
            <button
              type="button"
              disabled={busy || !quote.active || !!quote.pendingClaimId || Number(quote.claimableINR) <= 0}
              onClick={() => void act({ action: "claim", accountId: accountId! })}
              className="h-11 w-full rounded-xl bg-[#1f4f43] px-4 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-[#183f35] disabled:cursor-not-allowed disabled:bg-[#9fb0a6]"
            >
              {busy ? "Submitting…" : quote.pendingClaimId ? "Awaiting review" : "Claim payout"}
            </button>
            {blocked ? <p className="text-[11.5px] leading-4 text-[#5d7466] md:text-center">{blocked}</p> : null}
          </div>
          {quote.missingCounts > 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-[#ecd8a8] bg-[#fff8e8] px-3 py-2 text-[12px] leading-5 text-[#6b4a05] md:col-span-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d99a06]" aria-hidden="true" />
              {quote.missingCounts === 1
                ? "1 approved reel needs a verified view count before it can be claimed. Update it from a screenshot in the reels list."
                : `${quote.missingCounts} approved reels need verified view counts before they can be claimed. Update them from screenshots in the reels list.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mx-4 mb-3 rounded-lg bg-[#f1f8ef] px-3 py-2 text-[12.5px] font-medium text-[#1f5131] sm:mx-5">
          {message}
        </p>
      ) : null}

      <div className="border-t border-[#eef0ec] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">{admin ? "Claims" : "Your claims"}</h4>
          {loaded && claims.length ? <span className="text-[11.5px] text-[#8a928c]">{plural(claims.length, "claim")}</span> : null}
        </div>
        {!loaded ? (
          <div className="mt-3 space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-[#f1f3f0]" />
            ))}
          </div>
        ) : !claims.length ? (
          <p className="mt-2 rounded-xl border border-dashed border-[#dfe2de] px-3 py-4 text-center text-[12.5px] text-[#7a827c]">
            {admin ? "No claims to review." : "No claims yet. Your first claim appears here once you submit it."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-xl border border-[#ebedea] p-3 sm:p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[16px] font-semibold tabular-nums text-[#1a201c]">{money(claim.status === "Approved" ? claim.approved_amount_inr ?? claim.amount_inr : claim.amount_inr)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[claim.status] ?? "bg-[#eef0ed] text-[#616a64]"}`}>{claim.status}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[#616a64]">
                      {views(claim.views)} claimed views at {money(claim.rate_inr)} / 1K
                      {admin ? ` · ${claim.worker?.display_name || "Worker"} (${claim.worker?.worker_code || claim.worker_id}) · @${claim.account?.handle || "account"}${claim.account?.gig?.title ? ` · ${claim.account.gig.title}` : ""}` : ""}
                    </p>
                  </div>
                  <time className="text-[11.5px] text-[#8a928c]" dateTime={claim.created_at} title={new Date(claim.created_at).toLocaleString()}>
                    {ago(claim.created_at)}
                  </time>
                </div>
                {claim.status !== "Pending" ? <p className="mt-1.5 text-[11.5px] text-[#616a64]">{ASSESSMENT_LABELS[claim.authenticity_review ?? "unreviewed"]}</p> : null}
                {Number(claim.deducted_views) > 0 ? <p className="mt-2 rounded-lg bg-[#fff8e8] px-3 py-2 text-[12px] text-[#6b4a05]">Requested {money(claim.amount_inr)} · {views(Number(claim.deducted_views))} views excluded · {views(Number(claim.approved_views ?? 0))} views approved · Eligible earnings {money(Number(claim.approved_amount_inr ?? 0))}</p> : null}
                {claim.note ? <p className="mt-2 rounded-lg bg-[#fafbf9] px-3 py-2 text-[12px] text-[#3b443e]"><span className="font-semibold">Review: </span>{claim.note}</p> : null}
                {claim.status === "Approved" ? <p className="mt-2 text-[12px] text-[#2e7d4f]">{money(claim.approved_amount_inr ?? claim.amount_inr)} wallet credit recorded. Request withdrawal from Payouts when eligible.</p> : null}
                {claim.view_payout_claim_items.length ? (
                  <details className="group mt-2 text-[12px]">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-[#2b5d4a] hover:bg-[#eef1ed]">
                      <span className="transition group-open:rotate-90" aria-hidden="true">›</span>
                      Reel evidence ({claim.view_payout_claim_items.length})
                    </summary>
                    <ul className="mt-1.5 divide-y divide-[#f0f1ef] rounded-lg border border-[#ebedea]">
                      {claim.view_payout_claim_items.map((item) => (
                        <li key={item.id} className="flex flex-col gap-0.5 px-3 py-2">
                          <a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-[#1a201c] underline-offset-2 hover:underline" title={item.url}>
                            {item.url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                          <span className="shrink-0 tabular-nums text-[#616a64]">
                            {views(item.from_views)} → {views(item.to_views)} · <span className="font-semibold text-[#1a201c]">{money(claim.status === "Approved" ? item.reviewed_amount_inr ?? item.amount_inr : item.amount_inr)}</span> · {item.source}
                          </span>
                          {Number(item.excluded_views) > 0 ? <p className="mt-1 text-[11.5px] text-[#9b6109]">{views(Number(item.excluded_views))} views excluded: {item.deduction_reason}</p> : null}
                          {item.evidence_url ? <a href={item.evidence_url} target="_blank" rel="noreferrer noopener" className="text-[11.5px] text-[#2b5d4a] underline">Supporting review evidence</a> : null}
                          <time dateTime={item.captured_at} className="text-[10.5px] text-[#8a928c]">Measured {new Date(item.captured_at).toLocaleString()}</time>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {admin && claim.status === "Pending" ? (
                  reviewingId === claim.id ? <ViewClaimReview key={claim.id} claim={claim} busy={busy} onCancel={() => setReviewingId(null)} onSubmit={async body => { const ok = await act(body); if (ok) setReviewingId(null); return ok; }} /> :
                  <button type="button" disabled={busy} onClick={() => setReviewingId(claim.id)} className="mt-3 h-10 rounded-lg bg-[#1f4f43] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40">Review authenticity & payout</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
