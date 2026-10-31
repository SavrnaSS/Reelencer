"use client";

import type { KycState } from "./KycPanel";

const when = (value?: string | null) => {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/* ------------------------------------------------------------------ */
/* Checklist row                                                       */
/* ------------------------------------------------------------------ */

const STEPS = ["Submitted", "In review", "Approved"];
/** Reviewer reasons are often fragments ("Document is blurry or cropped"); end them before adding more text. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Live KYC row: mini tracker, timing, rejection reason and the one action that fits the state. */
/**
 * `need`: KYC becomes required (and blocks every payout) once the wallet has received more than `limitLabel` in
 * total; before that the row reads as optional and shows how much has been earned so far.
 */
export function KycRow({ kyc, highlighted, live, onOpen, need }: {
  kyc: KycState; highlighted: boolean; live: boolean; onOpen: () => void;
  need?: { required: boolean; limitLabel: string; earnedLabel?: string };
}) {
  const { status } = kyc;
  const optional = status !== "approved" && need !== undefined && !need.required;
  const step = status === "approved" ? 3 : status === "pending" ? 1 : status === "rejected" ? 1 : -1;
  const tone =
    status === "approved"
      ? { row: "bg-[#f4f8f0]", icon: "bg-[#8db35a] text-white" }
      : status === "rejected"
        ? optional
          ? { row: "bg-[#fffaf0] ring-1 ring-inset ring-[#f1dea6]", icon: "border-2 border-[#e0c98a] bg-white text-[#8a5a00]" }
          : { row: "bg-[#fdf2f1] ring-1 ring-inset ring-[#f6cdc8]", icon: "border-2 border-[#e8a39b] bg-white text-[#b42318]" }
        : status === "pending"
          ? { row: "bg-[#f1f6fc] ring-1 ring-inset ring-[#cfe0f5]", icon: "bg-white text-[#1f5fa8] ring-2 ring-[#9cc1ea]" }
          : optional
            ? { row: "bg-[#f8faf5]", icon: "border-2 border-[#cfd8ca] bg-white text-[#5f6f65]" }
            : { row: highlighted ? "bg-[#fffaf0] ring-1 ring-inset ring-[#f1dea6]" : "bg-[#f8faf5]", icon: "border-2 border-[#e0c98a] bg-white text-[#8a5a00]" };
  const title = status === "approved" ? "Identity verified (KYC)" : status === "pending" ? "KYC in review" : status === "rejected" ? "KYC needs a correction" : optional ? "Identity check (KYC)" : "Verify your identity (KYC)";
  const detail =
    status === "approved"
      ? `Approved${kyc.reviewedAt ? ` ${when(kyc.reviewedAt)}` : ""}. Withdrawals of any amount are unlocked.`
      : status === "pending"
        ? `Submitted ${when(kyc.submittedAt) ?? "recently"}. ${live ? "This updates the moment the team decides." : "We'll check for the decision automatically."}`
        : status === "rejected"
          ? `${sentence(kyc.reason || "Update your details and resubmit.")}${optional ? ` Payouts continue until your earnings pass ${need.limitLabel}.` : " Payouts are paused until it's approved."}`
          : optional
            ? `Needed once your earnings pass ${need.limitLabel}${need.earnedLabel ? ` (${need.earnedLabel} so far)` : ""}. Verify now so payouts never pause.`
            : `Your earnings have passed ${need?.limitLabel ?? "the KYC limit"}, so payouts are paused until you verify. Takes about 2 minutes: your details, an ID photo and a selfie.`;
  const action = status === "approved" ? null : status === "pending" ? "View" : status === "rejected" ? "Fix & resubmit" : "Verify now";

  return (
    <li className={`rounded-lg px-3 py-2.5 transition ${tone.row}`}>
      <div className="flex items-start gap-3">
        <span className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone.icon}`} aria-hidden>
          {status === "approved" ? (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          ) : status === "pending" ? (
            <>
              <span className="absolute inset-0 rounded-full bg-[#9cc1ea] opacity-40 motion-safe:animate-ping" />
              <svg viewBox="0 0 20 20" className="relative h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M10 6v4l2.5 1.5" />
              </svg>
            </>
          ) : (
            <span className="text-[12px] font-black leading-none">!</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="sr-only">{status === "approved" ? "Done: " : "To do: "}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[14px] font-semibold">{title}</span>
            {optional ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#5f6f65] ring-1 ring-inset ring-[#dfe7dc]">
                Optional until {need.limitLabel}
              </span>
            ) : null}
          </span>
          <span className={`block break-words text-[12px] leading-5 ${status === "rejected" && !optional ? "text-[#8e1f1a]" : "text-[#5f6f65]"}`}>{detail}</span>
        </span>
        {action ? (
          <button
            type="button"
            onClick={onOpen}
            className={`mt-0.5 inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full px-3 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]/50 ${
              status === "pending" ? "border border-[#cfe0f5] bg-white text-[#1f5fa8] hover:bg-[#f5f9fe]" : optional ? "border border-[#dfe7dc] bg-white text-[#41695b] hover:bg-[#f4f7f1]" : "bg-[#1f2b24] text-white hover:bg-[#2b3a31]"
            }`}
          >
            {action} {status !== "pending" ? <span aria-hidden>→</span> : null}
          </button>
        ) : null}
      </div>
      {/* Tracker: shown once there's a submission. */}
      {status !== "none" ? (
        <ol className="mt-2.5 grid grid-cols-3 gap-1.5 pl-9" aria-label="KYC progress">
          {STEPS.map((label, index) => {
            const done = index < step || (status === "approved" && index === 2);
            const current = index === step && status !== "approved";
            const failed = status === "rejected" && index === 1;
            return (
              <li key={label} className="min-w-0">
                <span
                  className={`block h-1 rounded-full transition-colors duration-500 ${
                    failed ? "bg-[#e8a39b]" : done ? "bg-[#8db35a]" : current ? "bg-[#9cc1ea] motion-safe:animate-pulse" : "bg-[#e6ebe2]"
                  }`}
                />
                <span className={`mt-1 block truncate text-[10.5px] ${done || current || failed ? "font-semibold text-[#4d5f55]" : "text-[#9aa29c]"}`} aria-current={current ? "step" : undefined}>
                  {failed ? "Needs fix" : label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </li>
  );
}
