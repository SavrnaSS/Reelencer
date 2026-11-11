"use client";

import { compactViews, formatINR } from "@/lib/payoutPlans";

/** Which views earn which rate: the standard part up to the start, the lowered part after it, and today's views. */
export default function CpmSplitBar({ views, afterViews, standardRateINR, rateINR }: { views: number; afterViews: number; standardRateINR: number; rateINR: number }) {
  // Scale to whichever is further out, with headroom so the marker never sits on the edge.
  const span = Math.max(views, afterViews, 1_000) * 1.15;
  const head = Math.min(100, (afterViews / span) * 100);
  const marker = Math.min(100, (views / span) * 100);
  return (
    <div className="mt-2">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[#f1f3f0]" role="img" aria-label={`First ${afterViews.toLocaleString("en-IN")} views at ${formatINR(standardRateINR)} per 1K, then ${formatINR(rateINR)} per 1K. The reel has ${views.toLocaleString("en-IN")} views.`}>
        <div className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,#2e7d4f,#5fb27f)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${head}%` }} />
        <div className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,#f59e0b_0_6px,#ea580c_6px_12px)] opacity-80 transition-[left] duration-300 motion-reduce:transition-none" style={{ left: `${head}%` }} />
        <div className="absolute inset-y-[-2px] w-[3px] rounded-full bg-[#1a201c] shadow-[0_0_0_2px_#fff] transition-[left] duration-300 motion-reduce:transition-none" style={{ left: `calc(${marker}% - 1.5px)` }} />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[10.5px] tabular-nums text-[#6b746e]">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#2e7d4f] align-middle" />{afterViews ? `0–${compactViews(afterViews)} views · ${formatINR(standardRateINR)}/1K` : "No views at the full rate"}</span>
        <span className="font-semibold text-[#1a201c]">▲ {compactViews(views)} views now</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ea580c] align-middle" />{afterViews ? `after ${compactViews(afterViews)}` : "every view"} · {formatINR(rateINR)}/1K</span>
      </div>
    </div>
  );
}
