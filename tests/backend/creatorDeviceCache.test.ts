import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bindCreatorCacheIdentity, clearCreatorDeviceCache, CREATOR_CACHE_MAX_AGE, CREATOR_CACHE_OWNER, CREATOR_CACHE_POLICY, creatorAccountData, creatorCacheGeneration, creatorDeviceCache, creatorProfileData, creatorVideoData, dashboardSnapshot, detachCreatorCacheIdentity, isCreatorCacheIdentity, patchCachedDashboard, readCreatorCache, writeCreatorCache } from "../../lib/creatorDeviceCache";

class Storage {
  values = new Map<string, string>();
  blocked = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { if (this.blocked) throw new Error("Unavailable"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.blocked) throw new Error("Quota"); this.values.set(key, value); }
  removeItem(key: string) { if (this.blocked) throw new Error("Unavailable"); this.values.delete(key); }
}
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNow = Date.now;
let storage: Storage;
let now: number;
beforeEach(() => {
  storage = new Storage(); now = 10_000_000;
  Object.defineProperty(globalThis, "window", { value: Object.assign(new EventTarget(), { localStorage: storage }), configurable: true });
  Date.now = () => now;
  clearCreatorDeviceCache();
});
afterEach(() => {
  clearCreatorDeviceCache(); Date.now = originalNow;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const snapshot = () => dashboardSnapshot({ userId: "creator-a", workerId: "WKR-A", gigs: [{ id: "gig", title: "Reaction video", requirements: [] }], applications: [{ id: "application", status: "Accepted", proposal: { accountSetup: { handle: "creator", status: "Verified", passwordEnc: "private", email: "private@example.test" } } }], assignments: [], payoutBatches: [{ id: "batch", status: "Paid", bankAccount: "private", items: [{ id: "item", amountINR: 49, status: "Paid" }] }] });

test("saved dashboard data survives a reload, remains user-scoped and expires without extending on reads", () => {
  bindCreatorCacheIdentity("creator-a");
  writeCreatorCache("creator-a", "dashboard", snapshot());
  const saved = readCreatorCache("creator-a", "dashboard")!;
  assert.ok(saved);
  now += 60_000;
  assert.equal(readCreatorCache("creator-a", "dashboard")?.updatedAt, saved.updatedAt);
  assert.equal(readCreatorCache("creator-a", "dashboard")?.stale, true);
  assert.equal(readCreatorCache("creator-b", "dashboard"), null);
  now += CREATOR_CACHE_MAX_AGE;
  assert.equal(readCreatorCache("creator-a", "dashboard"), null);
});

test("only reviewed display fields persist; financial totals survive while login details and documents do not", () => {
  bindCreatorCacheIdentity("creator-a");
  assert.equal(writeCreatorCache("creator-a", "dashboard", snapshot()), true);
  const saved = JSON.stringify(readCreatorCache("creator-a", "dashboard")?.data);
  assert.ok(!saved.includes("private"));
  assert.ok(!saved.includes("passwordEnc"));
  assert.ok(!saved.includes("bankAccount"));
  assert.ok(saved.includes('"amountINR":49'));
  assert.equal(writeCreatorCache("creator-a", "bad", { access_token: "secret" }), false);
  assert.equal(writeCreatorCache("creator-a", "media", { previewUrl: "https://storage.example/file?token=secret" }), false);
});

test("switching accounts and signing out remove the previous user's saved data and fence late responses", async () => {
  storage.setItem("igops:gig-apps", "old unscoped data");
  bindCreatorCacheIdentity("creator-a");
  assert.equal(storage.getItem("igops:gig-apps"), null);
  writeCreatorCache("creator-a", "dashboard", snapshot());
  const revision = creatorCacheGeneration();
  let finish!: (value: { accounts: never[] }) => void;
  const pending = creatorDeviceCache.load("creator-a", "accounts", () => new Promise<{ accounts: never[] }>(resolve => { finish = resolve; }), { ...CREATOR_CACHE_POLICY, force: true });
  await Promise.resolve();
  bindCreatorCacheIdentity("creator-b");
  assert.equal(isCreatorCacheIdentity("creator-a", revision), false);
  finish({ accounts: [] });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(creatorDeviceCache.read("creator-a", "dashboard", CREATOR_CACHE_POLICY), null);
  clearCreatorDeviceCache();
  assert.equal(storage.getItem(CREATOR_CACHE_OWNER), null);
  assert.equal(writeCreatorCache("creator-b", "dashboard", snapshot()), false);
});

test("an account change in another tab preserves the new user's owner marker", () => {
  bindCreatorCacheIdentity("creator-a");
  writeCreatorCache("creator-a", "dashboard", snapshot());
  storage.setItem(CREATOR_CACHE_OWNER, "creator-b");
  detachCreatorCacheIdentity();
  assert.equal(storage.getItem(CREATOR_CACHE_OWNER), "creator-b");
  assert.equal(creatorDeviceCache.read("creator-a", "dashboard", CREATOR_CACHE_POLICY), null);
});

test("confirmed edits update saved progress and invalidate an older dashboard result", () => {
  bindCreatorCacheIdentity("creator-a");
  writeCreatorCache("creator-a", "dashboard", { ...snapshot(), etag: 'W/"old"' });
  const revision = creatorCacheGeneration();
  patchCachedDashboard("creator-a", { applications: [{ id: "application", status: "Accepted" }] });
  assert.equal(isCreatorCacheIdentity("creator-a", revision), false);
  assert.equal(readCreatorCache<{ etag?: string }>("creator-a", "dashboard")?.data.etag, undefined);
});

test("storage failure keeps the dashboard usable in memory and broken cache records are discarded", () => {
  bindCreatorCacheIdentity("creator-a"); storage.blocked = true;
  assert.equal(writeCreatorCache("creator-a", "dashboard", snapshot()), true);
  assert.ok(readCreatorCache("creator-a", "dashboard"));
  storage.blocked = false;
  storage.setItem("reelencer:creator-cache:v1:creator-a:broken", "invalid JSON");
  assert.equal(readCreatorCache("creator-a", "broken"), null);
  assert.throws(() => dashboardSnapshot({ userId: "creator-a", gigs: [] }), /incomplete/);
  assert.throws(() => creatorAccountData({ accounts: [{ id: "broken" }] }), /unreadable/);
});

test("profile and intro-video display metadata never persist private media URLs or account credentials", () => {
  const profile = creatorProfileData({ id: "worker", name: "Creator", headline: "Video creator", kycDocuments: ["private"], assignedAccounts: [{ id: "account", handle: "creator", password: "private" }] });
  const video = creatorVideoData({ name: "Introduction.mp4", uploadedAt: "2026-10-27T00:00:00Z", previewUrl: "https://storage.example/file?token=private", path: "private/storage/path" });
  bindCreatorCacheIdentity("creator-a");
  assert.equal(writeCreatorCache("creator-a", "profile", profile), true);
  assert.equal(writeCreatorCache("creator-a", "intro-video", video), true);
  assert.ok(!JSON.stringify([profile, video]).includes("private"));
  assert.equal(profile.headline, "Video creator");
  assert.equal(video?.name, "Introduction.mp4");
});
