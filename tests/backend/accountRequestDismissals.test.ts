import test from "node:test";
import assert from "node:assert/strict";
import type { AccountRequestView } from "../../lib/accountRequests";
import { accountRequestDecisionKey, accountRequestDismissalStorageKey, createAccountRequestDismissalStore, EMPTY_ACCOUNT_REQUEST_DISMISSALS, MAX_ACCOUNT_REQUEST_DISMISSALS, parseAccountRequestDismissals } from "../../lib/accountRequestDismissals";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
type Decision = Pick<AccountRequestView, "id" | "status" | "revision" | "reviewedAt" | "createdAt">;
const request = (values: Partial<Decision> = {}): Decision => ({ id: "request-1", status: "rejected", revision: 1, reviewedAt: "2026-10-31T06:00:00Z", createdAt: "2026-10-30T06:00:00Z", ...values });

class DeviceStorage {
  values = new Map<string, string>();
  readBlocked = false;
  writeBlocked = false;
  writes = 0;
  getItem(key: string) { if (this.readBlocked) throw new Error("Unavailable"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.writeBlocked) throw new Error("Quota"); this.writes++; this.values.set(key, value); }
}
const setup = (storage = new DeviceStorage(), events = new EventTarget()) => ({ storage, events, store: createAccountRequestDismissalStore({ storage: () => storage, events: () => events }) });
const hidden = (store: ReturnType<typeof setup>["store"], userId: string | null, item = request()) => {
  const key = accountRequestDecisionKey(item);
  return !!key && parseAccountRequestDismissals(store.getSnapshot(userId)).includes(key);
};
const storageEvent = (key: string | null) => Object.assign(new Event("storage"), { key });

test("dismissed rejected decisions survive reload and remain isolated to the verified creator", () => {
  const { store, storage } = setup();
  store.dismiss(owner, request());
  assert.equal(hidden(store, owner), true);
  assert.equal(hidden(store, other), false);
  assert.equal(hidden(setup(storage).store, owner), true, "a new store simulates reloading or logging back in");
  assert.equal(store.getSnapshot(null), EMPTY_ACCOUNT_REQUEST_DISMISSALS);
  store.dismiss(null, request());
  store.dismiss("not-a-user-uuid", request());
  assert.equal(storage.writes, 1);
  assert.equal(accountRequestDismissalStorageKey(owner.toUpperCase()), accountRequestDismissalStorageKey(owner));
});

test("new reviews and revisions surface again and action-required states cannot be dismissed", () => {
  const { store, storage } = setup();
  store.dismiss(owner, request());
  for (const item of [request({ reviewedAt: "2026-10-31T06:00:01Z" }), request({ revision: 2 }), request({ id: "request-2" })]) assert.equal(hidden(store, owner, item), false);
  for (const status of ["pending", "changes_requested", "approved", "withdrawn"] as const) {
    store.dismiss(owner, request({ status }));
    assert.equal(hidden(store, owner, request({ status })), false);
  }
  assert.equal(storage.writes, 1, "only the rejected decision writes a preference");
  assert.equal(accountRequestDecisionKey(request({ reviewedAt: undefined })), JSON.stringify(["request-1", 1, "2026-10-30T06:00:00.000Z"]));
  assert.equal(accountRequestDecisionKey(request({ reviewedAt: "invalid" })), undefined);
});

test("blocked storage and quota failures still dismiss notices in memory and recover on the next write", () => {
  const { store, storage } = setup();
  storage.readBlocked = true; storage.writeBlocked = true;
  store.dismiss(owner, request());
  assert.equal(hidden(store, owner), true);
  assert.equal(hidden(store, other), false);
  storage.readBlocked = false;
  store.dismiss(owner, request({ id: "request-2" }));
  assert.equal(hidden(store, owner), true, "a readable but unwritable device must not restore the dismissed notice");
  storage.writeBlocked = false;
  store.dismiss(owner, request({ id: "request-3" }));
  const reloaded = setup(storage).store;
  for (const id of ["request-1", "request-2", "request-3"]) assert.equal(hidden(reloaded, owner, request({ id })), true);
});

test("same-tab subscribers update together and cross-tab storage changes refresh only the matching user", () => {
  const { store, storage, events } = setup();
  let first = 0, second = 0;
  const stopFirst = store.subscribe(owner, () => first++), stopSecond = store.subscribe(owner, () => second++);
  store.dismiss(owner, request());
  assert.deepEqual([first, second], [1, 1]);
  events.dispatchEvent(storageEvent(accountRequestDismissalStorageKey(other)!));
  assert.deepEqual([first, second], [1, 1]);
  storage.values.delete(accountRequestDismissalStorageKey(owner)!);
  events.dispatchEvent(storageEvent(accountRequestDismissalStorageKey(owner)!));
  assert.equal(hidden(store, owner), false);
  assert.deepEqual([first, second], [2, 2]);
  stopFirst(); stopSecond();
  store.dismiss(owner, request());
  assert.deepEqual([first, second], [2, 2]);
});

test("corrupt preferences are ignored without mutating storage during snapshots", () => {
  const { store, storage } = setup();
  for (const value of ["broken JSON", "{}", "null", '["not-a-decision"]', "x".repeat(32_001)]) {
    storage.values.set(accountRequestDismissalStorageKey(owner)!, value);
    assert.equal(store.getSnapshot(owner), EMPTY_ACCOUNT_REQUEST_DISMISSALS);
  }
  const snapshot = store.getSnapshot(owner);
  assert.equal(typeof snapshot, "string");
  assert.equal(store.getSnapshot(owner), snapshot, "external-store snapshots have stable primitive equality");
  assert.equal(storage.writes, 0);
});

test("preferences stay bounded and never persist handles, notes, or account credentials", () => {
  const { store, storage } = setup();
  for (let i = 0; i < MAX_ACCOUNT_REQUEST_DISMISSALS + 25; i++) {
    const decision = { ...request({ id: `request-${i}` }), handle: "private_handle", reviewNote: "private_note", password: "private_password" };
    store.dismiss(owner, decision);
  }
  assert.equal(parseAccountRequestDismissals(store.getSnapshot(owner)).length, MAX_ACCOUNT_REQUEST_DISMISSALS);
  assert.equal(hidden(store, owner, request({ id: "request-0" })), false);
  assert.equal(hidden(store, owner, request({ id: "request-124" })), true);
  const saved = storage.getItem(accountRequestDismissalStorageKey(owner)!)!;
  assert.equal(saved.includes("private_"), false);
  assert.ok(saved.length < 32_000);
});

test("server-side or unavailable browser storage never causes reads or subscription failures", () => {
  const store = createAccountRequestDismissalStore({ storage: () => undefined, events: () => undefined });
  assert.equal(store.getSnapshot(owner), EMPTY_ACCOUNT_REQUEST_DISMISSALS);
  assert.doesNotThrow(() => store.subscribe(null, () => {})());
  assert.doesNotThrow(() => store.dismiss(owner, request()));
  assert.equal(hidden(store, owner), true);
});
