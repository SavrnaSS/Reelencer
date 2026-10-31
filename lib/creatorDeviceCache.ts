import { createAdminSessionCache } from "./adminSessionCache";
import { linkedAccountsData, type LinkedAccountsData } from "./linkedAccountCache";
import { countedReels } from "./reelTracking";

export const CREATOR_CACHE_PREFIX = "reelencer:creator-cache:v1:";
export const CREATOR_CACHE_OWNER = "reelencer:creator-cache-owner:v1";
export const CREATOR_CACHE_CLEARED = "creator-cache-cleared";
export const CREATOR_CACHE_MAX_AGE = 24 * 60 * 60_000;
export const CREATOR_CACHE_POLICY = { persist: true, ttlMs: 20_000, maxAgeMs: CREATOR_CACHE_MAX_AGE };

/** Private read models stay on this device, never in request cookies or a shared HTTP cache. */
export const creatorDeviceCache = createAdminSessionCache({
  now: () => Date.now(),
  storage: () => typeof window === "undefined" ? undefined : window.localStorage,
  storagePrefix: CREATOR_CACHE_PREFIX, maxAgeLimitMs: CREATOR_CACHE_MAX_AGE,
  maxEntries: 8, maxEntryBytes: 1_000_000, maxBytes: 3_000_000,
});

let owner: string | null = null;
let generation = 0;
export const creatorCacheIdentity = () => owner;
export const creatorCacheGeneration = () => generation;
export const isCreatorCacheIdentity = (scope: string, revision = generation) => owner === scope && generation === revision;

/** Call only after obtaining the current Supabase session; display storage never grants access. */
export function bindCreatorCacheIdentity(scope: string) {
  if (typeof window === "undefined" || !scope) return;
  let savedOwner: string | null = null;
  try { savedOwner = window.localStorage.getItem(CREATOR_CACHE_OWNER); } catch { /* Memory fallback. */ }
  if ((owner && owner !== scope) || (savedOwner && savedOwner !== scope)) {
    creatorDeviceCache.clear();
    generation++;
  }
  owner = scope;
  try {
    window.localStorage.setItem(CREATOR_CACHE_OWNER, scope);
    // Old application storage was shared by every account on the device. Never restore it.
    window.localStorage.removeItem("igops:gig-apps");
  } catch { /* Device storage is optional. */ }
}

export function clearCreatorDeviceCache() {
  generation++;
  owner = null;
  creatorDeviceCache.clear();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CREATOR_CACHE_OWNER);
    window.localStorage.removeItem("igops:gig-apps");
  } catch { /* Memory and pending reads are still cleared. */ }
  window.dispatchEvent(new Event(CREATOR_CACHE_CLEARED));
}

/** Another tab changed identity: discard this user's data without deleting the new user's cache. */
export function detachCreatorCacheIdentity(notify = true) {
  const previous = owner;
  generation++;
  owner = null;
  if (previous) creatorDeviceCache.clear(previous);
  if (notify && typeof window !== "undefined") window.dispatchEvent(new Event(CREATOR_CACHE_CLEARED));
}

export function readCreatorCache<T>(scope: string, key: string) {
  return isCreatorCacheIdentity(scope) ? creatorDeviceCache.read<T>(scope, key, CREATOR_CACHE_POLICY) : null;
}

export function writeCreatorCache(scope: string, key: string, value: unknown) {
  return isCreatorCacheIdentity(scope) && creatorDeviceCache.write(scope, key, value, CREATOR_CACHE_POLICY);
}

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const pick = (value: unknown, fields: string[]) => {
  const source = row(value);
  return Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
};

export type DashboardCollections<G = Row, A = Row, S = Row, P = Row> = { gigs: G[]; applications: A[]; assignments: S[]; payoutBatches: P[] };
export type DashboardSnapshot<G = Row, A = Row, S = Row, P = Row> = DashboardCollections<G, A, S, P> & { userId: string; workerId: string | null; etag?: string };

