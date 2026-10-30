import type { LinkedSocialAccount } from "./socialAnalytics";
import { readProfileHealth } from "./accountProfileHealth";
import { readSocialAccountWalletCredits, readSocialPostWalletCredit } from "./socialWallet";

export const LINKED_ACCOUNTS_CACHE_KEY = "linked-accounts:v2";
export const LINKED_SYNC_CACHE_KEY = "linked-accounts-sync:v2";
export const LINKED_SYNC_ATTEMPT_KEY = "linked-accounts-sync-attempt:v1";
export const LINKED_ACCOUNTS_FRESH_MS = 30_000;
export const LINKED_SYNC_INTERVAL_MS = 30_000;

export type LinkedAccountsData = { accounts: LinkedSocialAccount[]; screenshotReader: boolean };
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (row: Row, keys: string[]) => keys.every(key => typeof row[key] === "string");
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const metrics = ["followers", "following", "posts", "reach", "impressions", "profileViews", "engagements", "linkClicks"];
const postMetrics = ["views", "reach", "likes", "comments", "shares", "saves"];
const source = (value: unknown) => ["manual", "api", "screenshot", "profile"].includes(String(value));
const numbers = (row: Row, keys: string[]) => keys.every(key => row[key] === undefined || (typeof row[key] === "number" && Number.isFinite(row[key])));

export function isLinkedAccountsData(value: unknown): value is LinkedAccountsData {
  if (!record(value) || !Array.isArray(value.accounts) || typeof value.screenshotReader !== "boolean") return false;
  return value.accounts.every(account => {
    if (!record(account) || !strings(account, ["id", "applicationId", "gigId", "workerCode", "platform", "handle", "profileUrl", "linkedAt"]) || !["active", "paused", "unlinked"].includes(String(account.status))) return false;
    if (account.profileHealth !== undefined && !readProfileHealth(account.profileHealth)) return false;
    if (account.walletCredits !== undefined && !readSocialAccountWalletCredits(account.walletCredits)) return false;
    if (!record(account.sync) || typeof account.sync.available !== "boolean" || !["pending", "ok", "error", "unsupported", "not_configured"].includes(String(account.sync.status))) return false;
    if (!Array.isArray(account.snapshots) || !Array.isArray(account.posts)) return false;
    return account.snapshots.every(snapshot => record(snapshot) && strings(snapshot, ["id", "capturedAt"]) && typeof snapshot.periodDays === "number" && Number.isFinite(snapshot.periodDays) && source(snapshot.source) && numbers(snapshot, metrics))
      && account.posts.every(post => record(post) && strings(post, ["id", "url", "updatedAt", "createdAt"]) && ["submitted", "approved", "rejected"].includes(String(post.status)) && typeof post.submittedByWorker === "boolean" && source(post.source) && numbers(post, postMetrics) && (post.walletCredit === undefined || !!readSocialPostWalletCredit(post.walletCredit)));
  });
}

/** Review the shape and allowlist fields before an API response can enter browser storage. */
export function linkedAccountsData(value: unknown): LinkedAccountsData {
  if (!record(value) || !Array.isArray(value.accounts)) throw new Error("Linked accounts returned an unreadable response. Please retry.");
  const data = {
    screenshotReader: value.screenshotReader === true,
    accounts: value.accounts.map(account => {
      if (!record(account) || !record(account.sync) || !Array.isArray(account.snapshots) || !Array.isArray(account.posts)) throw new Error("Linked accounts returned an unreadable response. Please retry.");
      return {
        ...pick(account, ["id", "applicationId", "gigId", "gigTitle", "company", "workerCode", "platform", "handle", "profileUrl", "status", "linkedAt", "payout", "payoutType"]),
        ...(account.walletCredits !== undefined ? { walletCredits: readSocialAccountWalletCredits(account.walletCredits) } : {}),
        ...(readProfileHealth(account.profileHealth) ? { profileHealth: readProfileHealth(account.profileHealth) } : {}),
        sync: pick(account.sync, ["available", "status", "lastSyncedAt", "lastAttemptAt", "nextSyncAt", "inProgress", "consecutiveFailures", "provider", "errorCode", "error"]),
        snapshots: account.snapshots.map(snapshot => {
          if (!record(snapshot)) throw new Error("Invalid account snapshot.");
          return pick(snapshot, ["id", "capturedAt", "periodDays", ...metrics, "source", "note"]);
        }),
        posts: account.posts.map(post => {
          if (!record(post)) throw new Error("Invalid account post.");
          return { ...pick(post, ["id", "url", "caption", "postedAt", ...postMetrics, "viewsCapturedAt", "viewsSource", "updatedAt", "status", "submittedByWorker", "reviewNote", "reviewedAt", "createdAt", "source", "removedAt", "removalReason", "removedSilently"]), ...(post.walletCredit !== undefined ? { walletCredit: readSocialPostWalletCredit(post.walletCredit) } : {}) };
        }),
      };
    }),
  };
  if (!isLinkedAccountsData(data)) throw new Error("Linked accounts returned an unreadable response. Please retry.");
  return data;
}

export function linkedSyncDue(lastAttempt: number | undefined, now: number, force = false) {
  return force || !lastAttempt || !Number.isFinite(lastAttempt) || lastAttempt > now || now - lastAttempt >= LINKED_SYNC_INTERVAL_MS;
}

export function isLinkedSyncAttempt(value: unknown): value is { at: number } {
  return record(value) && typeof value.at === "number" && Number.isFinite(value.at);
}
