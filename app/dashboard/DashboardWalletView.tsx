"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { isOpenPayoutStatus, summarizePayoutBatches, type AccountEarningsSummary } from "@/lib/creatorEarnings";
import ReelEarningsSummary from "./ReelEarningsSummary";
import {
  Card,
  CardHeader,
  EmptyState,
  FilterTabs,
  Icon,
  MetricTile,
  PageHeader,
  Skeleton,
  StatusBadge,
  buttonClassName,
  cx,
  formatDate,
  formatMoney,
  formatRelative,
  safeTime,
} from "./dashboardUi";

type WalletBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  items: Array<{ id: string; amountINR: number; status: string; handle?: string }>;
};

export type DashboardWalletViewProps = {
  loading: boolean;
  payoutBatches: WalletBatch[];
  accountEarnings: AccountEarningsSummary | null;
  earningsLoading: boolean;
  earningsError?: string;
  onOpenAccounts: () => void;
  assignmentsCount: number;
  workerId: string | null;
};

type BatchFilter = "all" | "pending" | "paid";

/* Ordinal one-hue ramp, validated (monotone lightness, single hue, light end ≥ 2:1 on white). */
const SERIES_PENDING = "#7cb68a";
const SERIES_PAID = "#2e7d4f";

function batchTotal(batch: WalletBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

function batchIsPaid(batch: WalletBatch) {
  return String(batch.status).trim().toLowerCase() === "paid";
}

function statusLabel(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) return "Pending";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function batchUpdated(batch: WalletBatch) {
  return batch.paidAt ?? batch.processedAt ?? batch.createdAt;
}

export default function DashboardWalletView({ loading, payoutBatches, accountEarnings, earningsLoading, earningsError, onOpenAccounts, assignmentsCount, workerId }: DashboardWalletViewProps) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sortedBatches = useMemo(
    () => [...payoutBatches].sort((left, right) => safeTime(batchUpdated(right)) - safeTime(batchUpdated(left))),
    [payoutBatches]
  );
  const counts = useMemo(
    () => ({
      all: sortedBatches.length,
      pending: sortedBatches.filter((batch) => isOpenPayoutStatus(batch.status)).length,
      paid: sortedBatches.filter(batchIsPaid).length,
    }),
    [sortedBatches]
  );
  const visibleBatches = sortedBatches.filter((batch) => (filter === "all" ? true : filter === "paid" ? batchIsPaid(batch) : isOpenPayoutStatus(batch.status)));
  const payoutSummary = useMemo(() => summarizePayoutBatches(payoutBatches), [payoutBatches]);

  const lifetime = payoutSummary.credited + payoutSummary.pending;
  const paidShare = lifetime > 0 ? (payoutSummary.credited / lifetime) * 100 : 0;
  const lastPaid = sortedBatches.find(batchIsPaid);
  const firstLoad = loading && payoutBatches.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 sm:space-y-5">
      <PageHeader
        title="Wallet"
        description="Track what you've earned, what's on its way, and every payout cycle."
        actions={
          <Link href="/payouts" className={buttonClassName("secondary")}>
            Payout history & settings
            <Icon.External />
          </Link>
        }
      />

      <ReelEarningsSummary summary={accountEarnings} loading={earningsLoading} error={earningsError} onOpenAccounts={onOpenAccounts} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile label="Paid out" value={formatMoney(payoutSummary.credited)} caption={lastPaid ? `Last paid ${formatRelative(batchUpdated(lastPaid))}` : "Lifetime"} loading={firstLoad} />
        <MetricTile label="Pending withdrawal" value={formatMoney(payoutSummary.pending)} caption="In open payout cycles" loading={firstLoad} />
        <MetricTile label="Open payout cycles" value={String(payoutSummary.liveBatches)} caption={`${counts.all} cycles in total`} loading={firstLoad} />
        <MetricTile label="Assignments" value={String(assignmentsCount)} caption="Feeding your earnings" loading={firstLoad} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card aria-labelledby="wallet-cycles">
          <div className="flex flex-col gap-3 border-b border-[#ebedea] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <h2 id="wallet-cycles" className="px-1 text-[14px] font-semibold text-[#1a201c]">
              Payout cycles
            </h2>
            <FilterTabs
              label="Filter payout cycles"
              value={filter}
              onChange={(next) => {
                setFilter(next);
                setExpanded(null);
              }}
              tabs={[
                { id: "all", label: "All", count: counts.all },
                { id: "pending", label: "Pending", count: counts.pending },
                { id: "paid", label: "Paid", count: counts.paid },
              ]}
            />
          </div>

          {firstLoad ? (
            <div className="space-y-3 p-4 sm:p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : visibleBatches.length === 0 ? (
            <EmptyState
              icon={<Icon.Wallet className="h-5 w-5" />}
              title={counts.all === 0 ? "No payout cycles yet" : "Nothing here"}
              description={
                counts.all === 0
                  ? "Earnings from completed assignments are grouped into payout cycles. They'll appear here as soon as the first one is created."
                  : `You have no ${filter} cycles right now.`
              }
            />
          ) : (
            <>
              {/* Table: tablet and up */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Payout cycles</caption>
                  <thead>
                    <tr className="border-b border-[#ebedea] bg-[#fafbf9] text-left text-[12px] text-[#616a64]">
                      <th scope="col" className="w-10 py-2.5 pl-4">
                        <span className="sr-only">Expand</span>
                      </th>
                      <th scope="col" className="py-2.5 pr-3 font-medium">Cycle</th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">Method</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatches.map((batch) => {
                      const open = expanded === batch.id;
                      return (
                        <Fragment key={batch.id}>
                          <tr
                            className={cx("cursor-pointer border-b border-[#f2f3f1] transition hover:bg-[#fafbf9]", open && "bg-[#fafbf9]")}
                            onClick={() => setExpanded(open ? null : batch.id)}
                          >
                            <td className="py-3 pl-4">
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-controls={`batch-${batch.id}`}
                                aria-label={`${open ? "Hide" : "Show"} items in ${batch.cycleLabel}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setExpanded(open ? null : batch.id);
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#616a64] hover:bg-[#eceeea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                              >
                                <Icon.ChevronRight className={cx("h-4 w-4 transition-transform", open && "rotate-90")} />
                              </button>
                            </td>
                            <td className="py-3 pr-3">
                              <div className="font-semibold text-[#1a201c]">{batch.cycleLabel}</div>
                              <div className="text-[12px] text-[#7a827c]">
                                {formatDate(batch.periodStart)} – {formatDate(batch.periodEnd)}
                              </div>
                            </td>
                            <td className="hidden whitespace-nowrap px-3 py-3 text-[#4b544e] lg:table-cell">{batch.method || "—"}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={statusLabel(batch.status)} />
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[#1a201c]">{formatMoney(batchTotal(batch))}</td>
                            <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right text-[#7a827c]">{formatRelative(batchUpdated(batch))}</td>
                          </tr>
                          {open ? (
                            <tr id={`batch-${batch.id}`} className="border-b border-[#f2f3f1] bg-[#fafbf9]">
                              <td />
                              <td colSpan={5} className="pb-4 pr-5 pt-1">
                                <BatchItems batch={batch} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards: phones */}
              <ul className="divide-y divide-[#f0f1ef] md:hidden">
                {visibleBatches.map((batch) => {
                  const open = expanded === batch.id;
                  return (
                    <li key={batch.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`batch-m-${batch.id}`}
                        onClick={() => setExpanded(open ? null : batch.id)}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition active:bg-[#f5f7f4]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">{batch.cycleLabel}</span>
                            <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-[#1a201c]">{formatMoney(batchTotal(batch))}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] text-[#7a827c]">
                              {formatDate(batch.periodStart)} – {formatDate(batch.periodEnd)}
                            </span>
                            <StatusBadge status={statusLabel(batch.status)} />
                          </span>
                        </span>
                        <Icon.ChevronDown className={cx("mt-0.5 h-4 w-4 shrink-0 text-[#a3aaa4] transition-transform", open && "rotate-180")} />
                      </button>
                      {open ? (
                        <div id={`batch-m-${batch.id}`} className="px-4 pb-4">
                          <BatchItems batch={batch} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
          <Card aria-labelledby="wallet-balance">
            <CardHeader id="wallet-balance" title="Payout breakdown" description="Paid and requested withdrawals" />
            <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
              <div className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#1a201c]">{formatMoney(lifetime)}</div>
              <div
                className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#eef0ed]"
                role="img"
                aria-label={`${formatMoney(payoutSummary.credited)} paid, ${formatMoney(payoutSummary.pending)} pending`}
              >
                {payoutSummary.credited > 0 ? <span className="h-full rounded-l-full" style={{ width: `${paidShare}%`, background: SERIES_PAID }} /> : null}
                {payoutSummary.pending > 0 ? <span className="h-full flex-1 rounded-r-full" style={{ background: SERIES_PENDING }} /> : null}
              </div>
              <dl className="mt-3 space-y-1.5 text-[12.5px]">
                {[
                  { label: "Paid", value: payoutSummary.credited, color: SERIES_PAID },
                  { label: "Pending", value: payoutSummary.pending, color: SERIES_PENDING },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-[#4b544e]">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: row.color }} aria-hidden="true" />
                      {row.label}
                    </dt>
                    <dd className="font-semibold tabular-nums text-[#1a201c]">
                      {formatMoney(row.value)}
                      <span className="ml-1.5 font-normal text-[#9aa29c]">{lifetime > 0 ? Math.round((row.value / lifetime) * 100) : 0}%</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>

          <Card aria-labelledby="wallet-how">
            <CardHeader id="wallet-how" title="How payouts work" />
            <ol className="relative mx-4 mb-4 mt-3 space-y-3.5 border-l border-[#e6e8e4] pl-4 sm:mx-5 sm:mb-5">
              {[
                ["Earn", "Post reels and submit assigned work for review."],
                ["Claim", "Claim new eligible reel views from Accounts. Reviewed claims credit your wallet."],
                ["Withdraw", "Request a payout from your available balance when eligible."],
                ["Paid", "The team processes your withdrawal and records the payment."],
              ].map(([title, body], index) => (
                <li key={title} className="relative">
                  <span className="absolute -left-[25px] top-0 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#2b5d4a] ring-1 ring-[#cfd5cf]">
                    {index + 1}
                  </span>
                  <div className="text-[13px] font-semibold text-[#1a201c]">{title}</div>
                  <div className="text-[12.5px] leading-5 text-[#616a64]">{body}</div>
                </li>
              ))}
            </ol>
            <div className="border-t border-[#ebedea] px-4 py-3 text-[12px] text-[#7a827c] sm:px-5">
              {workerId ? (
                <>
                  Worker ID <span className="font-mono text-[#1a201c]">{workerId}</span>
                </>
              ) : (
                "Sign in to link your worker profile."
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BatchItems({ batch }: { batch: WalletBatch }) {
  if (!batch.items?.length) {
    return <p className="rounded-lg border border-dashed border-[#dfe2de] bg-white px-3 py-2.5 text-[12.5px] text-[#616a64]">No line items in this cycle.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[#e3e5e1] bg-white">
      <div className="flex items-center justify-between border-b border-[#ebedea] px-3 py-2 text-[12px] text-[#616a64]">
        <span>
          {batch.items.length} {batch.items.length === 1 ? "item" : "items"}
          {batch.method ? <span className="md:hidden"> · {batch.method}</span> : null}
        </span>
        <span>Created {formatDate(batch.createdAt)}</span>
      </div>
      <ul className="divide-y divide-[#f2f3f1]">
        {batch.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
            <span className="min-w-0 truncate text-[#1a201c]">{item.handle ? `@${item.handle.replace(/^@/, "")}` : "Earnings"}</span>
            <span className="flex shrink-0 items-center gap-3">
              <StatusBadge status={statusLabel(item.status)} />
              <span className="w-20 text-right font-semibold tabular-nums text-[#1a201c]">{formatMoney(Number(item.amountINR ?? 0))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
