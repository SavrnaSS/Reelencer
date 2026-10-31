import Link from "next/link";

/** Shared dimensions keep route, identity and section loading states aligned with the payout workspace. */
export const PAYOUT_CARD_CLASS = "min-w-0 rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]";
export const PAYOUT_CONTAINER_CLASS = "mx-auto w-full max-w-[1440px] px-3.5 sm:px-5 md:px-6 lg:px-7 2xl:px-8";
export const PAYOUT_MAIN_CLASS = "mx-auto w-full max-w-[1440px] px-3.5 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 min-[380px]:px-4 sm:px-5 sm:pt-5 md:px-6 lg:px-7 xl:pt-7 2xl:px-8";
export const PAYOUT_GRID_CLASS = "mt-5 flex flex-col gap-4 sm:gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] lg:items-start";
export const PAYOUT_HEADER_INNER_CLASS = `${PAYOUT_CONTAINER_CLASS} flex h-[60px] items-center justify-between gap-3 md:h-[68px]`;

/** Decorative placeholders respect reduced-motion preferences and never announce invented amounts. */
export function Shimmer({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block max-w-full rounded-md bg-[#e8eee5] motion-safe:animate-pulse ${className}`} />;
}

function LoadingHeading({ action = false }: { action?: boolean }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <Shimmer className="h-4 w-32" />
      {action ? <Shimmer className="h-7 w-20 !rounded-full" /> : null}
    </div>
  );
}

export function WithdrawalScheduleLoading() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 divide-y divide-[#e8eee5] border-t border-[#e8eee5] bg-[#f8faf5] min-[440px]:grid-cols-2 min-[440px]:divide-x min-[440px]:divide-y-0">
      {[0, 1].map(index => (
        <div key={index} className="min-h-[112px] min-w-0 px-4 py-3.5 sm:px-6">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="mt-2 h-4 w-28" />
          <Shimmer className="mt-2 h-3 w-44" />
        </div>
      ))}
    </div>
  );
}

function BalanceLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-1 overflow-hidden`} aria-hidden="true">
      <div className="p-4 sm:p-6">
        <LoadingHeading action />
        <Shimmer className="mt-2 h-12 w-52 !rounded-lg sm:h-[60px]" />
        <Shimmer className="mt-2 h-4 w-36" />
        <div className="mt-5 flex min-h-[94px] items-start gap-3 rounded-lg border border-[#e8eee5] bg-[#fafbf8] p-3.5 min-[520px]:items-center">
          <Shimmer className="hidden h-9 w-9 shrink-0 !rounded-full min-[360px]:block" />
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-2.5 w-32" />
            <Shimmer className="h-4 w-44" />
            <Shimmer className="h-3 w-full" />
          </div>
          <Shimmer className="hidden h-10 w-24 shrink-0 !rounded-lg min-[520px]:block" />
        </div>
      </div>
      <WithdrawalScheduleLoading />
    </section>
  );
}

function ReadinessLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-2 p-4 sm:p-5`} aria-hidden="true">
      <LoadingHeading action />
      <div className="mt-3 grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map(index => <Shimmer key={index} className="h-1.5 !rounded-full" />)}
      </div>
      <div className="mt-3 grid gap-2">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className={`flex items-start gap-3 rounded-lg bg-[#f8faf5] px-3 py-3 ${index === 0 ? "min-h-[96px]" : "min-h-[64px]"}`}>
            <Shimmer className="mt-0.5 h-6 w-6 shrink-0 !rounded-full" />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <Shimmer className="h-3.5 w-40" />
              <Shimmer className="h-3 w-full" />
              {index === 0 ? <Shimmer className="h-3 w-3/4" /> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-3 p-4 sm:p-5`} aria-hidden="true">
      <LoadingHeading action />
      <Shimmer className="mt-1 h-3 w-56" />
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="min-w-0 rounded-lg border border-[#e8eee5] bg-[#f8faf5] p-3.5">
            <Shimmer className="h-3 w-20" />
            <Shimmer className="mt-3 h-6 w-28" />
            <Shimmer className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <Shimmer className="mt-3 h-3 w-full" />
      <Shimmer className="mt-2 h-3 w-3/4" />
    </section>
  );
}

function MethodLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-4 p-4 sm:p-5`} aria-hidden="true">
      <div className="flex min-h-[76px] items-start gap-3">
        <Shimmer className="h-11 w-11 shrink-0 !rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-5 w-36" />
          <Shimmer className="h-3 w-44" />
        </div>
      </div>
      <Shimmer className="mt-3 h-4 w-full" />
      <Shimmer className="mt-4 h-11 w-full !rounded-lg" />
    </section>
  );
}

