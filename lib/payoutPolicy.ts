// Keep the database request_payout minimum in sync when changing this policy.
export const MIN_PAYOUT_REQUEST_INR = 500;

// KYC becomes mandatory once a creator's wallet has received more than this in total (every approved credit,
// including money already paid out). From then on every payout is blocked until KYC is approved.
// Keep payout_kyc_required (202610310004_kyc_after_1000_earned.sql) in sync.
export const KYC_FREE_WITHDRAWAL_LIMIT_INR = 1000;

/** Whether payouts are blocked until KYC is approved, from the creator's lifetime wallet credits. */
export function payoutKycRequired(kycApproved: boolean, lifetimeCreditedINR: number) {
  return !kycApproved && Math.round(lifetimeCreditedINR * 100) > KYC_FREE_WITHDRAWAL_LIMIT_INR * 100;
}

// Creators can request a withdrawal themselves once every 7 days; on top of that, whatever is withdrawable is
// requested automatically once a month, on the creator's chosen day (1–28, default the 1st, India time).
// Keep request_payout and auto_request_payouts (202610310002_payout_cadence.sql) in sync.
export const MANUAL_WITHDRAWAL_INTERVAL_DAYS = 7;
export const DEFAULT_AUTO_WITHDRAWAL_DAY = 1;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** The monthly auto-withdrawal day stored in the UPI settings (older weekly settings use the default day). */
export function autoWithdrawalDay(schedule?: string | null, day?: string | null) {
  const value = Number(day);
  return schedule === "Monthly" && Number.isInteger(value) && value >= 1 && value <= 28 ? value : DEFAULT_AUTO_WITHDRAWAL_DAY;
}

/** When the next manual request is allowed, or null when it's allowed now. */
export function nextManualWithdrawalAt(lastManualRequestAt?: string | null, now = Date.now()) {
  const last = Date.parse(String(lastManualRequestAt ?? ""));
  if (!Number.isFinite(last)) return null;
  const next = last + MANUAL_WITHDRAWAL_INTERVAL_DAYS * DAY_MS;
  return next > now ? new Date(next) : null;
}

/**
 * The next automatic withdrawal date (midnight India time, as a UTC instant). The job runs hourly from the chosen
 * day until a cycle is created, so if this month's run is still due and the day has passed, it is today. A date
 * before auto-withdrawal was switched on (`since`) is skipped, as in auto_request_payouts.
 */
export function nextAutoWithdrawalAt(day: number, autoDoneThisMonth: boolean, now = Date.now(), since?: string | null) {
  const local = new Date(now + IST_OFFSET_MS);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), today = local.getUTCDate();
  const at = (year: number, month: number, date: number) => new Date(Date.UTC(year, month, date) - IST_OFFSET_MS);
  const sinceMs = Date.parse(String(since ?? ""));
  // Midnight India time on the day it was switched on: this month's date counts if it isn't earlier.
  const sinceDay = Number.isFinite(sinceMs) ? (() => { const d = new Date(sinceMs + IST_OFFSET_MS); return at(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime(); })() : -Infinity;
  if (!autoDoneThisMonth && at(y, m, day).getTime() >= sinceDay) return today >= day ? at(y, m, today) : at(y, m, day);
  return at(y, m + 1, day);
}
