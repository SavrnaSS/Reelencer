"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { adjustedViewAmount, type ViewAdjustment, type ViewClaim, type ViewReviewEvidence, type ViewReviewRequest } from "@/lib/viewPayoutReview";

const money = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (n: number) => Number(n).toLocaleString("en-IN");
const date = (s: string) => new Date(s).toLocaleString();
type Draft = { views: string; reason: string };

export default function ViewClaimReview({ claim, busy, onSubmit, onCancel }: { claim: ViewClaim; busy: boolean; onSubmit: (body: ViewReviewRequest) => Promise<boolean>; onCancel: () => void }) {
  const [decision, setDecision] = useState<ViewReviewRequest["decision"]>("Approved");
  const [assessment, setAssessment] = useState<ViewReviewRequest["assessment"] | "">("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [evidence, setEvidence] = useState<ViewReviewEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(`/api/view-payout-claims?reviewClaimId=${encodeURIComponent(claim.id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load review evidence.");
        if (!controller.signal.aborted) { setEvidence(data.evidence); setError(""); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load evidence."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [claim.id, reload]);
  const adjustments: ViewAdjustment[] = [];
  let payable = 0, excluded = 0, invalid = "";
  for (const item of claim.view_payout_claim_items) {
    const draft = drafts[item.id];
    const n = decision === "Approved" ? Number(draft?.views || 0) : 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > Number(item.to_views) - Number(item.from_views)) { invalid = "Excluded views must be whole numbers within the claimed range."; continue; }
    excluded += n;
    payable += adjustedViewAmount(item, Number(claim.rate_inr), n);
    if (n > 0) {
      if (!draft?.reason.trim()) invalid = "Enter a supporting reason for every deduction.";
      adjustments.push({ itemId: item.id, excludedViews: n, reason: draft?.reason.trim() ?? "" });
    }
  }
  if (decision === "Approved") {
    if ((excluded > 0 && assessment !== "mixed") || (excluded === 0 && assessment === "mixed")) invalid = "Use the mixed assessment when excluding views; otherwise choose no artificial activity found.";
    if (payable <= 0) invalid = "No payable amount remains. Choose hard rejection to permanently exclude the covered views.";
    if (loading || error || evidence.length !== claim.view_payout_claim_items.length) invalid = "Load the saved evidence before approving.";
    if (evidence.some(item => item.currentStatus !== "approved" || item.currentViews === undefined || item.currentViews < Number(claim.view_payout_claim_items.find(p => p.id === item.itemId)?.to_views))) invalid = "The current reel evidence changed. Refresh it or reject the claim for correction.";
  }
  const patch = (id: string, change: Partial<Draft>) => setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] ?? { views: "", reason: "" }), ...change } }));
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[#dce5dc] bg-[#fafcf9] p-3 sm:p-4" aria-label="Authenticity review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-[13px] font-semibold text-[#1a201c]">View authenticity review</h5>
        <button type="button" disabled={loading || busy} onClick={() => { setLoading(true); setReload(n => n + 1); }} className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-[#2b5d4a] disabled:opacity-40">Reload saved evidence</button>
      </div>
      <p className="text-[12px] leading-5 text-[#616a64]">Public counts cannot identify individual bots. Check the signals and creator insights, then record your assessment. Excluded views stay excluded from future claims; Instagram’s raw counts remain visible.</p>
      {loading ? <p role="status" className="text-[12px] text-[#616a64]">Loading measured view history…</p> : null}
      {error ? <p role="alert" className="text-[12px] text-[#b42318]">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] font-semibold text-[#3b443e]">Decision
          <select disabled={busy} value={decision} onChange={e => { setDecision(e.target.value as typeof decision); setAssessment(""); }} className="mt-1 block h-10 w-full rounded-lg border border-[#d9ddd8] bg-white px-2 font-normal">
            <option value="Approved">Approve eligible views</option><option value="Rejected">Reject for correction</option><option value="Hard rejected">Hard reject covered views</option>
          </select>
        </label>
        <label className="text-[12px] font-semibold text-[#3b443e]">Authenticity assessment
          <select disabled={busy} value={assessment} onChange={e => setAssessment(e.target.value as typeof assessment)} className="mt-1 block h-10 w-full rounded-lg border border-[#d9ddd8] bg-white px-2 font-normal">
            <option value="">Choose an assessment</option>
            {decision === "Approved" ? <><option value="organic">No artificial activity found in review</option><option value="mixed">Some views excluded after review</option></> : <><option value="suspected">Suspected artificial activity</option><option value="insufficient">Insufficient evidence</option></>}
          </select>
        </label>
      </div>
      {claim.view_payout_claim_items.map(item => {
        const signal = evidence.find(e => e.itemId === item.id);
        const points = signal?.observations ?? [];
        const values = points.map(p => Number(p.views));
        const min = Math.min(...values), span = Math.max(...values) - min || 1;
        const start = points.length ? Date.parse(points[0].captured_at) : 0;
        const duration = points.length ? Date.parse(points.at(-1)!.captured_at) - start || 1 : 1;
        const path = points.map((p, i) => `${i ? "L" : "M"}${8 + (Date.parse(p.captured_at) - start) / duration * 84},${68 - (Number(p.views) - min) / span * 56}`).join(" ");
        const draft = drafts[item.id];
        return (
          <div key={item.id} className="space-y-2 rounded-lg border border-[#e3e5e1] bg-white p-3">
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[12px] font-semibold text-[#2b5d4a] underline">{item.url}</a>
            <dl className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
              <div><dt className="text-[#7a827c]">Claimed new views</dt><dd className="font-semibold">{count(Number(item.to_views) - Number(item.from_views))}</dd></div>
              <div><dt className="text-[#7a827c]">Frozen total</dt><dd className="font-semibold">{count(item.to_views)}</dd></div>
              <div><dt className="text-[#7a827c]">Current total</dt><dd className="font-semibold">{signal?.currentViews === undefined ? "Unavailable" : count(signal.currentViews)}</dd></div>
              <div><dt className="text-[#7a827c]">Likes + comments ÷ views</dt><dd className="font-semibold">{signal?.interactionRate === undefined ? "Unavailable" : `${signal.interactionRate.toFixed(2)}%`}</dd></div>
            </dl>
            <p className="text-[11px] text-[#7a827c]">Claim evidence: {date(item.captured_at)} · {item.source}{signal?.capturedAt ? ` · Latest views: ${date(signal.capturedAt)}` : ""}</p>
            {points.length > 1 ? <figure className="rounded-lg bg-[#f7faf5] px-2 py-1"><svg viewBox="0 0 100 80" preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label="Measured view counts over time"><path d={path} fill="none" stroke="#2e7d4f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg><figcaption className="flex justify-between text-[10px] text-[#7a827c]"><span>{date(points[0].captured_at)}</span><span>{count(values.at(-1)!)} views · {points.length} observations</span></figcaption></figure> : null}
            {signal?.flags.length ? <ul className="list-disc space-y-1 rounded-lg bg-[#fff8e8] py-2 pl-6 pr-2 text-[11.5px] leading-4 text-[#6b4a05]">{signal.flags.map(flag => <li key={flag}>{flag}</li>)}</ul> : null}
            {decision === "Approved" ? (
              <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <label className="text-[11.5px] font-semibold text-[#3b443e]">Views to exclude
                  <input disabled={busy} type="number" inputMode="numeric" min="0" max={Number(item.to_views) - Number(item.from_views)} step="1" value={draft?.views ?? ""} placeholder="0" onChange={e => { patch(item.id, { views: e.target.value }); if (Number(e.target.value) > 0) setAssessment("mixed"); }} className="mt-1 h-10 w-full rounded-lg border border-[#d9ddd8] px-2 font-normal" />
                </label>
                <label className="text-[11.5px] font-semibold text-[#3b443e]">Evidence and deduction reason
                  <input disabled={busy} value={draft?.reason ?? ""} maxLength={1000} onChange={e => patch(item.id, { reason: e.target.value })} placeholder="Explain which evidence supports excluding these views" className="mt-1 h-10 w-full rounded-lg border border-[#d9ddd8] px-2 font-normal" />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
      <label className="block text-[12px] font-semibold text-[#3b443e]">Review summary (required)
        <textarea disabled={busy} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Describe the evidence checked and why you chose this decision" className="mt-1 h-20 w-full rounded-lg border border-[#d9ddd8] px-3 py-2 font-normal" />
      </label>
      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-[#eef6ef] p-3 text-[11.5px]">
        <div><dt className="text-[#5d7466]">Requested</dt><dd className="font-semibold">{money(claim.amount_inr)}</dd></div>
        <div><dt className="text-[#5d7466]">Excluded views</dt><dd className="font-semibold">{count(decision === "Hard rejected" ? claim.views : excluded)}</dd></div>
        <div><dt className="text-[#5d7466]">Wallet credit</dt><dd className="font-semibold">{money(decision === "Approved" ? payable : 0)}</dd></div>
      </dl>
      {decision === "Hard rejected" ? <p className="text-[12px] text-[#b42318]">Hard rejection permanently excludes all views covered by this claim.</p> : decision === "Rejected" ? <p className="text-[12px] text-[#616a64]">Rejection releases these views so the creator can submit a corrected claim.</p> : null}
      {invalid ? <p role="status" className="text-[12px] text-[#9b6109]">{invalid}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" disabled={busy} onClick={onCancel} className="h-10 rounded-lg border border-[#d9ddd8] bg-white px-3 text-[12.5px] font-semibold disabled:opacity-40">Cancel</button>
        <button type="button" disabled={busy || !!invalid || !assessment || !note.trim()} onClick={() => { if (assessment) void onSubmit({ action: "review", claimId: claim.id, decision, assessment, note: note.trim(), adjustments: decision === "Approved" ? adjustments : [] }); }} className="h-10 rounded-lg bg-[#1f4f43] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : decision === "Approved" ? `Approve & credit ${money(payable)}` : decision === "Hard rejected" ? "Confirm hard rejection" : "Confirm rejection"}</button>
      </div>
    </div>
  );
}