/** Compact history rows can also fill a deferred history chunk inside the existing section. */
export function PayoutHistoryLoading({ rows = 2 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: Math.max(1, Math.min(4, rows)) }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-[#e1e8de] bg-white">
          <div className="p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Shimmer className="h-3 w-36" />
                <Shimmer className="mt-2 h-7 w-28" />
              </div>
              <Shimmer className="h-6 w-16 shrink-0 !rounded-full" />
            </div>
            <Shimmer className="mt-3 h-3 w-48" />
            <Shimmer className="mt-2 h-3 w-3/4" />
          </div>
          <div className="flex min-h-11 items-center justify-between border-t border-[#e9eee5] bg-[#f8faf6] px-3.5 sm:px-4">
            <Shimmer className="h-3 w-32" />
            <Shimmer className="h-3 w-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-5 p-4 sm:p-5`} aria-hidden="true">
      <LoadingHeading action />
      <Shimmer className="mt-1 h-3 w-56" />
      <div className="mt-4"><PayoutHistoryLoading /></div>
    </section>
  );
}

function GuidanceLoading() {
  return (
    <section className={`${PAYOUT_CARD_CLASS} order-6 p-4 sm:p-5`} aria-hidden="true">
      <LoadingHeading />
    </section>
  );
}

/** The same page frame and card order appear before JavaScript, during identity checks and while data loads. */
export default function PayoutsSkeleton() {
  return (
    <div data-payout-loading="true" className="min-h-screen bg-[#f3f4f1] text-[#1a201c] [font-family:var(--font-geist-sans)]">
      <p role="status" aria-live="polite" className="sr-only">Loading your payout workspace…</p>
      <header className="sticky top-0 z-20 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className={PAYOUT_HEADER_INNER_CLASS}>
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <Link href="/dashboard?section=wallet" aria-label="Back to Wallet" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e3e5e1] bg-white text-[#4b544e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 4-6 6 6 6" /></svg>
            </Link>
            <span aria-hidden="true" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe9da] bg-[linear-gradient(160deg,#f3f9ef,#e6f2e0)] text-[#2e7d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(34,45,37,0.06)] md:flex">
              <svg viewBox="0 0 20 20" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M3.5 6V4a1 1 0 0 1 1-1H15v3M3.5 6H16a1 1 0 0 1 1 1v9H4.5a1 1 0 0 1-1-1V6Z" /><path d="M13 9h4v4h-4V9Z" /></svg>
            </span>
            <div className="min-w-0">
              <div className="hidden truncate text-[11.5px] font-semibold text-[#7a877f] md:block">Wallet</div>
              <h1 className="truncate text-[16px] font-semibold text-[#20352c] md:text-[20px] md:leading-tight md:tracking-[-0.02em]">Payouts</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Shimmer className="h-10 w-10 !rounded-full sm:w-32" />
            <Link href="/dashboard?section=jobs" className="hidden h-10 items-center justify-center rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 sm:inline-flex">My jobs</Link>
          </div>
        </div>
      </header>
      <main className={PAYOUT_MAIN_CLASS} aria-busy="true">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Payouts</h2>
          <p className="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-[#616a64]">Withdraw from your wallet and manage where your payouts go.</p>
        </div>
        <div className={PAYOUT_GRID_CLASS}>
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            <BalanceLoading />
            <OverviewLoading />
            <HistoryLoading />
          </div>
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            <ReadinessLoading />
            <MethodLoading />
            <GuidanceLoading />
          </div>
        </div>
      </main>
    </div>
  );
}
