"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminSessionCache, type AdminCachePolicy } from "./adminSessionCache";
import { isCurrentAdminCacheIdentity } from "./adminCacheIdentity";

type RefreshOptions = { force?: boolean; afterCurrent?: boolean };

/** Reuses reviewed admin reads immediately and refreshes stale values in the background. */
export function useAdminCachedResource<T>({
  scope,
  key,
  load,
  enabled = true,
  ttlMs = 30_000,
  maxAgeMs = 15 * 60_000,
  persist = false,
  validate,
}: {
  scope: string | null | undefined;
  key: string;
  load: (signal: AbortSignal) => Promise<T>;
  enabled?: boolean;
} & AdminCachePolicy) {
  const active = Boolean(enabled && scope && isCurrentAdminCacheIdentity(scope));
  const loader = useRef(load);
  const validator = useRef(validate);
  const mounted = useRef(false);
  const currentIdentity = useRef({ scope, key });
  const [response, setResponse] = useState<{ scope: string; key: string; data: T; updatedAt: number } | null>(null);
  useSyncExternalStore(adminSessionCache.subscribe, adminSessionCache.getRevision, () => 0);
  useEffect(() => { loader.current = load; }, [load]);
  useEffect(() => { validator.current = validate; }, [validate]);
  useEffect(() => {
    mounted.current = true;
    currentIdentity.current = { scope, key };
    return () => { mounted.current = false; };
  }, [scope, key]);

  const refresh = useCallback(async ({ force = true, afterCurrent = false }: RefreshOptions = {}) => {
    if (!enabled || !scope || !isCurrentAdminCacheIdentity(scope)) return;
    try {
      const readResource = loader.current;
      const validateResource = validator.current;
      const data = await adminSessionCache.load(scope, key, readResource, { ttlMs, maxAgeMs, persist, force, afterCurrent, validate: validateResource });
      if (mounted.current && currentIdentity.current.scope === scope && currentIdentity.current.key === key) {
        setResponse(adminSessionCache.read(scope, key, { ttlMs, maxAgeMs, validate: validateResource }) ? null : { scope, key, data, updatedAt: Date.now() });
      }
      return data;
    } catch {
      // The cache retains the last good value and exposes non-cancellation errors.
      return undefined;
    }
  }, [enabled, scope, key, ttlMs, maxAgeMs, persist]);

  useEffect(() => {
    if (active) void refresh({ force: false });
    // A shared read can finish and warm the cache when this section unmounts.
    // The authenticated shell clears/aborts all reads on sign-out or account changes.
  }, [active, refresh]);

  const update = useCallback((next: T | ((previous: T | undefined) => T)) => {
    // A mutation finishing after navigation/sign-out must not repopulate a disposed admin's cache.
    if (!enabled || !scope || !isCurrentAdminCacheIdentity(scope) || !mounted.current || currentIdentity.current.scope !== scope || currentIdentity.current.key !== key) return;
    const previous = adminSessionCache.read<T>(scope, key, { ttlMs, maxAgeMs, validate: validator.current });
    const value = typeof next === "function" ? (next as (previous: T | undefined) => T)(previous?.data) : next;
    if (validator.current && !validator.current(value)) return;
    const cached = adminSessionCache.write(scope, key, value, { persist, validate: validator.current });
    setResponse(cached ? null : { scope, key, data: value, updatedAt: Date.now() });
  }, [enabled, scope, key, ttlMs, maxAgeMs, persist]);
  const invalidate = useCallback(() => {
    if (scope) adminSessionCache.invalidate(scope, key);
  }, [scope, key]);

  const cached = active && scope ? adminSessionCache.read<T>(scope, key, { ttlMs, maxAgeMs, validate }) : null;
  const status = active && scope ? adminSessionCache.status(scope, key) : { loading: false, error: null };
  const fallback = active && response && response.scope === scope && response.key === key ? response : null;
  const data = cached?.data ?? fallback?.data;
  const hasData = cached !== null || fallback !== null;
  return {
    data,
    loading: active && !hasData && !status.error,
    refreshing: hasData && status.loading,
    error: status.error,
    stale: cached?.stale ?? Boolean(fallback),
    updatedAt: cached?.updatedAt ?? fallback?.updatedAt ?? null,
    refresh,
    update,
    invalidate,
  };
}
