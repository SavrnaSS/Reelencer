"use client";

import { compactViews, formatINR } from "@/lib/payoutPlans";

/**
 * Which views earn which rate: the full-rate part up to the start, the lowered part after it, and where the reel is
 * now. Without a lowered rate yet (`rateINR` undefined) it shows the whole reel at the full rate.
 */
export default function CpmSplitBar({ views, afterViews, standardRateINR, rateINR }: { views: number; afterViews: number; standardRateINR: number; rateINR?: number }) {
  const lowered = rateINR !== undefined && rateINR < standardRateINR;
  // Scale to whichever is further out, with headroom so the marker never sits on the edge.
  const span = Math.max(views, afterViews, 1_000) * 1.18;
  const head = lowered ? Math.min(100, (afterViews / span) * 100) : 100;
  const marker = Math.min(97, Math.max(3, (views / span) * 100));
  const label = lowered
    ? `${afterViews ? `First ${afterViews.toLocaleString("en-IN")} views at ${formatINR(standardRateINR)} per 1K, then` : "Every view at"} ${formatINR(rateINR!)} per 1K. The reel has ${views.toLocaleString("en-IN")} views.`
    : `Every view at ${formatINR(standardRateINR)} per 1K. The reel has ${views.toLocaleString("en-IN")} views.`;
  return (
    <div className="mt-2.5">
      {/* "Now" marker label rides above the bar */}
      <div className="relative h-5">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-[#1a201c] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white transition-[left] duration-300 motion-reduce:transition-none"
          style={{ left: `${marker}%` }}
        >
          {compactViews(views)} views now
        </span>
      </div>
      <div className="relative mt-1 h-3 overflow-hidden rounded-[999px] bg-[#eef0ec]" role="img" aria-label={label}>
        <div className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,#2e7d4f,#5fb27f)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${head}%` }} />
        {lowered ? (
          <div className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,#f59e0b_0_6px,#ea580c_6px_12px)] transition-[left] duration-300 motion-reduce:transition-none" style={{ left: `${head}%` }} />
        ) : null}
        <div className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-[#1a201c] shadow-[0_0_0_2px_#fff] transition-[left] duration-300 motion-reduce:transition-none" style={{ left: `${marker}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-[#5b645e]">
        {!lowered || afterViews ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[999px] bg-[#2e7d4f]" aria-hidden="true" />
            {lowered ? `0–${compactViews(afterViews)} views` : "Every view"} · <b className="font-semibold text-[#1a201c]">{formatINR(standardRateINR)}/1K</b>
          </span>
        ) : null}
        {lowered ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[999px] bg-[#ea580c]" aria-hidden="true" />
            {afterViews ? `After ${compactViews(afterViews)}` : "Every view"} · <b className="font-semibold text-[#9a3f0b]">{formatINR(rateINR!)}/1K</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}
