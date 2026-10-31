"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { AccountEarningsSummary } from "@/lib/creatorEarnings";
import { payoutHistoryNotes, payoutHistoryStatus, payoutHistoryTotal, payoutWalletLedger, type PayoutWalletEffect } from "@/lib/payoutHistory";
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
  type BadgeTone,
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
  /** Where it was sent (a UPI ID or a masked bank account) and any team notes, e.g. a rejection reason. */
  payTo?: string;
  notes?: string[];
  origin?: "manual" | "auto";
  items: Array<{ id: string; amountINR: number; status: string; handle?: string }>;
};

export type DashboardWalletViewProps = {
  loading: boolean;
  payoutBatches: WalletBatch[];
  /**
   * The wallet balance from the server (null while loading). Left out entirely (the reel-kit demo), the available
   * balance is estimated from the earnings summary.
   */
  wallet?: { available: number; committed: number } | null;
  accountEarnings: AccountEarningsSummary | null;
  earningsLoading: boolean;
  earningsError?: string;
  onOpenAccounts: () => void;
  assignmentsCount: number;
  workerId: string | null;
};

type BatchFilter = "all" | "pending" | "paid" | "returned";

/* One hue, ordered by how far the money has moved: available → held → withdrawn. */
const SERIES = { available: "#7cb68a", held: "#d9a520", withdrawn: "#2e7d4f" } as const;
const BADGE_TONE: Record<PayoutWalletEffect | "approved", BadgeTone> = { held: "attention", approved: "info", deducted: "success", returned: "critical", unknown: "neutral" };

function batchTotal(batch: WalletBatch) {
  return payoutHistoryTotal(batch.items ?? []) ?? 0;
}

function batchUpdated(batch: WalletBatch) {
  return batch.paidAt ?? batch.processedAt ?? batch.createdAt;
}

function statusOf(batch: WalletBatch) {
  const status = payoutHistoryStatus(String(batch.status ?? ""));
  return { ...status, tone: BADGE_TONE[status.label === "Approved" ? "approved" : status.effect] };
}

/** What happened to this payout's money, in a few words, shown under its amount. */
function walletEffectLabel(batch: WalletBatch) {
  switch (statusOf(batch).effect) {
    case "held": return "Held from wallet";
    case "deducted": return String(batch.status).toLowerCase() === "paid" ? "Deducted · paid" : "Deducted · sending";
    case "returned": return "Returned to wallet";
    default: return "";
  }
}

