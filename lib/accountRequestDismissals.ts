import type { AccountRequestView } from "./accountRequests";

export const ACCOUNT_REQUEST_DISMISSAL_PREFIX = "reelencer:account-request-dismissals:v1:";
export const ACCOUNT_REQUEST_DISMISSAL_EVENT = "account-request-notice-dismissed";
export const MAX_ACCOUNT_REQUEST_DISMISSALS = 100;
export const EMPTY_ACCOUNT_REQUEST_DISMISSALS = "[]";

type Decision = Pick<AccountRequestView, "id" | "status" | "revision" | "reviewedAt" | "createdAt">;
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
type Options = { storage: () => StorageAccess | undefined; events: () => EventTarget | undefined };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestId = /^[\w-]{1,128}$/;

export function accountRequestDismissalStorageKey(userId: string | null) {
  return userId && uuid.test(userId) ? `${ACCOUNT_REQUEST_DISMISSAL_PREFIX}${userId.toLowerCase()}` : undefined;
}

/** A new revision or review is a new notice; other request states can never be dismissed. */
export function accountRequestDecisionKey(request: Decision) {
  if (request.status !== "rejected" || !requestId.test(request.id) || !Number.isSafeInteger(request.revision) || request.revision < 1) return undefined;
  const reviewedAt = Date.parse(request.reviewedAt ?? request.createdAt);
  return Number.isFinite(reviewedAt) ? JSON.stringify([request.id, request.revision, new Date(reviewedAt).toISOString()]) : undefined;
}

function isDecisionKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const parts = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 3 && typeof parts[0] === "string" && requestId.test(parts[0]) &&
      Number.isSafeInteger(parts[1]) && parts[1] >= 1 && typeof parts[2] === "string" &&
      Number.isFinite(Date.parse(parts[2])) && new Date(parts[2]).toISOString() === parts[2];
  } catch { return false; }
}

/** Device preferences contain only opaque request IDs, revisions and review dates. */
export function parseAccountRequestDismissals(raw: string | null | undefined): string[] {
  if (!raw || raw.length > 32_000) return [];
  try {
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values) ? [...new Set(values.filter(isDecisionKey))].slice(-MAX_ACCOUNT_REQUEST_DISMISSALS) : [];
  } catch { return []; }
}

export function createAccountRequestDismissalStore(options: Options) {
  const memory = new Map<string, { snapshot: string; dirty: boolean }>();
  const remember = (key: string, value: { snapshot: string; dirty: boolean }) => {
    memory.delete(key);
    memory.set(key, value);
    // An old user's durable flags remain in storage; only fallback memory is bounded here.
    if (memory.size > 8) memory.delete(memory.keys().next().value!);
  };

  const getSnapshot = (userId: string | null) => {
    const key = accountRequestDismissalStorageKey(userId);
    if (!key) return EMPTY_ACCOUNT_REQUEST_DISMISSALS;
    const fallback = memory.get(key);
    if (fallback?.dirty) return fallback.snapshot;
    try {
      const storage = options.storage();
      return storage ? JSON.stringify(parseAccountRequestDismissals(storage.getItem(key))) : fallback?.snapshot ?? EMPTY_ACCOUNT_REQUEST_DISMISSALS;
    } catch { return fallback?.snapshot ?? EMPTY_ACCOUNT_REQUEST_DISMISSALS; }
  };

  const dismiss = (userId: string | null, request: Decision) => {
    const key = accountRequestDismissalStorageKey(userId), decision = accountRequestDecisionKey(request);
    if (!key || !decision) return;
    const existing = parseAccountRequestDismissals(getSnapshot(userId));
    const snapshot = JSON.stringify([...existing.filter(value => value !== decision), decision].slice(-MAX_ACCOUNT_REQUEST_DISMISSALS));
    const fallback = { snapshot, dirty: true };
    remember(key, fallback);
    try {
      const storage = options.storage();
      if (storage) { storage.setItem(key, snapshot); fallback.dirty = false; }
    } catch { /* The current page still dismisses the notice when storage is blocked or full. */ }
    options.events()?.dispatchEvent(new Event(ACCOUNT_REQUEST_DISMISSAL_EVENT));
  };

  const subscribe = (userId: string | null, listener: () => void) => {
    const key = accountRequestDismissalStorageKey(userId), events = options.events();
    if (!key || !events) return () => {};
    const changed = () => listener();
    const stored = (event: Event) => {
      const changedKey = (event as StorageEvent).key;
      if (changedKey !== null && changedKey !== key) return;
      memory.delete(key);
      listener();
    };
    events.addEventListener(ACCOUNT_REQUEST_DISMISSAL_EVENT, changed);
    events.addEventListener("storage", stored);
    return () => {
      events.removeEventListener(ACCOUNT_REQUEST_DISMISSAL_EVENT, changed);
      events.removeEventListener("storage", stored);
    };
  };

  return { getSnapshot, dismiss, subscribe };
}

export const accountRequestDismissals = createAccountRequestDismissalStore({
  storage: () => typeof window === "undefined" ? undefined : window.localStorage,
  events: () => typeof window === "undefined" ? undefined : window,
});
