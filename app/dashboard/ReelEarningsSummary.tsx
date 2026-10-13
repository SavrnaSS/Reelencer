"use client";

import Link from "next/link";
import type { AccountEarningsSummary } from "@/lib/creatorEarnings";
import { formatAmount } from "@/lib/money";
import { Icon, Skeleton } from "./dashboardUi";

export default function ReelEarningsSummary({ summary, loading = false, error, onOpenAccounts }: {
  summary: AccountEarningsSummary | null;
  loading?: boolean;
  error?: string;
  onOpenAccounts?: () => void;
}) {
  if (!loading && !error && !summary?.accountCount) return null;
  const linkClass = "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#e8f2e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40";
  return (
    <section aria-label="Reel earnings summary" className="min-w-0 overflow-hidden rounded-2xl border border-[#cfe3d4] bg-[#f4f9f2]">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#1a201c]">Reel earnings <span className="ml-1 text-[11.5px] font-medium text-[#5d7466]">Estimate</span></h2>
          <p className="mt-1 text-[12px] leading-5 text-[#5d7466]">From your linked accounts at each gig’s listed rate.</p>
        </div>
        {onOpenAccounts ? (
          <button type="button" onClick={onOpenAccounts} className={linkClass}>View accounts <Icon.ChevronRight className="h-3.5 w-3.5" /></button>
        ) : (
          <Link href="/dashboard?section=accounts" className={linkClass}>View accounts <Icon.ChevronRight className="h-3.5 w-3.5" /></Link>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-3 p-4 min-[380px]:grid-cols-2 sm:p-5" aria-live="polite" aria-busy={loading}>
        {[
          { label: "Approved earnings", amount: summary?.approved, count: summary?.approvedReels, detail: "approved reels", tone: "text-[#1f5131]" },
          { label: "Pending earnings", amount: summary?.pending, count: summary?.pendingReels, detail: "reels in review", tone: "text-[#6b4a05]" },
        ].map(row => (
          <div key={row.label} className="min-w-0 rounded-xl border border-[#dfe9de] bg-white/80 p-3.5 sm:p-4">
            <dt className={`text-[12px] font-medium ${row.tone}`}>{row.label}</dt>
            <dd className="mt-1.5 break-words text-[24px] font-semibold leading-tight tracking-tight text-[#1a201c] tabular-nums sm:text-[28px]">
              {loading ? <Skeleton className="h-8 w-28" /> : row.amount !== undefined ? formatAmount(row.amount) : "–"}
            </dd>
            {!loading && row.count !== undefined ? <p className="mt-1 text-[11.5px] text-[#7a827c]">{row.count} {row.detail}</p> : null}
          </div>
        ))}
      </dl>
      {summary && summary.accountCount > 1 ? (
        <ul className="mx-4 mb-4 divide-y divide-[#dfe9de] rounded-xl border border-[#dfe9de] bg-white/65 sm:mx-5 sm:mb-5">
          {summary.breakdown.map(row => (
            <li key={row.accountId} className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
              <div className="min-w-0">
                <p className="break-words text-[13px] font-semibold text-[#1a201c]">@{row.handle.replace(/^@/, "")}</p>
                {row.gigTitle ? <p className="mt-0.5 break-words text-[11.5px] text-[#7a827c]">{row.gigTitle}</p> : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-[11.5px]">
                <div className="min-w-0"><dt className="text-[#5d7466]">Approved</dt><dd className="break-words font-semibold text-[#1a201c] tabular-nums">{formatAmount(row.approved)}</dd></div>
                <div className="min-w-0"><dt className="text-[#7a827c]">Pending</dt><dd className="break-words font-semibold text-[#1a201c] tabular-nums">{formatAmount(row.pending)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1 border-t border-[#dfe9de] px-4 py-3 text-[11.5px] leading-5 text-[#5d7466] sm:px-5">
        <p>Estimates before authenticity review. Approved claims credit your wallet; withdrawal uses your available balance.</p>
        {summary?.missingCounts ? <p className="text-[#8a5300]">{summary.missingCounts} reel{summary.missingCounts === 1 ? "" : "s"} waiting for a view count.</p> : null}
        {error ? <p role="status" className="text-[#8a5300]">{summary ? "Showing the last saved earnings. " : ""}{error}</p> : null}
      </div>
    </section>
  );
}
