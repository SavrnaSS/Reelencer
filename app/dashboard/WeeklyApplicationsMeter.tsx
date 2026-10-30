"use client";

import { useId, useState } from "react";
import { formatSlotTime, formatWait, type ApplicationQuota } from "@/lib/applicationQuota";

// Find gigs: how many of the week's applications are used, when the next one opens, and which gigs count.

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export default function WeeklyApplicationsMeter({
  quota,
  now,
  gigTitle,
  onOpenGig,
}: {
  quota: ApplicationQuota;
  now: number;
  gigTitle: (gigId: string) => string;
  onOpenGig: (gigId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const full = quota.remaining === 0;
  const soonest = quota.gigs[0];

  // One short line; the exact times and the rules are under Details.
  // Phones get the short wording so the line never truncates.
  const status = full
    ? { long: "Weekly limit reached", short: "Limit reached" }
    : { long: `${quota.remaining} ${quota.remaining === 1 ? "application" : "applications"} left this week`, short: `${quota.remaining}/${quota.limit} left this week` };
  const hint = full
    ? quota.nextSlotAt
      ? { long: `next opens in ${formatWait(quota.nextSlotAt, now)}`, short: `opens in ${formatWait(quota.nextSlotAt, now)}` }
      : null
    : quota.used > 0 && soonest
      ? { long: `next frees in ${formatWait(soonest.freesAt, now)}`, short: `frees in ${formatWait(soonest.freesAt, now)}` }
      : { long: `any ${quota.windowDays} days`, short: `any ${quota.windowDays} days` };

  return (
    <div className={cx("overflow-hidden rounded-lg border bg-white", full ? "border-[#f0d9a8]" : "border-[#e3e5e1]")}>
      <div className="flex min-h-10 items-center gap-2.5 py-1.5 pl-3 pr-1.5 sm:pl-3.5">
        <span className="flex shrink-0 items-center gap-1" role="img" aria-label={`${quota.used} of ${quota.limit} weekly applications used`}>
          {Array.from({ length: quota.limit }).map((_, index) => (
            <span key={index} className={cx("h-1.5 w-4 rounded-full sm:w-5", index < quota.used ? (full ? "bg-[#e29a1b]" : "bg-[#2e7d4f]") : "bg-[#e3e6e1]")} />
          ))}
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] leading-5" aria-live="polite" title={full && quota.nextSlotAt ? `Next application opens ${formatSlotTime(quota.nextSlotAt)}` : undefined}>
          <span className={cx("font-semibold", full ? "text-[#8a5200]" : "text-[#1a201c]")}>
            <span className="sm:hidden">{status.short}</span>
            <span className="hidden sm:inline">{status.long}</span>
          </span>
          {hint ? (
            <span className="text-[#6b746e]">
              {" · "}
              <span className="sm:hidden">{hint.short}</span>
              <span className="hidden sm:inline">{hint.long}</span>
            </span>
          ) : null}
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Hide application limit details" : "Show application limit details"}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef3ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
        >
          <span className="hidden sm:inline">{open ? "Hide" : "Details"}</span>
          <svg viewBox="0 0 20 20" className={cx("h-4 w-4 transition", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-[#ebedea] bg-[#fafbf9] px-3 py-2.5 text-[12.5px] leading-5 text-[#4b544e] sm:px-3.5">
          {quota.gigs.length ? (
            <ul className="space-y-1.5">
              {quota.gigs.map((gig) => (
                <li key={gig.gigId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <button type="button" onClick={() => onOpenGig(gig.gigId)} className="min-w-0 max-w-full truncate text-left font-semibold text-[#1a201c] underline-offset-2 hover:underline">
                    {gigTitle(gig.gigId)}
                  </button>
                  <span className="shrink-0 tabular-nums text-[#6b746e]">
                    Applied {formatSlotTime(gig.appliedAt)} · frees in {formatWait(gig.freesAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>You haven&apos;t applied to any gigs in the last {quota.windowDays} days.</p>
          )}
          <ul className="mt-2.5 list-disc space-y-0.5 pl-4 text-[12px] text-[#6b746e]">
            <li>
              You can apply to {quota.limit} gigs in any {quota.windowDays} days. Each application frees its slot {quota.windowDays} days later.
            </li>
            <li>Withdrawn or declined applications still count until then.</li>
            <li>Updating or revising an application you already sent doesn&apos;t use another slot.</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Quick apply: the weekly slots before and after this application, with the one it takes highlighted. */
export function ApplicationSlotPreview({ quota, now }: { quota: ApplicationQuota; now: number }) {
  const after = Math.min(quota.used + 1, quota.limit);
  const last = after >= quota.limit;
  // After this one, the next slot opens when the oldest counted application turns 7 days old.
  const opensIn = last && quota.gigs[0] ? formatWait(quota.gigs[0].freesAt, now) : null;
  const slots = Array.from({ length: quota.limit }, (_, index) => (index < quota.used ? "used" : index === quota.used ? "this" : "free"));
  const label = { used: "Used", this: "This one", free: "Left" } as const;

  return (
    <div className={cx("rounded-lg border px-3.5 py-3", last ? "border-[#f0d9a8] bg-[#fffaf0]" : "border-[#e3e5e1] bg-[#fafbf9]")}>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="font-semibold text-[#1a201c]">Weekly applications</span>
        <span className="tabular-nums text-[#616a64]">
          {quota.used} <span aria-hidden="true">→</span>
          <span className="sr-only">to</span> <span className="font-semibold text-[#1a201c]">{after}</span> of {quota.limit} used
        </span>
      </div>
      <ol className="mt-2 flex gap-1.5" aria-label={`This application uses slot ${quota.used + 1} of ${quota.limit}`}>
        {slots.map((slot, index) => (
          <li key={index} className="min-w-0 flex-1">
            <span
              className={cx(
                "block h-2 rounded-full",
                slot === "used" && "bg-[#2e7d4f]",
                slot === "this" && "bg-[repeating-linear-gradient(135deg,#2e7d4f_0_5px,#6fb087_5px_10px)] motion-safe:animate-pulse",
                slot === "free" && "bg-[#e3e6e1]",
              )}
            />
            <span className={cx("mt-1 block truncate text-[10.5px] font-semibold uppercase tracking-[0.06em]", slot === "this" ? "text-[#2e7d4f]" : "text-[#8a928c]")}>{label[slot]}</span>
          </li>
        ))}
      </ol>
      <p className={cx("mt-1.5 flex items-start gap-1.5 text-[12px] leading-5", last ? "text-[#7a4a00]" : "text-[#616a64]")}>
        {last ? (
          <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2" />
          </svg>
        ) : null}
        <span>
          {last ? (
            <>
              Your last application for now.
              {opensIn ? (
                <>
                  {" "}The next one opens in <span className="whitespace-nowrap font-semibold">{opensIn}</span>.
                </>
              ) : null}
            </>
          ) : (
            `${quota.limit - after} left after this. Each slot frees ${quota.windowDays} days after you apply.`
          )}
        </span>
      </p>
    </div>
  );
}
