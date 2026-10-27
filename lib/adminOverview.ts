export const ADMIN_OVERVIEW_CACHE_KEY = "overview-counts:v1";

export type AdminOverviewCounts = {
  linkedAccounts: number;
  pendingClaims: number;
  pendingWithdrawals: number;
  pendingPayouts: number;
};

/** Unknown or incomplete totals must never be displayed as zero. */
export function isAdminOverviewCounts(value: unknown): value is AdminOverviewCounts {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<keyof AdminOverviewCounts, unknown>;
  return [row.linkedAccounts, row.pendingClaims, row.pendingWithdrawals, row.pendingPayouts].every(count => Number.isSafeInteger(count) && Number(count) >= 0)
    && row.pendingPayouts === Number(row.pendingClaims) + Number(row.pendingWithdrawals);
}
