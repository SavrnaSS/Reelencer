import test from "node:test";
import assert from "node:assert/strict";
import { classifySyncError, retryDelayMs, SocialSyncError, storedSyncState, syncPresentation } from "../../lib/socialSyncSchedule";
import { accountSyncDue } from "../../lib/api/socialSync";

test("persisted deadlines and leases override polling frequency", () => {
  const now = Date.now();
  const row = { status: "active", platform: "Instagram", next_sync_at: new Date(now + 1000).toISOString() };
  assert.equal(accountSyncDue(row, now, 0), false);
  assert.equal(accountSyncDue(row, now + 1000, 0), true);
  assert.equal(accountSyncDue({ ...row, sync_locked_until: new Date(now + 2000).toISOString() }, now + 1000, 0), false);
  assert.equal(accountSyncDue({ ...row, status: "paused" }, now + 1000, 0), false);
});

test("retries increase with consecutive failures, respect Retry-After and spread accounts", () => {
  const first = retryDelayMs("login_required", 1, "account-a");
  assert.ok(first >= 30 * 60_000 && first < 31 * 60_000);
  assert.ok(retryDelayMs("login_required", 2, "account-a") > first);
  assert.notEqual(first, retryDelayMs("login_required", 1, "account-b"));
  assert.equal(retryDelayMs("rate_limited", 1, "a", 3 * 3_600_000), 3 * 3_600_000);
  assert.ok(retryDelayMs("timeout", 1000000, "a") < 7 * 3_600_000);
  assert.equal(classifySyncError(new SocialSyncError("Unavailable", "credentials")), "credentials");
});

test("failed attempts retain success time and dashboards distinguish stale, blocked and paused states", () => {
  const now = Date.now();
  const row = { status: "active", sync_status: "error", sync_error_code: "login_required", last_synced_at: new Date(now - 86_400_000).toISOString(), last_sync_attempt_at: new Date(now).toISOString(), next_sync_at: new Date(now + 1_800_000).toISOString(), sync_failures: 3 };
  const sync = storedSyncState(row);
  assert.equal(sync.lastSyncedAt, row.last_synced_at);
  assert.equal(sync.lastAttemptAt, row.last_sync_attempt_at);
  assert.equal(sync.consecutiveFailures, 3);
  const account = { status: "active" as const, platform: "Instagram", sync };
  assert.equal(syncPresentation(account, now).label, "Access limited");
  assert.equal(syncPresentation({ ...account, status: "paused" }, now).label, "Paused");
  assert.equal(syncPresentation({ ...account, sync: { ...sync, status: "ok" } }, now).label, "Update due");
  assert.equal(syncPresentation({ ...account, sync: { available: true, status: "pending" } }, now).tone, "progress");
});
