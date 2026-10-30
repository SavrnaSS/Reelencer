import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_CACHE_STORAGE_PREFIX, createAdminSessionCache, type AdminCacheStorage } from "../../lib/adminSessionCache";

class MemoryStorage implements AdminCacheStorage {
  values = new Map<string, string>();
  unavailable = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { if (this.unavailable) throw new Error("Storage disabled"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.unavailable) throw new Error("Quota exceeded"); this.values.set(key, value); }
  removeItem(key: string) { if (this.unavailable) throw new Error("Storage disabled"); this.values.delete(key); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("admin reads reuse fresh session data, show stale data, and expire it within the hard lifetime", () => {
  let time = 100_000;
  const cache = createAdminSessionCache({ now: () => time });
  cache.write("admin-a", "accounts", { count: 13 });
  assert.deepEqual(cache.read("admin-a", "accounts"), { data: { count: 13 }, updatedAt: time, stale: false });
  assert.equal(cache.read("admin-b", "accounts"), null);
  time += 30_000;
  assert.equal(cache.read("admin-a", "accounts")?.stale, true);
  time += 15 * 60_000;
  assert.equal(cache.read("admin-a", "accounts"), null);
  cache.write("admin-a", "accounts", { count: 12 });
  time += 31 * 60_000;
  assert.equal(cache.read("admin-a", "accounts", { maxAgeMs: Infinity }), null);
});

test("only explicitly persisted reads survive a reload and remain isolated to their admin", () => {
  const storage = new MemoryStorage();
  const first = createAdminSessionCache({ storage, now: () => 100 });
  first.write("admin-a", "accounts", { count: 13 }, { persist: true });
  first.write("admin-a", "requests", { count: 2 });
  const reloaded = createAdminSessionCache({ storage, now: () => 200 });
  assert.deepEqual(reloaded.read("admin-a", "accounts")?.data, { count: 13 });
  assert.equal(reloaded.read("admin-a", "requests"), null);
  assert.equal(reloaded.read("admin-b", "accounts"), null);
  assert.equal(reloaded.read("", "accounts"), null);
});

test("persisted cache rejects malformed, old-version, expired, future, and forged identity data", () => {
  for (const change of [
    () => "not-json",
    (entry: Record<string, unknown>) => JSON.stringify({ ...entry, version: 99 }),
    (entry: Record<string, unknown>) => JSON.stringify({ ...entry, scope: "another-admin" }),
    (entry: Record<string, unknown>) => JSON.stringify({ ...entry, updatedAt: -1_000_000 }),
    (entry: Record<string, unknown>) => JSON.stringify({ ...entry, updatedAt: 1_000_000 }),
    (entry: Record<string, unknown>) => JSON.stringify({ ...entry, data: { password: "private" } }),
  ]) {
    const storage = new MemoryStorage();
    const cache = createAdminSessionCache({ storage, now: () => 960_000 });
    cache.write("admin", "accounts", { count: 13 }, { persist: true });
    const [key, raw] = [...storage.values][0];
    storage.values.set(key, change(JSON.parse(raw)));
    const reload = createAdminSessionCache({ storage, now: () => 100_000 });
    assert.equal(reload.read("admin", "accounts"), null);
    assert.equal(storage.values.has(key), false);
  }
});

test("secrets, KYC documents, signed links, cyclic data, and oversized responses are never cached", () => {
  const storage = new MemoryStorage();
  const cache = createAdminSessionCache({ storage, maxEntryBytes: 600 });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const unsafe: unknown[] = [
    { nested: { password: "private" } },
    { accountSetup: { passwordEnc: "enc:v1:private" } },
    { social_password: "private" },
    { value_enc: "enc:v1:private" },
    { access_token: "private" },
    { refreshToken: "private" },
    { credentials: [{ username: "person" }] },
    { kyc: { document: "private" } },
    { image: "https://example.test/object?X-Amz-Signature=private" },
    { image: "https://example.test/storage?token=private" },
    { body: "x".repeat(400) },
    cycle,
  ];
  for (const data of unsafe) assert.equal(cache.write("admin", "accounts", data, { persist: true }), false);
  assert.equal(cache.read("admin", "accounts"), null);
  assert.equal(storage.length, 0);
  assert.equal(cache.write("admin", "safe", { hasPassword: true, secretLast4: "1234", profileUrl: "https://instagram.com/person", optional: undefined }, { persist: true }), true);
  assert.equal(storage.length, 1);
});

test("a resource shape validator discards valid JSON that is not a usable read model", async () => {
  const storage = new MemoryStorage();
  const cache = createAdminSessionCache({ storage });
  const validate = (data: unknown) => Boolean(data && typeof data === "object" && Array.isArray((data as { accounts?: unknown }).accounts));
  assert.equal(cache.write("admin", "accounts", { wrong: "shape" }, { persist: true, validate }), false);
  cache.write("admin", "accounts", { wrong: "shape" }, { persist: true });
  const reloaded = createAdminSessionCache({ storage });
  assert.equal(reloaded.read("admin", "accounts", { validate }), null);
  assert.equal(storage.length, 0);
  assert.equal(cache.read("admin", "accounts", { validate }), null);
  assert.equal(cache.write("admin", "accounts", { accounts: [] }, { persist: true, validate }), true);
  assert.deepEqual(cache.read("admin", "accounts", { validate })?.data, { accounts: [] });
  await assert.rejects(cache.load("admin", "accounts", async () => ({ wrong: "shape" }), { force: true, validate }), /invalid shape/);
  assert.deepEqual(cache.read("admin", "accounts", { validate })?.data, { accounts: [] });
});

test("bounded cache eviction affects only its own storage and unavailable storage falls back to memory", () => {
  const storage = new MemoryStorage();
  storage.values.set("supabase-auth", "untouched");
  let time = 1;
  const cache = createAdminSessionCache({ storage, now: () => time++, maxEntries: 2 });
  for (const key of ["one", "two", "three"]) cache.write("admin", key, { key }, { persist: true });
  assert.equal(cache.read("admin", "one"), null);
  assert.ok(cache.read("admin", "two"));
  assert.ok(cache.read("admin", "three"));
  assert.equal(storage.length, 3);
  assert.equal(storage.getItem("supabase-auth"), "untouched");
  storage.unavailable = true;
  assert.equal(cache.write("admin", "offline-storage", { count: 13 }, { persist: true }), true);
  assert.deepEqual(cache.read("admin", "offline-storage")?.data, { count: 13 });
  assert.doesNotThrow(() => cache.clear());
  assert.equal(cache.read("admin", "offline-storage"), null);
});

test("persistence and memory respect a combined size budget", () => {
  const storage = new MemoryStorage();
  let time = 0;
  const cache = createAdminSessionCache({ storage, now: () => time++, maxBytes: 1_500 });
  for (const key of ["one", "two", "three"]) cache.write("admin", key, { text: "x".repeat(220) }, { persist: true });
  const storedBytes = [...storage.values.values()].reduce((sum, value) => sum + value.length * 2, 0);
  assert.ok(storedBytes <= 1_500);
  assert.equal(cache.read("admin", "one"), null);
  assert.ok(cache.read("admin", "three"));
});

test("identical loads share one request while independent resources proceed concurrently", async () => {
  const cache = createAdminSessionCache();
  const pending = deferred<{ count: number }>();
  let reads = 0;
  const loader = async () => { reads++; return pending.promise; };
  const first = cache.load("admin", "accounts", loader);
  const duplicate = cache.load("admin", "accounts", loader);
  const other = await cache.load("admin", "integrations", async () => ({ ready: true }));
  assert.deepEqual(other, { ready: true });
  assert.equal(reads, 1);
  assert.equal(first, duplicate);
  pending.resolve({ count: 13 });
  assert.deepEqual(await first, { count: 13 });
  await cache.load("admin", "accounts", async () => { reads++; return { count: 14 }; });
  assert.equal(reads, 1);
  await cache.load("admin", "accounts", async () => { reads++; return { count: 14 }; }, { force: true });
  assert.equal(reads, 2);
  assert.deepEqual(cache.read("admin", "accounts")?.data, { count: 14 });
});

test("refresh failures retain useful data and allow an immediate retry", async () => {
  const cache = createAdminSessionCache();
  cache.write("admin", "accounts", { count: 13 });
  const failure = new Error("Network unavailable");
  await assert.rejects(cache.load("admin", "accounts", async () => { throw failure; }, { force: true }), /Network unavailable/);
  assert.deepEqual(cache.read("admin", "accounts")?.data, { count: 13 });
  assert.equal(cache.status("admin", "accounts").error, failure);
  assert.equal(cache.status("admin", "accounts").loading, false);
  await cache.load("admin", "accounts", async () => ({ count: 14 }), { force: true });
  assert.equal(cache.status("admin", "accounts").error, null);
});

test("confirmed mutations cancel older reads and suppress their queued refresh", async () => {
  const storage = new MemoryStorage();
  const cache = createAdminSessionCache({ storage });
  const pending = deferred<{ status: string }>();
  let signal!: AbortSignal;
  let queuedCalls = 0;
  const old = cache.load("admin", "accounts", abortSignal => { signal = abortSignal; return pending.promise; }, { persist: true });
  const queued = cache.load("admin", "accounts", async () => { queuedCalls++; return { status: "old" }; }, { afterCurrent: true });
  await Promise.resolve();
  cache.write("admin", "accounts", { status: "approved" }, { persist: true });
  assert.equal(signal.aborted, true);
  pending.resolve({ status: "pending" });
  await assert.rejects(old, { name: "AbortError" });
  await assert.rejects(queued, { name: "AbortError" });
  assert.equal(queuedCalls, 0);
  assert.deepEqual(cache.read("admin", "accounts")?.data, { status: "approved" });
  const reloaded = createAdminSessionCache({ storage });
  assert.deepEqual(reloaded.read("admin", "accounts")?.data, { status: "approved" });
});

test("a manual account sync keeps its newer count when an older collection sync finishes later", async () => {
  const storage = new MemoryStorage();
  const cache = createAdminSessionCache({ storage });
  const accountsKey = "linked-accounts:v2";
  const syncKey = "linked-accounts-sync:v2";
  const pending = deferred<{ accounts: { id: string; views: number }[] }>();
  let signal!: AbortSignal;
  cache.write("admin", accountsKey, { accounts: [{ id: "reel-account", views: 913 }] }, { persist: true });
  const background = cache.load("admin", syncKey, abortSignal => { signal = abortSignal; return pending.promise; });
  const applyBackground = background.then(data => cache.write("admin", accountsKey, data, { persist: true }));
  const cancelled = assert.rejects(applyBackground, { name: "AbortError" });
  await Promise.resolve();

  // LinkedAccountsPanel invalidates the separate collection-sync read before applying Sync now's result.
  cache.invalidate("admin", syncKey);
  cache.write("admin", accountsKey, { accounts: [{ id: "reel-account", views: 2017 }] }, { persist: true });
  assert.equal(signal.aborted, true);
  pending.resolve({ accounts: [{ id: "reel-account", views: 921 }] });
  await cancelled;

  assert.deepEqual(cache.read("admin", accountsKey)?.data, { accounts: [{ id: "reel-account", views: 2017 }] });
  assert.deepEqual(createAdminSessionCache({ storage }).read("admin", accountsKey)?.data, { accounts: [{ id: "reel-account", views: 2017 }] });
  assert.equal(cache.status("admin", accountsKey).error, null);
});

test("a cancelled collection read cannot clear or replace its newer replacement request", async () => {
  const cache = createAdminSessionCache();
  const key = "linked-accounts-sync:v2";
  const oldResult = deferred<{ views: number }>();
  const newResult = deferred<{ views: number }>();
  const old = cache.load("admin", key, () => oldResult.promise);
  const cancelled = assert.rejects(old, { name: "AbortError" });
  await Promise.resolve();
  cache.invalidate("admin", key);
  const current = cache.load("admin", key, () => newResult.promise);
  await Promise.resolve();
  oldResult.resolve({ views: 921 });
  await cancelled;
  assert.equal(cache.status("admin", key).loading, true);
  newResult.resolve({ views: 2017 });
  assert.deepEqual(await current, { views: 2017 });
  assert.deepEqual(cache.read("admin", key)?.data, { views: 2017 });
  assert.equal(cache.status("admin", key).loading, false);
});

test("live invalidations coalesce into one follow-up read after the current request", async () => {
  const cache = createAdminSessionCache();
  const pending = deferred<{ count: number }>();
  let reads = 0;
  const first = cache.load("admin", "accounts", () => pending.promise);
  const latest = async () => { reads++; return { count: 14 }; };
  const second = cache.load("admin", "accounts", latest, { afterCurrent: true });
  const third = cache.load("admin", "accounts", latest, { afterCurrent: true });
  assert.equal(second, third);
  pending.resolve({ count: 13 });
  await Promise.all([first, second, third]);
  assert.equal(reads, 1);
  assert.deepEqual(cache.read("admin", "accounts")?.data, { count: 14 });
});

test("invalidation preserves stale rows in memory but prevents a reload resurrecting old fresh data", () => {
  const storage = new MemoryStorage();
  const cache = createAdminSessionCache({ storage });
  cache.write("admin", "accounts", { count: 13 }, { persist: true });
  const reloaded = createAdminSessionCache({ storage });
  reloaded.invalidate("admin", "accounts");
  assert.equal(reloaded.read("admin", "accounts")?.stale, true);
  assert.deepEqual(reloaded.read("admin", "accounts")?.data, { count: 13 });
  assert.equal(createAdminSessionCache({ storage }).read("admin", "accounts"), null);
});

test("account changes and sign-out remove private cache data without touching unrelated storage", async () => {
  const storage = new MemoryStorage();
  storage.setItem("app-preference", "compact");
  const cache = createAdminSessionCache({ storage });
  cache.write("admin-a", "accounts", { count: 13 }, { persist: true });
  cache.write("admin-b", "accounts", { count: 1 }, { persist: true });
  const pending = deferred<{ count: number }>();
  const old = cache.load("admin-a", "accounts", () => pending.promise, { force: true, persist: true });
  await Promise.resolve();
  cache.clear("admin-a");
  pending.resolve({ count: 20 });
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(cache.read("admin-a", "accounts"), null);
  assert.deepEqual(cache.read("admin-b", "accounts")?.data, { count: 1 });
  cache.clear();
  assert.equal(cache.read("admin-b", "accounts"), null);
  assert.equal([...storage.values.keys()].some(key => key.startsWith(ADMIN_CACHE_STORAGE_PREFIX)), false);
  assert.equal(storage.getItem("app-preference"), "compact");
});

test("oversized successful reads remain usable by the caller without being retained", async () => {
  const cache = createAdminSessionCache({ maxEntryBytes: 100 });
  const large = { content: "x".repeat(100) };
  assert.deepEqual(await cache.load("admin", "accounts", async () => large), large);
  assert.equal(cache.read("admin", "accounts"), null);
  assert.equal(cache.status("admin", "accounts").error, null);
});
