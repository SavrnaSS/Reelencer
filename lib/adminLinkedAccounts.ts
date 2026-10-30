"use client";

import { apiFetch } from "./api/client";
import { adminSessionCache } from "./adminSessionCache";
import { isCurrentAdminCacheIdentity } from "./adminCacheIdentity";
import { linkedAccountsData, type LinkedAccountsData } from "./linkedAccountCache";

/**
 * Every linked account with its reels and wallet state, as the admin console reads it. Shared by the Linked accounts
 * panel and the Workers directory (same cache key), so both show the same numbers from one read.
 */
export async function readAdminLinkedAccounts(adminId: string, signal: AbortSignal, sync = false): Promise<LinkedAccountsData> {
  const res = await apiFetch(`/api/social-accounts?scope=all${sync ? "&sync=1" : ""}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  const payload = await res.json().catch(() => null);
  if ((res.status === 401 || res.status === 403) && !signal.aborted && isCurrentAdminCacheIdentity(adminId)) {
    adminSessionCache.clear(adminId);
    window.dispatchEvent(new Event("admin-auth-invalidated"));
  }
  if (!res.ok) throw Object.assign(new Error(payload?.error || "Linked accounts couldn't be refreshed."), { unavailable: payload?.code === "schema_outdated" });
  return linkedAccountsData(payload);
}
