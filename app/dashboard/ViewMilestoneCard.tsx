"use client";

import { useMemo } from "react";
import { creatorViewMilestone, FIRST_VIEW_MILESTONE } from "@/lib/creatorViewMilestones";
import type { LinkedSocialAccount } from "@/lib/socialAnalytics";
import { cx, formatRelative } from "./dashboardUi";

const count = (value: number) => value.toLocaleString("en-US");

/** Goals follow this account's measured reel counts and advance on every account update. */
export default function ViewMilestoneCard({ account, className }: { account: LinkedSocialAccount; className?: string }) {
  const summary = useMemo(() => creatorViewMilestone({ posts: account.posts, linkedAt: account.linkedAt }), [account.posts, account.linkedAt]);
  const { milestone, total, measured, missing, totalReels, oldestCapturedAt } = summary;
  const target = milestone?.target ?? (total === undefined ? FIRST_VIEW_MILESTONE : undefined);

  return (
    <div role="group" aria-label="Next view milestone" className={cx("flex min-w-0 flex-col rounded-xl border border-[#dce7dd] bg-white p-3.5 sm:p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-[12px] font-medium text-[#616a64]">Next milestone</div>
        <span className="rounded-full bg-[#edf5ed] px-1.5 py-0.5 text-[10px] font-semibold text-[#2e7049]">Auto goal</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums">
        <span className="break-all text-[22px] font-semibold leading-none tracking-tight text-[#1a201c]">{target !== undefined ? count(target) : "–"}</span>
        <span className="text-[12px] text-[#616a64]">reel views</span>
      </div>
      {milestone ? (
        <div
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#eef0ed]"
          role="progressbar"
          aria-label="Progress to next view milestone"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={milestone.percent}
          aria-valuetext={`${count(total!)} of ${count(milestone.target)} reel views; ${count(milestone.remaining)} to go`}
        >
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#2e7d4f,#7fb38f)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${milestone.progress * 100}%` }} />
        </div>
      ) : <div className="mt-2.5 h-1.5 rounded-full bg-[#eef0ed]" aria-hidden="true" />}
      <div role="status" aria-atomic="true" className="mt-1.5 break-words text-[11.5px] leading-5 text-[#616a64]">
        {milestone ? (
          <><span className="sr-only">Goal: {count(milestone.target)} reel views. </span>{milestone.percent}% there · <span className="inline-block">{count(milestone.remaining)} views to go</span></>
        ) : total === undefined ? (
          totalReels ? "Waiting for reel view counts" : "Share your first reel to start"
        ) : "View goal unavailable"}
      </div>
      {milestone?.previousTarget ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] leading-4">
          <span className="inline-flex items-center gap-1 rounded-md bg-[#edf5ed] px-1.5 py-0.5 font-medium text-[#2e7049]">
            <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0" aria-hidden="true"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {count(milestone.previousTarget)} reached
          </span>
          {milestone.nextTarget ? <span className="text-[#8a928c]">Then {count(milestone.nextTarget)}</span> : null}
        </div>
      ) : <p className="mt-1 text-[10.5px] leading-4 text-[#8a928c]">Your next goal updates automatically.</p>}
      {missing > 0 ? (
        <p className="mt-1.5 text-[10.5px] leading-4 text-[#8a670b]">{measured} of {totalReels} reels measured · {missing} pending</p>
      ) : null}
      {milestone && oldestCapturedAt ? (
        <p className="mt-auto pt-1.5 text-[10.5px] leading-4 text-[#8a928c]">Views measured <time dateTime={oldestCapturedAt} title={new Date(oldestCapturedAt).toLocaleString()}>{formatRelative(oldestCapturedAt)}</time></p>
      ) : null}
    </div>
  );
}
