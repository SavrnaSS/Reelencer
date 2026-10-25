"use client";

import type { LinkedSocialAccount } from "@/lib/socialAnalytics";
import { syncPresentation } from "@/lib/socialSyncSchedule";

const tones = { success: "bg-[#ebf5ee] text-[#1d5c37]", warning: "bg-[#fff4df] text-[#8a5300]", progress: "bg-[#eaf1fa] text-[#305c86]", neutral: "bg-[#f1f3f0] text-[#616a64]" };
const time = (value: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));

export default function SocialSyncStatus({ account, now, compact = false, showLabel = true }: { account: LinkedSocialAccount; now: number; compact?: boolean; showLabel?: boolean }) {
  const { sync } = account;
  const presentation = syncPresentation(account, now);
  const delay = sync.nextSyncAt ? Math.max(0, Math.ceil((Date.parse(sync.nextSyncAt) - now) / 60_000)) : null;
  return (
    <div className={`min-w-0 ${compact ? "inline-flex" : "space-y-1.5"}`} role="status">
      {showLabel ? <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[presentation.tone]}`}>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${presentation.label === "Syncing" ? "motion-safe:animate-pulse" : ""}`} />
        {presentation.label}
      </span> : null}
      {!compact ? <>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[#616a64]">
          <span>{sync.lastSyncedAt ? `Updated ${time(sync.lastSyncedAt)}` : "Waiting for the first successful reading"}</span>
          {sync.available && account.status === "active" && delay !== null ? <span>{delay > 0 ? `${sync.status === "error" ? "Retry" : "Next check"} in ${delay < 60 ? `${delay} min` : `${Math.ceil(delay / 60)} hr`}` : "Next check queued"}</span> : null}
          {sync.provider ? <span>{sync.provider === "meta" ? "Instagram API" : sync.provider === "youtube" ? "YouTube API" : "Public profile"}</span> : null}
        </p>
        {sync.status === "error" && account.status === "active" ? <p className="max-w-[85ch] break-words text-[11.5px] leading-5 text-[#8a5300]">{sync.error || "The platform did not return statistics. Automatic sync will retry."}{sync.lastSyncedAt ? " Your last successful numbers are preserved." : ""}</p> : null}
      </> : null}
    </div>
  );
}
