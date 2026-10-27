import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readProfileHealth, recordMissingProfile, needsProfileRecovery, PROFILE_MISSING_CONFIRM_MS } from "../../lib/accountProfileHealth";
import { summarizeAccountEarnings } from "../../lib/creatorEarnings";
import { fetchInstagramProfile, fetchInstagramProfileSummary, fetchInstagramReel } from "../../lib/api/instagramProfile";
import { ProfileNotFoundError, syncPresentation } from "../../lib/socialSyncSchedule";
import type { LinkedSocialAccount } from "../../lib/socialAnalytics";

const fetchBefore = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchBefore; });

test("a missing profile needs two explicit observations five minutes apart", () => {
  const now = Date.parse("2026-10-27T06:00:00Z");
  const first = recordMissingProfile(undefined, now);
  assert.equal(first.status, "suspected");
  assert.equal(first.missingChecks, 1);
  assert.equal(recordMissingProfile(first, now + PROFILE_MISSING_CONFIRM_MS - 1).status, "suspected");
  const second = recordMissingProfile(first, now + PROFILE_MISSING_CONFIRM_MS);
  assert.equal(second.status, "missing");
  assert.equal(second.missingChecks, 2);
  assert.equal(second.firstMissingAt, first.firstMissingAt);
  assert.ok(second.removedAt);
  assert.equal(needsProfileRecovery({ status: "unlinked", profileHealth: second }), true);
  assert.equal(needsProfileRecovery({ status: "unlinked" }), false, "ordinary manual unlinking never opens self-service recovery");
  assert.equal(recordMissingProfile({ status: "healthy", missingChecks: 0 }, now).status, "suspected", "a successful profile read resets previous absence");
});

test("profile-health metadata is bounded and allowlisted", () => {
  assert.equal(readProfileHealth({ status: "anything" }), undefined);
  const health = readProfileHealth({ status: "missing", missingChecks: Infinity, checkedAt: "invalid", password: "secret", recovery: { handle: "a".repeat(300), profileUrl: "https://example.test", submittedAt: "2026-10-27T00:00:00Z", message: "m".repeat(900), manualReview: true, password: "secret" } })!;
  assert.equal(health.missingChecks, 100);
  assert.equal(health.checkedAt, undefined);
  assert.equal(health.recovery?.handle.length, 120);
  assert.equal(health.recovery?.message.length, 300);
  assert.ok(!JSON.stringify(health).includes("secret"));
});

test("only a direct missing profile response identifies a profile as absent", async () => {
  for (const status of [404, 410]) {
    globalThis.fetch = async () => new Response("not found", { status });
    await assert.rejects(fetchInstagramProfile("creator"), ProfileNotFoundError);
    await assert.rejects(fetchInstagramProfileSummary("creator"), ProfileNotFoundError);
    await assert.rejects(fetchInstagramReel("creator", "https://www.instagram.com/reel/ABC/"), error => !(error instanceof ProfileNotFoundError));
  }
  for (const status of [302, 401, 403, 429, 500]) {
    globalThis.fetch = async () => new Response("blocked", { status });
    await assert.rejects(fetchInstagramProfileSummary("creator"), error => !(error instanceof ProfileNotFoundError));
  }
  globalThis.fetch = async () => new Response("<html>Log in to continue</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(fetchInstagramProfileSummary("creator"), error => !(error instanceof ProfileNotFoundError));
});

test("a private profile with readable identity is still a valid profile", async () => {
  globalThis.fetch = async () => new Response(`<script type="application/json">${JSON.stringify({ user: { id: "123", username: "creator", is_private: true, edge_followed_by: { count: 10 }, biography: "Private creator" } })}</script>`, { headers: { "content-type": "text/html" } });
  const profile = await fetchInstagramProfile("creator");
  assert.equal(profile.externalId, "123");
  assert.equal(profile.isPrivate, true);
});

test("temporarily removed profiles retain approved earnings and clear status labels", () => {
  const account = { id: "account", handle: "creator", platform: "Instagram", status: "unlinked", profileHealth: { status: "missing", missingChecks: 2 }, payout: "₹49", payoutType: "Per post", posts: [{ id: "post", status: "approved" }], sync: { available: true, status: "error" } } as LinkedSocialAccount;
  assert.equal(summarizeAccountEarnings([account]).approved, 49);
  assert.equal(summarizeAccountEarnings([{ ...account, profileHealth: undefined }]).approved, 0);
  assert.equal(syncPresentation(account).label, "Profile verification needed");
  assert.equal(syncPresentation({ ...account, status: "active", profileHealth: { status: "suspected", missingChecks: 1 } }).label, "Rechecking profile");
});
