"use client";

import { useId, useMemo, useState } from "react";
import { compactViews, formatINR, planCopy, planReelSummary, type AccountPayoutPlan } from "@/lib/payoutPlans";
import { countedReels } from "@/lib/reelTracking";
import { parsePayoutAmount, type LinkedSocialAccount, type SocialPost } from "@/lib/socialAnalytics";
import { cx, formatDate } from "./dashboardUi";

// For creators on a custom pay plan: what they earn per reel in plain words, each reel's progress towards the
// view bonus, and why older reels are paid differently. Amounts are estimates until the team approves a reel.

const longDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const STATUS: Record<SocialPost["status"], { label: string; className: string }> = {
  submitted: { label: "In review", className: "bg-[#fdf0d2] text-[#6b4a05]" },
  approved: { label: "Approved", className: "bg-[#e3f1df] text-[#1f5131]" },
  rejected: { label: "Not approved", className: "bg-[#fde4e1] text-[#8e1f1a]" },
};
const VISIBLE = 4;

function SelectedBadge({ compact }: { compact?: boolean }) {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#1f4f37] font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.04)]", compact ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11px]")}>
      <svg viewBox="0 0 24 24" className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} fill="#f2c94c" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9Z" /></svg>
      <span className="truncate">{compact ? "Selected for a special pay plan" : "Selected for you"}</span>
    </span>
  );
}

