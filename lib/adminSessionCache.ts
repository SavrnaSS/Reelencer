/**
 * A small cache for explicitly reviewed, non-secret admin read models. The caller
 * must supply the authenticated admin ID; neither authorization nor API tokens
 * belong in this cache. Persistence lasts only for this browser tab's session.
 */
export const ADMIN_CACHE_STORAGE_PREFIX = "reelencer:admin-cache:v1:";

export interface AdminCacheStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type AdminCachePolicy = { ttlMs?: number; maxAgeMs?: number; persist?: boolean; validate?: (data: unknown) => boolean };
export type AdminCacheValue<T> = { data: T; updatedAt: number; stale: boolean };
type Entry = { version: 1; scope: string; key: string; data: unknown; updatedAt: number; invalidated: boolean };
type Running = { controller: AbortController; promise: Promise<unknown> };

const DEFAULT_TTL = 30_000;
const DEFAULT_MAX_AGE = 15 * 60_000;
const MAX_AGE = 30 * 60_000;
const SECRET_FIELD = /^(?:password|passwordConfirmation|passwordHash|password_hash|passwordEnc|password_enc|passwordEncrypted|password_encrypted|encryptedPassword|encrypted_password|socialPassword|social_password|value_enc|secret|secret_enc|accessToken|access_token|refreshToken|refresh_token|authorization|cookie|cookies|credentials|kyc|kycDocuments|kyc_documents|signedUrl|signed_url|privateKey|private_key|apiKey|api_key)$/i;
const SIGNED_QUERY = /[?&](?:token|access_token|signature|sig|x-amz-[^=&#]+|x-goog-[^=&#]+|awsaccesskeyid)=/i;

function safeData(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (value === undefined) return true;
  if (value === null || typeof value === "boolean" || typeof value === "number") return typeof value !== "number" || Number.isFinite(value);
  if (typeof value === "string") return !SIGNED_QUERY.test(value);
  if (Array.isArray(value)) return value.every(item => safeData(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => key !== "__proto__" && key !== "constructor" && !SECRET_FIELD.test(key) && safeData(item, depth + 1));
}

function cacheAbort(): Error {
  const error = new Error("Admin read cancelled");
  error.name = "AbortError";
  return error;
}

export function createAdminSessionCache({
  storage,
  now = Date.now,
  maxEntries = 24,
  maxEntryBytes = 400_000,
  maxBytes = 2_000_000,
}: {
  storage?: AdminCacheStorage | (() => AdminCacheStorage | undefined);
  now?: () => number;
  maxEntries?: number;
  maxEntryBytes?: number;
  maxBytes?: number;
} = {}) {
  const entries = new Map<string, Entry>();
  const running = new Map<string, Running>();
  const queued = new Map<string, Promise<unknown>>();
  const errors = new Map<string, Error>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const idFor = (scope: string, key: string) => `${scope}\0${key}`;
  const storageKey = (scope: string, key: string) => `${ADMIN_CACHE_STORAGE_PREFIX}${encodeURIComponent(scope)}:${encodeURIComponent(key)}`;
  const getStorage = () => { try { return typeof storage === "function" ? storage() : storage; } catch { return undefined; } };
  const emit = () => { revision++; listeners.forEach(listener => listener()); };
  const removeStored = (scope: string, key: string) => { try { getStorage()?.removeItem(storageKey(scope, key)); } catch { /* Storage may be unavailable in private browsing. */ } };
  const keys = () => {
    const result: string[] = [];
    try {
      const target = getStorage();
      if (target) for (let index = 0; index < target.length; index++) {
        const key = target.key(index);
        if (key?.startsWith(ADMIN_CACHE_STORAGE_PREFIX)) result.push(key);
      }
    } catch { /* Keep the in-memory cache available. */ }
    return result;
  };
  const abort = (id: string) => { running.get(id)?.controller.abort(); running.delete(id); queued.delete(id); };
  const policyFor = (policy: AdminCachePolicy) => {
    const maxAge = Math.min(MAX_AGE, Math.max(0, Number.isFinite(policy.maxAgeMs) ? policy.maxAgeMs! : DEFAULT_MAX_AGE));
    return { maxAge, ttl: Math.min(maxAge, Math.max(0, Number.isFinite(policy.ttlMs) ? policy.ttlMs! : DEFAULT_TTL)) };
  };
  const pruneMemory = () => {
    let bytes = 0;
    const sizes = new Map<string, number>();
    for (const [id, entry] of entries) { const size = JSON.stringify(entry).length * 2; sizes.set(id, size); bytes += size; }
    for (const [id, entry] of [...entries].sort((a, b) => a[1].updatedAt - b[1].updatedAt)) {
      if (entries.size <= maxEntries && bytes <= maxBytes) break;
      entries.delete(id);
      removeStored(entry.scope, entry.key);
      bytes -= sizes.get(id) ?? 0;
    }
  };
  const persist = (entry: Entry) => {
    const target = getStorage();
    if (!target) return;
    const serialized = JSON.stringify(entry);
    if (serialized.length * 2 > maxBytes) { removeStored(entry.scope, entry.key); return; }
    try {
      // Only this namespace is ever evicted, leaving auth and other app storage intact.
      const stored = keys().map(key => {
        try {
          const raw = target.getItem(key);
          const parsed = raw && JSON.parse(raw);
          return { key, bytes: (raw?.length ?? 0) * 2, at: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : 0 };
        } catch { return { key, bytes: 0, at: 0 }; }
      }).filter(item => item.key !== storageKey(entry.scope, entry.key)).sort((a, b) => a.at - b.at);
      let bytes = stored.reduce((sum, item) => sum + item.bytes, serialized.length * 2);
      while (stored.length >= maxEntries || bytes > maxBytes) {
        const oldest = stored.shift();
        if (!oldest) break;
        target.removeItem(oldest.key);
        bytes -= oldest.bytes;
      }
      target.setItem(storageKey(entry.scope, entry.key), serialized);
    } catch {
      // Quota failure must never turn an otherwise successful API read into an error.
      removeStored(entry.scope, entry.key);
    }
  };
  const commit = <T>(scope: string, key: string, data: T, policy: AdminCachePolicy): boolean => {
    if (!scope || !key) return false;
    let serialized: string;
    try {
      if (!safeData(data) || (policy.validate && !policy.validate(data))) return false;
      serialized = JSON.stringify(data);
      if (serialized.length * 2 > maxEntryBytes || serialized.length * 2 > maxBytes) return false;
    } catch { return false; }
    // Round-tripping keeps callers from mutating a cached response after it was stored.
    const entry: Entry = { version: 1, scope, key, data: JSON.parse(serialized), updatedAt: now(), invalidated: false };
    entries.set(idFor(scope, key), entry);
    errors.delete(idFor(scope, key));
    if (policy.persist) persist(entry);
    else removeStored(scope, key);
    pruneMemory();
    return true;
  };
  const read = <T>(scope: string, key: string, policy: AdminCachePolicy = {}): AdminCacheValue<T> | null => {
    if (!scope || !key) return null;
    const id = idFor(scope, key);
    let entry = entries.get(id);
    if (!entry) {
      try {
        const serialized = getStorage()?.getItem(storageKey(scope, key));
        if (serialized) {
          if (serialized.length * 2 > maxEntryBytes + 2_000) throw new Error("Oversized cache");
          const parsed: unknown = JSON.parse(serialized);
          if (!parsed || typeof parsed !== "object") throw new Error("Invalid cache");
          const candidate = parsed as Entry;
          if (candidate.version !== 1 || candidate.scope !== scope || candidate.key !== key || !Number.isFinite(candidate.updatedAt) || typeof candidate.invalidated !== "boolean" || !safeData(candidate.data)) throw new Error("Invalid cache");
          entry = candidate;
          entries.set(id, entry);
          pruneMemory();
        }
      } catch { removeStored(scope, key); }
    }
    if (!entry) return null;
    const age = now() - entry.updatedAt;
    const { maxAge, ttl } = policyFor(policy);
    let validShape = false;
    try { validShape = !policy.validate || policy.validate(entry.data); } catch { /* Invalid read models are discarded. */ }
    if (!validShape || age < -60_000 || age >= maxAge) {
      entries.delete(id);
      removeStored(scope, key);
      return null;
    }
    return { data: entry.data as T, updatedAt: entry.updatedAt, stale: entry.invalidated || age >= ttl };
  };
  const write = <T>(scope: string, key: string, data: T, policy: AdminCachePolicy = {}): boolean => {
    abort(idFor(scope, key));
    const result = commit(scope, key, data, policy);
    emit();
    return result;
  };
  const invalidate = (scope: string, key: string) => {
    const id = idFor(scope, key);
    // Hydrate before marking stale, so a later remount cannot resurrect a fresh persisted entry.
    read(scope, key);
    abort(id);
    const entry = entries.get(id);
    if (entry) entry.invalidated = true;
    removeStored(scope, key);
    errors.delete(id);
    emit();
  };
  const clear = (scope?: string) => {
    for (const [id, entry] of entries) if (!scope || entry.scope === scope) entries.delete(id);
    for (const id of running.keys()) if (!scope || id.startsWith(`${scope}\0`)) abort(id);
    for (const id of errors.keys()) if (!scope || id.startsWith(`${scope}\0`)) errors.delete(id);
    const target = getStorage();
    for (const key of keys()) if (!scope || key.startsWith(`${ADMIN_CACHE_STORAGE_PREFIX}${encodeURIComponent(scope)}:`)) {
      try { target?.removeItem(key); } catch { /* The memory cache is still cleared. */ }
    }
    emit();
  };
  const load = <T>(scope: string, key: string, loader: (signal: AbortSignal) => Promise<T>, policy: AdminCachePolicy & { force?: boolean; afterCurrent?: boolean } = {}): Promise<T> => {
    if (!scope || !key) return Promise.reject(new Error("A verified admin is required before loading cached data"));
    const id = idFor(scope, key);
    const previous = running.get(id);
    if (previous) {
      if (!policy.afterCurrent) return previous.promise as Promise<T>;
      const waiting = queued.get(id);
      if (waiting) return waiting as Promise<T>;
      const next = previous.promise.catch(() => undefined).then(() => {
        if (queued.get(id) === next) queued.delete(id);
        if (previous.controller.signal.aborted) throw cacheAbort();
        return load(scope, key, loader, { ...policy, force: true, afterCurrent: false });
      });
      queued.set(id, next);
      return next;
    }
    const cached = read<T>(scope, key, policy);
    if (!policy.force && cached && !cached.stale) return Promise.resolve(cached.data);
    const controller = new AbortController();
    const request: Running = { controller, promise: Promise.resolve() };
    request.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw cacheAbort();
      return loader(controller.signal);
    }).then(data => {
      // A confirmed mutation, sign-out, or identity change wins over an older GET.
      if (controller.signal.aborted || running.get(id) !== request) throw cacheAbort();
      if (policy.validate && !policy.validate(data)) throw new Error("Admin data response has an invalid shape");
      // An oversized or unreviewed response still reaches its current caller;
      // it simply cannot be reused by another panel or persisted to storage.
      commit(scope, key, data, policy);
      return data;
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && running.get(id) === request) errors.set(id, error instanceof Error ? error : new Error("Admin data could not be loaded"));
      throw error;
    }).finally(() => {
      if (running.get(id) === request) { running.delete(id); emit(); }
    });
    running.set(id, request);
    errors.delete(id);
    emit();
    return request.promise as Promise<T>;
  };
  return {
    read, write, invalidate, clear, load,
    status: (scope: string, key: string) => ({ loading: running.has(idFor(scope, key)), error: errors.get(idFor(scope, key)) ?? null }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRevision: () => revision,
  };
}

export const adminSessionCache = createAdminSessionCache({
  storage: () => typeof window === "undefined" ? undefined : window.sessionStorage,
});