export default function DashboardWalletView({ loading, payoutBatches, wallet, accountEarnings, earningsLoading, earningsError, onOpenAccounts, workerId }: DashboardWalletViewProps) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sortedBatches = useMemo(
    () => [...payoutBatches].sort((left, right) => safeTime(batchUpdated(right)) - safeTime(batchUpdated(left))),
    [payoutBatches]
  );
  const matches = (batch: WalletBatch, which: BatchFilter) => {
    const effect = statusOf(batch).effect;
    return which === "all" || (which === "pending" ? effect === "held" || String(batch.status).toLowerCase() === "processing" : which === "paid" ? String(batch.status).toLowerCase() === "paid" : effect === "returned");
  };
  const counts = useMemo(
    () => ({
      all: sortedBatches.length,
      pending: sortedBatches.filter((batch) => matches(batch, "pending")).length,
      paid: sortedBatches.filter((batch) => matches(batch, "paid")).length,
      returned: sortedBatches.filter((batch) => matches(batch, "returned")).length,
    }),
    [sortedBatches]
  );
  const visibleBatches = sortedBatches.filter((batch) => matches(batch, filter));

  // The demo has no server wallet: estimate what's left of its credited earnings.
  const ledgerBase = useMemo(() => payoutWalletLedger(payoutBatches), [payoutBatches]);
  const estimatedAvailable = wallet === undefined && accountEarnings?.approved !== undefined
    ? Math.max(0, Math.round((accountEarnings.approved - ledgerBase.held - ledgerBase.withdrawn) * 100) / 100)
    : undefined;
  const ledger = useMemo(() => payoutWalletLedger(payoutBatches, wallet?.available ?? estimatedAvailable), [payoutBatches, wallet?.available, estimatedAvailable]);
  const credited = ledger.credited ?? 0;
  const share = (value: number) => (credited > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / credited) * 100) : 0);
  const lastPaid = sortedBatches.find((batch) => String(batch.status).toLowerCase() === "paid");
  const lastReturned = sortedBatches.find((batch) => statusOf(batch).effect === "returned");
  const firstLoad = loading && payoutBatches.length === 0;
  const balanceLoading = ledger.available === undefined && (wallet === null || firstLoad);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 sm:space-y-5">
      <PageHeader
        title="Wallet"
        description="What's yours to withdraw, what's on its way, and every payout."
        actions={
          <Link href="/payouts" className={buttonClassName("secondary")}>
            Payout history & settings
            <Icon.External />
          </Link>
        }
      />

      {/* Balance: where every credited rupee is right now. */}
      <Card aria-labelledby="wallet-available">
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-8">
          <div className="min-w-0">
            <h2 id="wallet-available" className="text-[12.5px] font-medium text-[#616a64]">Available to withdraw</h2>
            {balanceLoading ? (
              <Skeleton className="mt-2 h-10 w-44" />
            ) : (
              <div className="mt-1 break-words text-[clamp(1.9rem,7vw,2.6rem)] font-semibold leading-tight tracking-[-0.03em] tabular-nums text-[#1a201c]">
                {ledger.available !== undefined ? formatMoney(ledger.available) : "–"}
              </div>
            )}
            <p className="mt-1 text-[12.5px] leading-5 text-[#616a64]">
              {ledger.held > 0
                ? `${formatMoney(ledger.held)} is held in ${ledger.heldCount === 1 ? "a payout" : `${ledger.heldCount} payouts`} under review. It comes back here if a payout isn't approved.`
                : lastReturned
                  ? `${formatMoney(batchTotal(lastReturned))} from a rejected payout was returned ${formatRelative(batchUpdated(lastReturned))}.`
                  : "Requesting a payout moves the amount out of here until the team decides."}
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-[#ebedea] bg-[#fafbf9] p-3.5 sm:p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium text-[#616a64]">Credited to your wallet</span>
              <span className="text-[15px] font-semibold tabular-nums text-[#1a201c]">{ledger.credited !== undefined ? formatMoney(credited) : "–"}</span>
            </div>
            <div
              className="mt-2.5 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#eef0ed]"
              role="img"
              aria-label={`${formatMoney(ledger.available ?? 0)} available, ${formatMoney(ledger.held)} held in payouts, ${formatMoney(ledger.withdrawn)} withdrawn`}
            >
              {(["available", "held", "withdrawn"] as const).map((key) => {
                const value = key === "available" ? ledger.available ?? 0 : ledger[key];
                return value > 0 ? <span key={key} className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-700" style={{ width: `${share(value)}%`, background: SERIES[key] }} /> : null;
              })}
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-1.5 text-[12.5px] min-[420px]:grid-cols-3 min-[420px]:gap-3">
              {[
                { key: "available" as const, label: "Available", value: ledger.available, hint: "Ready to withdraw" },
                { key: "held" as const, label: "In review", value: ledger.held, hint: "Held from wallet" },
                { key: "withdrawn" as const, label: "Withdrawn", value: ledger.withdrawn, hint: "Approved or paid" },
              ].map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-2 min-[420px]:block">
                  <dt className="flex items-center gap-1.5 text-[#4b544e]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES[row.key] }} aria-hidden="true" />
                    {row.label}
                  </dt>
                  <dd className="font-semibold tabular-nums text-[#1a201c] min-[420px]:mt-0.5">
                    {row.value !== undefined ? formatMoney(row.value) : "–"}
                    <span className="ml-1.5 font-normal text-[#9aa29c] min-[420px]:ml-0 min-[420px]:block min-[420px]:text-[11px]">{row.hint}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <MetricTile label="Pending withdrawal" value={formatMoney(ledger.held)} caption={ledger.heldCount ? `${ledger.heldCount} under review` : "Nothing under review"} loading={firstLoad} />
        <MetricTile label="Paid out" value={formatMoney(ledger.paid)} caption={lastPaid ? `Last paid ${formatRelative(batchUpdated(lastPaid))}` : "Lifetime"} loading={firstLoad} />
      </div>

      <ReelEarningsSummary summary={accountEarnings} loading={earningsLoading} error={earningsError} onOpenAccounts={onOpenAccounts} />

      <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card aria-labelledby="wallet-cycles">
          <div className="flex flex-col gap-3 border-b border-[#ebedea] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <h2 id="wallet-cycles" className="px-1 text-[14px] font-semibold text-[#1a201c]">
              Payouts
            </h2>
            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
              <FilterTabs
                label="Filter payouts"
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setExpanded(null);
                }}
                tabs={[
                  { id: "all", label: "All", count: counts.all },
                  { id: "pending", label: "Pending", count: counts.pending },
                  { id: "paid", label: "Paid", count: counts.paid },
                  { id: "returned", label: "Returned", count: counts.returned },
                ]}
              />
            </div>
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
              title={counts.all === 0 ? "No payouts yet" : "Nothing here"}
              description={
                counts.all === 0
                  ? "When you withdraw, the payout appears here with every step until it's paid."
                  : filter === "returned"
                    ? "No payouts were rejected."
                    : `You have no ${filter} payouts right now.`
              }
            />
          ) : (
            <>
              {/* Table: tablet and up */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Payouts</caption>
                  <thead>
                    <tr className="border-b border-[#ebedea] bg-[#fafbf9] text-left text-[12px] text-[#616a64]">
                      <th scope="col" className="w-10 py-2.5 pl-4">
                        <span className="sr-only">Expand</span>
                      </th>
                      <th scope="col" className="py-2.5 pr-3 font-medium">Payout</th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">Paid to</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatches.map((batch) => {
                      const open = expanded === batch.id;
                      const status = statusOf(batch);
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
                                aria-label={`${open ? "Hide" : "Show"} details of ${batch.cycleLabel}`}
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
                                {batch.origin === "auto" ? "Automatic" : "Manual"} · requested {formatDate(batch.createdAt)}
                              </div>
                            </td>
                            <td className="hidden max-w-[220px] truncate px-3 py-3 text-[#4b544e] lg:table-cell">{batch.payTo || batch.method || "—"}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={status.label} tone={status.tone} />
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              <div className={cx("font-semibold tabular-nums", status.effect === "returned" ? "text-[#7a827c] line-through decoration-[#b9bfba]" : "text-[#1a201c]")}>{formatMoney(batchTotal(batch))}</div>
                              <div className={cx("text-[11.5px]", status.effect === "returned" ? "font-medium text-[#2e7d4f]" : "text-[#7a827c]")}>{walletEffectLabel(batch)}</div>
                            </td>
                            <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right text-[#7a827c]">{formatRelative(batchUpdated(batch))}</td>
                          </tr>
                          {open ? (
                            <tr id={`batch-${batch.id}`} className="border-b border-[#f2f3f1] bg-[#fafbf9]">
                              <td />
                              <td colSpan={5} className="pb-4 pr-5 pt-1">
                                <BatchDetails batch={batch} />
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
                  const status = statusOf(batch);
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
                            <span className="min-w-0 truncate text-[13.5px] font-semibold text-[#1a201c]">{batch.cycleLabel}</span>
                            <span className={cx("shrink-0 text-[13.5px] font-semibold tabular-nums", status.effect === "returned" ? "text-[#7a827c] line-through decoration-[#b9bfba]" : "text-[#1a201c]")}>{formatMoney(batchTotal(batch))}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2">
                            <StatusBadge status={status.label} tone={status.tone} />
                            <span className={cx("truncate text-[12px]", status.effect === "returned" ? "font-medium text-[#2e7d4f]" : "text-[#7a827c]")}>{walletEffectLabel(batch)}</span>
                          </span>
                        </span>
                        <Icon.ChevronDown className={cx("mt-0.5 h-4 w-4 shrink-0 text-[#a3aaa4] transition-transform", open && "rotate-180")} />
                      </button>
                      {open ? (
                        <div id={`batch-m-${batch.id}`} className="px-4 pb-4">
                          <BatchDetails batch={batch} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <Card aria-labelledby="wallet-how">
          <CardHeader id="wallet-how" title="How withdrawals work" />
          <ol className="relative mx-4 mb-4 mt-3 space-y-3.5 border-l border-[#e6e8e4] pl-4 sm:mx-5 sm:mb-5">
            {[
              ["Request", "The amount moves out of your available balance and is held while the team reviews it."],
              ["Approved", "Approved payouts leave your wallet for good and are sent to your bank account or UPI ID."],
              ["Paid", "You'll see the payment here once it's sent."],
              ["Not approved?", "Every rupee of a rejected payout goes straight back to your available balance."],
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
  );
}

/** A payout's journey (requested → approved → paid, or → rejected and returned), where it went, and its items. */
function BatchDetails({ batch }: { batch: WalletBatch }) {
  const status = statusOf(batch);
  const rejected = status.effect === "returned";
  const lower = String(batch.status).toLowerCase();
  const steps = rejected
    ? [
        { label: "Requested", at: batch.createdAt, done: true },
        { label: "Rejected", at: batch.processedAt, done: true, bad: true },
        { label: "Returned to wallet", at: batch.processedAt, done: true },
      ]
    : [
        { label: "Requested", at: batch.createdAt, done: true },
        { label: "Approved", at: batch.processedAt, done: lower === "processing" || lower === "paid" },
        { label: "Paid", at: batch.paidAt, done: lower === "paid" },
      ];
  const notes = payoutHistoryNotes(batch.notes).filter((note) => !/^ETA:/i.test(note));
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-3 gap-1.5" aria-label="Payout progress">
        {steps.map((step) => (
          <li key={step.label} className="min-w-0">
            <span className={cx("block h-1 rounded-full", step.bad ? "bg-[#e8a39b]" : step.done ? "bg-[#2e7d4f]" : "bg-[#e3e6e2]")} />
            <span className={cx("mt-1 block truncate text-[11.5px] font-medium", step.done ? "text-[#1a201c]" : "text-[#9aa29c]")}>{step.label}</span>
            <span className="block truncate text-[11px] text-[#7a827c]">{step.done && step.at ? formatDate(step.at) : step.done ? "" : "Pending"}</span>
          </li>
        ))}
      </ol>
      <p className={cx("rounded-lg px-3 py-2 text-[12.5px] leading-5", rejected ? "bg-[#eef6ec] text-[#1f5131]" : "bg-white text-[#4b544e] ring-1 ring-inset ring-[#ebedea]")}>
        {status.detail}
        {rejected && notes.length ? <span className="block text-[#4b544e]">Reason: {notes.at(-1)}</span> : null}
        {!rejected && batch.payTo ? <span className="block text-[#7a827c]">To {batch.payTo}</span> : null}
      </p>
      <BatchItems batch={batch} />
    </div>
  );
}

/** A payout item: in the payout (held or being sent), paid, or returned to the wallet. */
function itemStatus(raw: string): { status: string; tone: BadgeTone } {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "paid") return { status: "Paid", tone: "success" };
  if (value === "failed") return { status: "Returned", tone: "neutral" };
  return { status: "In payout", tone: "attention" };
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
              <StatusBadge {...itemStatus(item.status)} />
              <span className="w-20 text-right font-semibold tabular-nums text-[#1a201c]">{formatMoney(Number(item.amountINR ?? 0))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