/** Explicitly persist display data; profile documents, payment addresses and signed media never enter it. */
export function dashboardSnapshot(value: unknown): DashboardSnapshot {
  const v = row(value);
  if (typeof v.userId !== "string" || !["gigs", "applications", "assignments", "payoutBatches"].every(key => Array.isArray(v[key]))) throw new Error("Dashboard data is incomplete.");
  const applications = (v.applications as unknown[]).map(value => {
    const app = pick(value, ["id", "gigId", "workerId", "status", "appliedAt", "decidedAt", "workerName"]);
    const proposal = pick(row(value).proposal, ["pitch", "approach", "timeline", "budget", "portfolio", "submittedAt", "reviewStatus", "applicationMode", "source", "consentAcceptedAt", "consentText", "adminNote", "adminExplanation", "whatsappLink", "onboardingSteps", "groupJoinedConfirmed", "groupJoinedConfirmedAt", "reviewedAt"]);
    const setup = pick(row(row(value).proposal).accountSetup, ["platform", "handle", "profileUrl", "notes", "hasPassword", "verifyCode", "ownership", "ownershipDetail", "checkedAt", "followers", "posts", "isPrivate", "status", "revision", "submittedAt", "reviewNote", "reviewedAt"]);
    if (Object.keys(setup).length) proposal.accountSetup = { ...setup, email: "" };
    if (Object.keys(proposal).length) app.proposal = proposal;
    return app;
  });
  const result: DashboardSnapshot = {
    userId: v.userId, workerId: typeof v.workerId === "string" ? v.workerId : null,
    gigs: (v.gigs as unknown[]).map(value => pick(value, ["id", "title", "company", "verified", "platform", "location", "workload", "payout", "payoutType", "gigType", "requirements", "applicationMode", "status", "postedAt", "browsePinned", "browsePinRank", "browsePinLabel", "feedPosition", "newCreatorHold"])),
    applications,
    assignments: (v.assignments as unknown[]).map(value => pick(value, ["id", "gigId", "workerId", "assignedEmail", "assignedEmails", "status", "submittedAt", "decidedAt", "createdAt", "earningsReleaseStatus", "earningsReleasedAt"])),
    payoutBatches: (v.payoutBatches as unknown[]).map(value => ({ ...pick(value, ["id", "cycleLabel", "periodStart", "periodEnd", "status", "createdAt", "processedAt", "paidAt", "method"]), items: Array.isArray(row(value).items) ? (row(value).items as unknown[]).map(item => pick(item, ["id", "workItemId", "workItemPublicId", "handle", "amountINR", "status", "sourceAssignmentId"])) : [] })),
    ...(typeof v.etag === "string" ? { etag: v.etag } : {}),
  };
  if (![result.gigs, result.applications, result.assignments, result.payoutBatches].every(items => items.every(item => typeof item.id === "string"))) throw new Error("Dashboard data is unreadable.");
  return result;
}

export function patchCachedDashboard(scope: string, patch: Partial<DashboardCollections>) {
  // A confirmed mutation makes any older dashboard read obsolete.
  generation++;
  const previous = readCreatorCache<DashboardSnapshot>(scope, "dashboard");
  if (previous) writeCreatorCache(scope, "dashboard", dashboardSnapshot({ ...previous.data, ...patch, etag: undefined }));
}

export type CreatorAccountData = LinkedAccountsData & { accountIssues: LinkedAccountsData["accounts"]; statsEnabled: boolean };
/** Creator account data from the API or this device's cache. Reels from before linking are dropped here too, so
 *  data cached before that rule existed never shows them. */
export function creatorAccountData(value: unknown): CreatorAccountData {
  const v = row(value);
  const linked = linkedAccountsData(v);
  const issues = linkedAccountsData({ accounts: Array.isArray(v.accountIssues) ? v.accountIssues : [], screenshotReader: false }).accounts;
  const trackedOnly = <T extends { posts: Array<{ postedAt?: string }>; linkedAt: string }>(account: T): T => ({ ...account, posts: countedReels(account.posts, account.linkedAt) });
  return { ...linked, accounts: linked.accounts.map(trackedOnly), accountIssues: issues.map(trackedOnly), statsEnabled: v.statsEnabled !== false };
}

export function creatorProfileData(value: unknown): Row {
  const v = row(value);
  if (typeof v.id !== "string" || typeof v.name !== "string") throw new Error("Profile data is unreadable.");
  return {
    ...pick(v, ["id", "workerId", "userId", "name", "email", "headline", "city", "bio", "active", "assignedAccountIds"]),
    assignedAccounts: Array.isArray(v.assignedAccounts) ? v.assignedAccounts.map(value => pick(value, ["id", "handle", "niche", "ownerTeam", "policyTier", "health"])) : [],
  };
}

export function creatorVideoData(value: unknown) {
  return value === null ? null : pick(value, ["name", "uploadedAt", "mimeType", "size"]);
}
