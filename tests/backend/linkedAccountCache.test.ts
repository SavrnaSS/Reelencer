import test from "node:test";
import assert from "node:assert/strict";
import { isLinkedAccountsData, isLinkedSyncAttempt, linkedAccountsData, linkedSyncDue, LINKED_SYNC_INTERVAL_MS } from "../../lib/linkedAccountCache";
import { ADMIN_PREFERENCES_COOKIE, readAdminFilter } from "../../lib/adminPreferences";

const account = {
  id: "account", applicationId: "application", gigId: "gig", workerCode: "worker", platform: "Instagram",
  handle: "creator", profileUrl: "https://www.instagram.com/creator/", status: "active", linkedAt: "2026-10-17T00:00:00Z",
  sync: { available: true, status: "ok", accessToken: "do-not-cache" },
  snapshots: [{ id: "snapshot", capturedAt: "2026-10-17T00:00:00Z", periodDays: 7, followers: 100, source: "profile", password: "do-not-cache" }],
  posts: [{ id: "post", url: "https://www.instagram.com/reel/POST/", updatedAt: "2026-10-17T00:00:00Z", createdAt: "2026-10-17T00:00:00Z", status: "submitted", submittedByWorker: true, source: "manual", caption: "A reel", access_token: "do-not-cache" }],
  password: "do-not-cache", internalToken: "do-not-cache", unknown: { privateKey: "do-not-cache" },
};

test("linked account cache projects supported display fields and strips unexpected credential fields at every level", () => {
  const data = linkedAccountsData({ accounts: [account], screenshotReader: true, authorization: "do-not-cache" });
  assert.equal(isLinkedAccountsData(data), true);
  assert.equal(JSON.stringify(data).includes("do-not-cache"), false);
  assert.equal(data.accounts[0].snapshots[0].followers, 100);
  assert.equal(data.accounts[0].posts[0].caption, "A reel");
  assert.equal(data.screenshotReader, true);
  assert.equal(account.password, "do-not-cache", "Original response is not mutated");
});

test("malformed refreshed collections cannot replace a valid cached collection", () => {
  for (const accounts of [null, {}, [null], [{ ...account, sync: null }], [{ ...account, posts: "broken" }], [{ ...account, status: "unexpected" }], [{ ...account, snapshots: [{ followers: 1 }] }]]) {
    assert.throws(() => linkedAccountsData({ accounts }));
  }
  assert.equal(isLinkedAccountsData({ accounts: [account], screenshotReader: "yes" }), false);
  assert.deepEqual(linkedAccountsData({ accounts: [], screenshotReader: false }), { accounts: [], screenshotReader: false });
});

test("platform sync is throttled across mounts, recovers from invalid clocks, and allows explicit refresh", () => {
  const now = 1_000_000;
  assert.equal(linkedSyncDue(undefined, now), true);
  assert.equal(linkedSyncDue(now - LINKED_SYNC_INTERVAL_MS + 1, now), false);
  assert.equal(linkedSyncDue(now - LINKED_SYNC_INTERVAL_MS, now), true);
  assert.equal(linkedSyncDue(now, now, true), true);
  assert.equal(linkedSyncDue(now + 1, now), true);
  assert.equal(isLinkedSyncAttempt(null), false);
  assert.equal(isLinkedSyncAttempt({ at: "yesterday" }), false);
  assert.equal(isLinkedSyncAttempt({ at: now }), true);
});

test("the preference cookie accepts only supported UI filters and ignores malformed or unrelated cookies", () => {
  const cookie = (value: unknown) => `${ADMIN_PREFERENCES_COOKIE}=${encodeURIComponent(JSON.stringify(value))}`;
  assert.equal(readAdminFilter(`other=1; ${cookie({ v: 1, linkedFilter: "active" })}; something=2`), "active");
  for (const value of [{ v: 0, linkedFilter: "active" }, { v: 1, linkedFilter: "password" }, null, {}]) assert.equal(readAdminFilter(cookie(value)), "all");
  assert.equal(readAdminFilter(`${ADMIN_PREFERENCES_COOKIE}=%invalid`), "all");
  assert.equal(readAdminFilter("other=active"), "all");
});