/** The earnings tile for creators on a pay plan: the estimate, the plan in two numbers, and a link to the details. */
export function PlanEarningsTile({ plan, earned, approvedViews, pendingValue, warning, href, className, cpmNotice }: {
  plan: AccountPayoutPlan; earned: string; approvedViews: number; pendingValue: string; warning?: string; href: string; className?: string;
  /** Reels the team gave a lower CPM, linking to how to raise it. */
  cpmNotice?: { text: string; href: string };
}) {
  return (
    <div className={cx("flex min-w-0 flex-col rounded-xl border border-[#cfe3d4] bg-[linear-gradient(160deg,#f1f8ef,#f8fbf6)] p-3.5 sm:p-4", className)}>
      <SelectedBadge compact />
      <div className="mt-3 text-[12px] font-medium text-[#3b5a47]">Your earnings <span className="font-normal text-[#7a8f80]">(estimate)</span></div>
      <div className="mt-1 break-words text-[24px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-[#16301f] sm:text-[26px]">{earned}</div>

      <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg bg-white/80 ring-1 ring-[#dcebdd]">
        <div className="min-w-0 px-3 py-2">
          <dt className="text-[11px] text-[#5d7466]">Per reel</dt>
          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#1a201c]">{formatINR(plan.baseINR)}</dd>
        </div>
        <div className="min-w-0 border-l border-[#e6efe6] px-3 py-2">
          <dt className="truncate text-[11px] text-[#5d7466]">After {compactViews(plan.thresholdViews)} views</dt>
          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#1a201c]">{formatINR(plan.rateINR)}<span className="text-[11px] font-medium text-[#5d7466]"> / 1K</span></dd>
        </div>
      </dl>

      <p className="mt-2.5 text-[11.5px] tabular-nums text-[#5d7466]">{approvedViews.toLocaleString("en-IN")} approved views · {pendingValue} in review</p>
      {cpmNotice ? (
        <a href={cpmNotice.href} className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-[#fff4ea] px-2.5 py-1.5 text-[11.5px] font-medium leading-4 text-[#9a3412] ring-1 ring-[#fbdcc4] transition hover:bg-[#ffeadb]">
          <svg viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg>
          <span>{cpmNotice.text} · <span className="underline underline-offset-2">raise it</span></span>
        </a>
      ) : null}
      {warning ? <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-[#8a5300]"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d99a06]" aria-hidden="true" />{warning}</p> : null}
      <a href={href} className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#1f4f37] px-3 text-[12.5px] font-semibold text-white transition hover:bg-[#2a6447] sm:mt-auto sm:self-start">
        See how your plan works
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>
      </a>
    </div>
  );
}

function reelTitle(caption?: string) {
  const text = String(caption ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s{2,}/g, " ").trim();
  return text || "Untitled reel";
}

export default function PayoutPlanCard({ account }: { account: LinkedSocialAccount }) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const plan = account.payoutPlan;
  const gigRate = parsePayoutAmount(account.payout)?.amount ?? 0;
  const summary = useMemo(() => plan ? planReelSummary(countedReels(account.posts, account.linkedAt), plan, gigRate) : null, [account.posts, account.linkedAt, plan, gigRate]);
  if (!plan || !summary) return null;
  const copy = planCopy(plan);
  const from = longDate(plan.appliesFrom);
  const reels = [...summary.reels].sort((a, b) => Date.parse(b.post.postedAt ?? "") - Date.parse(a.post.postedAt ?? ""));
  const visible = showAll ? reels : reels.slice(0, VISIBLE);

  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-2xl border border-[#cfe3d4] bg-white">
      {/* What the plan pays */}
      <div className="bg-[linear-gradient(135deg,#f1f8ef,#f8fbf6)] px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
        <SelectedBadge />
        <h3 id={`${id}-title`} className="mt-3 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[#16301f] sm:text-[23px]">You&apos;ve been selected for a special pay plan</h3>
        <p className="mt-1.5 max-w-[60ch] text-[13px] leading-5 text-[#3b5a47]">
          Earn <b className="font-semibold text-[#16301f]">{formatINR(plan.baseINR)} for every approved reel</b> you post from {from}, and more when a reel takes off.
        </p>

        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="flex gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-[#dcebdd]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2e7d4f] text-[12px] font-bold text-white" aria-hidden="true">1</span>
            <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-[#1a201c]">{copy.baseTitle}</span><span className="mt-0.5 block text-[12.5px] leading-5 text-[#4d5a51]">{copy.baseText}</span></span>
          </li>
          <li className="flex gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-[#dcebdd]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2e7d4f] text-[12px] font-bold text-white" aria-hidden="true">2</span>
            <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-[#1a201c]">{copy.boostTitle}</span><span className="mt-0.5 block text-[12.5px] leading-5 text-[#4d5a51]">{copy.boostText}</span></span>
          </li>
        </ol>

        <div className="mt-3">
          <p className="text-[11.5px] font-medium text-[#5d7466]">What one reel earns</p>
          <ul className="mt-1.5 grid grid-cols-3 gap-2">
            {copy.examples.map(example => (
              <li key={example.views} className="rounded-xl bg-white px-2.5 py-2 text-center ring-1 ring-[#e3ece2]">
                <span className="block text-[11px] text-[#616a64]">{compactViews(example.views)} views</span>
                <span className="mt-0.5 block text-[15px] font-semibold tabular-nums text-[#1a201c] sm:text-[16px]">{formatINR(example.amountINR)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Totals */}
      <dl className="grid grid-cols-2 divide-x divide-[#eef0ec] border-y border-[#eef0ec] sm:grid-cols-3">
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-[11.5px] text-[#616a64]">Approved on plan</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#1a201c]">{formatINR(summary.approvedINR)}</dd>
          <dd className="text-[11px] text-[#7a827c]">{summary.approved.length} {summary.approved.length === 1 ? "reel" : "reels"}</dd>
        </div>
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-[11.5px] text-[#616a64]">Waiting for review</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#1a201c]">{formatINR(summary.inReviewINR)}</dd>
          <dd className="text-[11px] text-[#7a827c]">{summary.inReview.length} {summary.inReview.length === 1 ? "reel" : "reels"}</dd>
        </div>
        <div className="col-span-2 border-t border-[#eef0ec] px-4 py-3 sm:col-span-1 sm:border-t-0 sm:px-5">
          <dt className="text-[11.5px] text-[#616a64]">Past {compactViews(plan.thresholdViews)} views</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#1a201c]">{summary.boostedCount}</dd>
          <dd className="text-[11px] text-[#7a827c]">{summary.boostedCount ? "earning the view rate" : `reels earn more past ${compactViews(plan.thresholdViews)}`}</dd>
        </div>
      </dl>

      {/* Each reel */}
      <div className="px-4 py-4 sm:px-5">
        <h4 className="text-[13.5px] font-semibold text-[#1a201c]">Your reels on this plan</h4>
        {reels.length ? (
          <ul className="mt-2.5 space-y-2">
            {visible.map(({ post, views, measured, earnsINR, progress, remainingToBoost, boosted, rateINR }) => (
              <li key={post.id} className="rounded-xl border border-[#eef0ec] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={post.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[13px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">{reelTitle(post.caption)}</a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#7a827c]">
                      <span>{post.postedAt ? formatDate(post.postedAt) : "No date"}</span>
                      <span className={cx("rounded-full px-1.5 py-px text-[10px] font-semibold", STATUS[post.status].className)}>{STATUS[post.status].label}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-[15px] font-semibold tabular-nums text-[#1a201c]">{formatINR(earnsINR)}</span>
                    <span className="block text-[10.5px] text-[#7a827c]">{post.status === "approved" ? "earned" : "once approved"}</span>
                  </div>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#eef0ed]" role="progressbar" aria-label={`Views towards ${compactViews(plan.thresholdViews)}`} aria-valuemin={0} aria-valuemax={plan.thresholdViews} aria-valuenow={Math.min(views, plan.thresholdViews)}>
                  <div className={cx("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", boosted ? "bg-[linear-gradient(90deg,#2e7d4f,#d9a400)]" : "bg-[linear-gradient(90deg,#2e7d4f,#7fb38f)]")} style={{ width: `${Math.max(progress * 100, views > 0 ? 2 : 0)}%` }} />
                </div>
                <p className="mt-1.5 text-[11.5px] leading-5 text-[#616a64]">
                  {!measured ? "Views will show once Instagram shares them. You still get the base pay."
                    : boosted ? <><b className="font-semibold text-[#7a5600]">Past {compactViews(plan.thresholdViews)} views:</b> {plan.mode === "all" ? `paid ${formatINR(rateINR)} per 1,000 views` : `+${formatINR(rateINR)} for every 1,000 views past ${compactViews(plan.thresholdViews)}`} · {views.toLocaleString("en-IN")} views</>
                    : <>{views.toLocaleString("en-IN")} of {plan.thresholdViews.toLocaleString("en-IN")} views · <b className="font-semibold text-[#1f5131]">{remainingToBoost.toLocaleString("en-IN")} more</b> to start earning more</>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2.5 rounded-xl border border-dashed border-[#d6dcd5] px-4 py-5 text-center">
            <p className="text-[13px] font-semibold text-[#1a201c]">No reels on your plan yet</p>
            <p className="mt-1 text-[12px] leading-5 text-[#7a827c]">Post a reel and add it here. Each approved reel earns {formatINR(plan.baseINR)}.</p>
          </div>
        )}
        {reels.length > VISIBLE ? (
          <button type="button" onClick={() => setShowAll(value => !value)} className="mt-2 h-9 w-full rounded-lg text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#f3f7f1]">
            {showAll ? "Show fewer" : `Show all ${reels.length} reels`}
          </button>
        ) : null}

        {summary.standard.reels ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#f7f8f6] px-3 py-2.5 text-[12px] leading-5 text-[#4d5a51]">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#9aa29c]" aria-hidden="true" />
            <span>
              {summary.standard.reels} earlier {summary.standard.reels === 1 ? "reel" : "reels"} ({summary.standard.views.toLocaleString("en-IN")} views) {summary.standard.reels === 1 ? "is" : "are"} paid at the standard {formatINR(gigRate)} per 1,000 views: {formatINR(summary.standard.amountINR)} so far. Your plan covers reels posted from {from}.
            </span>
          </p>
        ) : null}

        <details className="group mt-3 rounded-xl border border-[#eef0ec] px-3 py-2.5 text-[12.5px] text-[#4d5a51]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-[#1a201c] [&::-webkit-details-marker]:hidden">
            How you get paid
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-5">
            <li>When the team approves a reel, its {formatINR(plan.baseINR)} goes to your wallet.</li>
            <li>Extra pay for views past {plan.thresholdViews.toLocaleString("en-IN")} is added when the team reviews the reel again or approves your earnings claim.</li>
            <li>Reels that aren&apos;t approved don&apos;t earn. Amounts here are estimates until then.</li>
            <li>Once a reel starts earning, it keeps these terms, even if your plan changes later.</li>
          </ul>
        </details>
      </div>
    </section>
  );
}
