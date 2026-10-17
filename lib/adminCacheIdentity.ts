import { adminSessionCache } from "./adminSessionCache";
import { clearAdminPreferences } from "./adminPreferences";

const OWNER_KEY = "reelencer:admin-cache-owner:v1";
let owner: string | null = null;

export function isCurrentAdminCacheIdentity(scope: string) {
  return owner === scope;
}

/** Run after role verification, and immediately when an existing session ends or changes user. */
export function bindAdminCacheIdentity(next: string | null) {
  if (typeof window === "undefined") return;
  try { owner = window.sessionStorage.getItem(OWNER_KEY) ?? owner; } catch { /* Memory-only mode. */ }
  if (!next || (owner && owner !== next)) {
    adminSessionCache.clear();
    clearAdminPreferences();
  }
  owner = next;
  try {
    if (next) window.sessionStorage.setItem(OWNER_KEY, next);
    else window.sessionStorage.removeItem(OWNER_KEY);
  } catch { /* Caching still works in memory when storage is blocked. */ }
}
