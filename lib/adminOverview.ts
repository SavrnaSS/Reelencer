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

export const ACTIVITY_PERIODS = [7, 30, 90] as const;
export type ActivityPeriod = typeof ACTIVITY_PERIODS[number];
export type ActivityKind = "signup" | "application" | "reel" | "claim" | "withdrawal";
export type ActivitySummary = { activeUsers: number; newUsers: number; applications: number; reels: number; claims: number; withdrawals: number; actions: number };
export type ActivityDay = ActivitySummary & { date: string };
export type AdminActivity = {
  generatedAt: string;
  timezone: "Asia/Kolkata";
  period: { days: ActivityPeriod; start: string; end: string };
  totalUsers: number;
  counts: AdminOverviewCounts;
  summary: ActivitySummary;
  previous: ActivitySummary;
  queues: { applications: number; identityChecks: number; reels: number; profiles: number; claims: number; withdrawals: number };
  days: ActivityDay[];
  recent: Array<{ id: string; kind: ActivityKind; userName: string; workerCode: string; at: string }>;
};
const countKeys = ["activeUsers", "newUsers", "applications", "reels", "claims", "withdrawals", "actions"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const isoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isSummary = (value: unknown): value is ActivitySummary => isRecord(value) && countKeys.every(key => isCount(value[key]))
  && value.actions === Number(value.applications) + Number(value.reels) + Number(value.claims) + Number(value.withdrawals);

/** Validate cached analytics before displaying them; days are ordered, contiguous and cover the selected period. */
export function isAdminActivity(value: unknown): value is AdminActivity {
  if (!isRecord(value) || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt)) || value.timezone !== "Asia/Kolkata"
    || !isRecord(value.period) || !ACTIVITY_PERIODS.includes(value.period.days as ActivityPeriod) || !isoDay(value.period.start) || !isoDay(value.period.end)
    || !isCount(value.totalUsers) || !isAdminOverviewCounts(value.counts) || !isSummary(value.summary) || !isSummary(value.previous)
    || !isRecord(value.queues) || !["applications", "identityChecks", "reels", "profiles", "claims", "withdrawals"].every(key => isCount((value.queues as Record<string, unknown>)[key]))
    || !Array.isArray(value.days) || value.days.length !== value.period.days || !Array.isArray(value.recent) || value.recent.length > 8) return false;
  const start = Date.parse(`${value.period.start}T00:00:00Z`);
  if (value.days.some((day, index) => !isRecord(day) || day.date !== new Date(start + index * 86_400_000).toISOString().slice(0, 10) || !isSummary(day))) return false;
  if (value.days.at(-1)?.date !== value.period.end) return false;
  return value.recent.every(event => isRecord(event) && typeof event.id === "string" && ["signup", "application", "reel", "claim", "withdrawal"].includes(String(event.kind))
    && typeof event.userName === "string" && event.userName.length <= 200 && typeof event.workerCode === "string" && typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)));
}

/** Expose an aggregate identity-check count, never a KYC record, in the reviewed browser read model. */
export function adminActivityResponse(value: unknown): AdminActivity | null {
  if (!isRecord(value) || !isRecord(value.queues)) return null;
  const queues = value.queues;
  const data = { ...value, queues: {
    applications: queues.applications, identityChecks: queues.kyc,
    reels: queues.reels, profiles: queues.profiles, claims: queues.claims, withdrawals: queues.withdrawals,
  } };
  return isAdminActivity(data) ? data : null;
}

export function activityChange(current: number, previous: number): { label: string; direction: "up" | "down" | "flat" } {
  if (current === previous) return { label: "No change", direction: "flat" };
  if (previous === 0) return { label: "New activity", direction: "up" };
  const percent = Math.round(Math.abs(current - previous) / previous * 100);
  return { label: `${percent}%`, direction: current > previous ? "up" : "down" };
}

export function activityCsv(data: AdminActivity) {
  return ["Date (IST),Active users,New users,Applications,Reel submissions,Earnings claims,Withdrawals,Actions", ...data.days.map(day =>
    [day.date, day.activeUsers, day.newUsers, day.applications, day.reels, day.claims, day.withdrawals, day.actions].join(","))].join("\r\n");
}
