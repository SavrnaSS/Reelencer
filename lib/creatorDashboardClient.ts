"use client";

import { apiFetch } from "./api/client";
import { creatorCacheGeneration, dashboardSnapshot, isCreatorCacheIdentity, readCreatorCache, writeCreatorCache, type DashboardCollections, type DashboardSnapshot } from "./creatorDeviceCache";

type Result = { userId: string; workerId: string | null; data: Partial<DashboardCollections>; errors: string[]; checkedAt: number };
const requests = new Map<string, { promise: Promise<Result>; revision: number }>();

/** Polls, realtime notifications and section changes share one request; mutations can queue a fresh follow-up. */
export function fetchCreatorDashboard(scope: string, afterCurrent = false): Promise<Result> {
  const revision = creatorCacheGeneration();
  const previous = requests.get(scope);
  if (previous && previous.revision === revision) {
    if (!afterCurrent) return previous.promise;
    return previous.promise.catch(() => undefined).then(() => fetchCreatorDashboard(scope));
  }
  const pending = { revision, promise: Promise.resolve(null as unknown as Result) };
  pending.promise = (async () => {
    const cached = readCreatorCache<DashboardSnapshot>(scope, "dashboard");
    const response = await apiFetch("/api/dashboard", {
      signal: AbortSignal.timeout(20_000),
      headers: cached?.data.etag && !afterCurrent ? { "If-None-Match": cached.data.etag } : undefined,
    });
    if (!isCreatorCacheIdentity(scope, revision)) throw new DOMException("Session changed", "AbortError");
    if (response.status === 304 && cached) {
      writeCreatorCache(scope, "dashboard", cached.data);
      return { userId: scope, workerId: cached.data.workerId, data: cached.data, errors: [], checkedAt: Date.now() };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.userId !== scope || !payload?.data || !Array.isArray(payload.errors)) throw new Error(payload?.error || "Your dashboard could not be refreshed.");
    if (!isCreatorCacheIdentity(scope, revision)) throw new DOMException("Session changed", "AbortError");
    const result: Result = { userId: scope, workerId: payload.workerId ?? null, data: payload.data, errors: payload.errors, checkedAt: Date.now() };
    if (!result.errors.length) writeCreatorCache(scope, "dashboard", dashboardSnapshot({ ...payload.data, userId: scope, workerId: result.workerId, etag: response.headers.get("etag") ?? undefined }));
    return result;
  })().finally(() => { if (requests.get(scope) === pending) requests.delete(scope); });
  requests.set(scope, pending);
  return pending.promise;
}
