"use client";

import { useId, useState } from "react";
import { formatMoney } from "@/lib/money";
import { payoutEarningTitle, payoutHistoryDate, payoutHistoryNotes, payoutHistoryStatus, payoutHistoryTotal, type PayoutHistoryBatch } from "@/lib/payoutHistory";
import { safePayoutReelUrl } from "@/lib/payoutHistoryMetadata";

const PAGE_SIZE = 6;
const tones = {
  success: "bg-[#eaf4e8] text-[#28613c] ring-[#d7e8d5]",
  info: "bg-[#edf4fd] text-[#245e9c] ring-[#d8e6f7]",
  danger: "bg-[#fff0ed] text-[#a93a30] ring-[#f2d7d2]",
  pending: "bg-[#fff7e2] text-[#8a5a00] ring-[#efdfb6]",
  neutral: "bg-[#f0f2ee] text-[#5f6f65] ring-[#e0e5dc]",
};

export default function PayoutHistoryCard({ batch }: { batch: PayoutHistoryBatch }) {
  const headingId = useId();
  const listId = useId();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(batch.items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const offset = currentPage * PAGE_SIZE;
  const visibleItems = batch.items.slice(offset, offset + PAGE_SIZE);
  const total = payoutHistoryTotal(batch.items);
  const status = payoutHistoryStatus(batch.status);
  const notes = payoutHistoryNotes(batch.notes);
  const requestDate = payoutHistoryDate(batch.createdAt);
  const dateLabel = status.tone === "success" && batch.paidAt ? `Paid ${payoutHistoryDate(batch.paidAt, true)}` : `Requested ${payoutHistoryDate(batch.createdAt, true)}`;

  return (
    <article aria-labelledby={headingId} className="min-w-0 overflow-hidden rounded-xl border border-[#e1e8de] bg-white">
      <div className="p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h3 id={headingId} className="text-[12px] font-medium text-[#68766c]">Withdrawal · {requestDate}</h3>
            <div className="mt-1 break-all text-[24px] font-semibold leading-tight tracking-[-0.025em] tabular-nums text-[#21382c]">{total === undefined ? "Amount unavailable" : formatMoney(total)}</div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${tones[status.tone]}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{status.label}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[#6f7d74]">
          <span className="min-w-0 break-all">{batch.payTo ? `To ${batch.payTo}` : batch.method}</span><span aria-hidden="true">·</span>
          <span>{batch.origin === "auto" ? "Automatic withdrawal" : "Manual withdrawal"}</span>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[#52665a]">{status.detail}</p>
        <p className="mt-0.5 text-[10.5px] leading-4 text-[#7e8a81]">{dateLabel}</p>
      </div>

      {(batch.items.length > 0 || notes.length > 0 || batch.paymentReference) && (
        <details className="group border-t border-[#e9eee5]">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#f8faf6] px-3.5 py-2.5 text-[12px] font-semibold text-[#41695b] transition-colors hover:bg-[#f1f6ed] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#41695b] sm:px-4 [&::-webkit-details-marker]:hidden">
            <span>View breakdown <span className="ml-1 font-normal text-[#78857b]">{batch.items.length} {batch.items.length === 1 ? "earning" : "earnings"}</span></span>
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="border-t border-[#e9eee5]">
            {batch.items.length > 0 && (
              <>
                <div className="flex justify-between gap-3 px-3.5 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[#899389] sm:px-4" aria-hidden="true"><span>Included earnings</span><span>Amount</span></div>
                <ol id={listId} start={offset + 1} aria-label="Earnings in this withdrawal" className="divide-y divide-[#f0f3ed] px-3.5 sm:px-4">
                  {visibleItems.map((item, index) => {
                    const reelUrl = safePayoutReelUrl(item.reelUrl);
                    const handle = item.handle?.trim().replace(/^@+/, "");
                    return (
                      <li key={item.id} className="flex items-start gap-2.5 py-3">
                        <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#f1f5ed] text-[10px] font-medium tabular-nums text-[#80917f]">{offset + index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 break-words text-[12px] font-medium leading-5 text-[#34483b]">{payoutEarningTitle(item)}</p>
                          {(handle || reelUrl) && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] leading-4">
                            {handle ? <span className="max-w-full truncate text-[#7b887e]">@{handle}</span> : null}
                            {reelUrl ? <a href={reelUrl} target="_blank" rel="noopener noreferrer" aria-label={`View reel for earning ${offset + index + 1}`} className="inline-flex min-h-6 items-center gap-0.5 rounded-sm font-medium text-[#41695b] underline decoration-[#c7d7c8] underline-offset-2 hover:text-[#233f2d] focus-visible:outline-2 focus-visible:outline-[#41695b]">View reel <span aria-hidden="true">↗</span></a> : null}
                          </div>}
                          {item.reason ? <p className="mt-1 break-words text-[11px] leading-4 text-[#9d5645]">{item.reason}</p> : null}
                        </div>
                        <span className="max-w-[45%] shrink-0 break-all text-right text-[12px] font-semibold leading-5 tabular-nums text-[#34483b]">{Number.isFinite(item.amountINR) && item.amountINR >= 0 ? formatMoney(item.amountINR) : "—"}</span>
                      </li>
                    );
                  })}
                </ol>
                {pages > 1 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf1e8] bg-[#fbfcf9] px-3.5 py-2 sm:px-4">
                    <p role="status" aria-live="polite" className="text-[10.5px] tabular-nums text-[#7b887e]">{offset + 1}–{Math.min(offset + PAGE_SIZE, batch.items.length)} of {batch.items.length} earnings</p>
                    <div className="flex gap-1" role="group" aria-label="Earnings pages">
                      <button type="button" aria-controls={listId} aria-label="Previous earnings" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[#dfe7d9] bg-white px-2 text-[12px] font-semibold text-[#41695b] hover:bg-[#f0f5eb] focus-visible:outline-2 focus-visible:outline-[#41695b] disabled:cursor-default disabled:opacity-35">←</button>
                      <button type="button" aria-controls={listId} aria-label="Next earnings" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[#dfe7d9] bg-white px-2 text-[12px] font-semibold text-[#41695b] hover:bg-[#f0f5eb] focus-visible:outline-2 focus-visible:outline-[#41695b] disabled:cursor-default disabled:opacity-35">→</button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e8eee1] bg-[#f4f8ef] px-3.5 py-2.5 text-[12px] font-semibold text-[#416044] sm:px-4"><span>Withdrawal total</span><span className="tabular-nums">{total === undefined ? "Unavailable" : formatMoney(total)}</span></div>
              </>
            )}
            {(notes.length > 0 || batch.paymentReference || batch.periodStart !== batch.periodEnd) ? (
              <div className="space-y-1.5 border-t border-[#e8eee1] px-3.5 py-3 text-[11px] leading-5 text-[#748172] sm:px-4">
                {batch.periodStart !== batch.periodEnd ? <p>Earnings period: {payoutHistoryDate(batch.periodStart)} – {payoutHistoryDate(batch.periodEnd)}</p> : null}
                {batch.paymentReference ? <p className="break-words">Payment reference: <span className="font-medium text-[#4a5f4e]">{batch.paymentReference}</span></p> : null}
                {notes.map((note, index) => <p key={index} className="break-words">{note}</p>)}
              </div>
            ) : null}
          </div>
        </details>
      )}
    </article>
  );
}
