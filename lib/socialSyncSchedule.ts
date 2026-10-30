import { accountPlatformFor } from "./accountSetup";
import type { LinkedSocialAccount, SyncState } from "./socialAnalytics";

export const PROFILE_SYNC_INTERVAL_MS = 5 * 60_000;
export const API_SYNC_INTERVAL_MS = 30 * 60_000;
export const SYNC_LEASE_MS = 120_000;
export type SyncErrorCode = "login_required" | "rate_limited" | "not_found" | "credentials" | "timeout" | "unavailable";

export class SocialSyncError extends Error {
  constructor(message: string, public code: SyncErrorCode = "unavailable", public retryAfterMs = 0) { super(message); }
}

/** Explicit absence of the requested profile, never an individual post or a permission error. */
export class ProfileNotFoundError extends SocialSyncError {
  constructor(message: string) { super(message, "not_found"); }
}

export function syncInterval(platform: string) {
  return accountPlatformFor(platform).id === "instagram" ? PROFILE_SYNC_INTERVAL_MS : API_SYNC_INTERVAL_MS;
}

/** Instagram cadence by the age of the newest tracked reel: views move fastest in a reel's first days. */
/**
 * When a successfully synced account is next due: its own schedule, but never later than the slowest normal
 * cadence after the last success (so an odd schedule can't make old numbers look current).
 */
export function syncDueAt(platform: string, lastSyncedAt: string, nextSyncAt?: string | null) {
  const instagram = accountPlatformFor(platform).id === "instagram";
  const latest = Date.parse(lastSyncedAt) + (instagram ? QUIET_PROFILE_SYNC_INTERVAL_MS : API_SYNC_INTERVAL_MS);
  const scheduled = Date.parse(String(nextSyncAt ?? ""));
  return Number.isFinite(scheduled) ? Math.min(scheduled, latest) : Date.parse(lastSyncedAt) + syncInterval(platform);
}

export const HOT_REEL_SYNC_INTERVAL_MS = 2 * 60_000;
export const QUIET_PROFILE_SYNC_INTERVAL_MS = 15 * 60_000;
export function adaptiveSyncInterval(platform: string, newestPostAt: number | undefined, now = Date.now()) {
  if (accountPlatformFor(platform).id !== "instagram") return API_SYNC_INTERVAL_MS;
  if (newestPostAt === undefined) return PROFILE_SYNC_INTERVAL_MS;
  const age = now - newestPostAt;
  if (age <= 3 * 86_400_000) return HOT_REEL_SYNC_INTERVAL_MS;
  if (age <= 14 * 86_400_000) return PROFILE_SYNC_INTERVAL_MS;
  return QUIET_PROFILE_SYNC_INTERVAL_MS;
}

export function classifySyncError(error: unknown): SyncErrorCode {
  if (error instanceof SocialSyncError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (/429|limited|too many|quota/i.test(message)) return "rate_limited";
  if (/redirect|login|log in|readable counts/i.test(message)) return "login_required";
  if (/not found|404|No YouTube channel/i.test(message)) return "not_found";
  if (/token|permission|credential|API key/i.test(message)) return "credentials";
  if (/time|respond|reached|abort/i.test(message)) return "timeout";
  return "unavailable";
}

/** Bounded exponential retries, with stable per-account jitter to spread platform traffic. */
export function retryDelayMs(code: SyncErrorCode, failures: number, id: string, retryAfterMs = 0) {
  const base = code === "rate_limited" || code === "login_required" ? 30 * 60_000
    : code === "credentials" || code === "not_found" ? 60 * 60_000 : 2 * 60_000;
  const exponential = Math.min(6 * 3_600_000, base * 2 ** Math.min(7, Math.max(0, failures - 1)));
  const hash = Array.from(id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return Math.max(Math.min(24 * 3_600_000, Math.max(0, retryAfterMs)), exponential + hash % Math.min(60_000, base / 5));
}

export function storedSyncState(row: Record<string, unknown>, available = true): SyncState {
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
  const status = ["pending", "ok", "error", "unsupported", "not_configured"].includes(String(row.sync_status)) ? row.sync_status as SyncState["status"] : "pending";
  return {
    available, status,
    lastSyncedAt: date(row.last_synced_at),
    lastAttemptAt: date(row.last_sync_attempt_at),
    nextSyncAt: row.status === "active" ? date(row.next_sync_at) : undefined,
    inProgress: row.status === "active" && (Date.parse(String(row.sync_locked_until)) || 0) > Date.now(),
    consecutiveFailures: Number(row.sync_failures) || 0,
    provider: typeof row.sync_provider === "string" && row.sync_provider ? row.sync_provider as SyncState["provider"] : undefined,
    errorCode: status === "error" ? row.sync_error_code as SyncErrorCode : undefined,
    error: status === "error" && row.sync_error ? String(row.sync_error) : undefined,
  };
}

/** Shared, honest status for both dashboards: a failed attempt never looks like a successful refresh. */
export function syncPresentation(account: Pick<LinkedSocialAccount, "status" | "platform" | "sync" | "profileHealth">, now = Date.now()) {
  const { sync } = account;
  if (account.profileHealth?.status === "missing") return { label: "Profile verification needed", tone: "warning" as const };
  if (account.profileHealth?.status === "suspected") return { label: "Rechecking profile", tone: "warning" as const };
  if (account.status !== "active") return { label: account.status === "paused" ? "Paused" : "Unlinked", tone: "neutral" as const };
  if (!sync.available) return { label: sync.status === "not_configured" ? "Connection needed" : "Manual updates", tone: "neutral" as const };
  if (sync.inProgress && (!sync.lastAttemptAt || now - Date.parse(sync.lastAttemptAt) < SYNC_LEASE_MS)) return { label: "Syncing", tone: "progress" as const };
  if (sync.status === "error") return { label: sync.errorCode === "login_required" ? "Access limited" : sync.errorCode === "credentials" ? "Connection needs attention" : "Retry scheduled", tone: "warning" as const };
  if (!sync.lastSyncedAt) return { label: "Queued for sync", tone: "progress" as const };
  // The account's own schedule decides when it's due (fresh reels are checked more often than quiet profiles).
  const stale = now > syncDueAt(account.platform, sync.lastSyncedAt, sync.nextSyncAt) + 120_000;
  return { label: stale ? "Update due" : "Up to date", tone: stale ? "warning" as const : "success" as const };
}
