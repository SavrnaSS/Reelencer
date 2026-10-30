import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { profileRecoveryCode, recoverAccountProfile, reportMissingAccountProfile, restoreAccountProfile } from "../../lib/api/accountProfileRecovery";
import { listCreatorAccounts, setAccountStatus } from "../../lib/api/socialAccounts";
import { ApiError } from "../../lib/api/errors";

type Row = Record<string, unknown>;
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { userId: "11111111-1111-4111-8111-111111111111", aliases: ["WKR-1"] };
const oldEnv = { ...process.env };
const oldFetch = globalThis.fetch;
let row: Row;
let mode: "owned" | "missing" | "login" | "no_code" | "wrong_identity";
let rpcCalls: Row[];
let restoreFailure: string | null;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const health = () => row.profile_health as Row;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://profile-recovery.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.WORK_EMAIL_CRYPTO_SECRET = "profile-recovery-test-secret-longer-than-32-characters";
  row = { id: accountId, application_id: accountId, gig_id: "gig", worker_code: "WKR-1", platform: "Instagram", handle: "creator", profile_url: "https://www.instagram.com/creator/", status: "unlinked", external_id: "ig-123", sync_provider: "profile", linked_at: "2026-10-01T00:00:00Z", profile_health: { status: "missing", missingChecks: 2, firstMissingAt: "2026-10-27T00:00:00Z", removedAt: "2026-10-27T00:05:00Z" } };
  mode = "owned";
  rpcCalls = [];
  restoreFailure = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://www.instagram.com") {
      if (mode === "missing") return new Response("Missing", { status: 404 });
      if (mode === "login") return new Response("Login", { status: 302 });
      const code = profileRecoveryCode(row);
      const profile = { username: url.pathname.split("/")[1], id: mode === "wrong_identity" ? "different-account" : "ig-123", biography: mode === "no_code" ? "Creator bio" : `Creator ${code}`, edge_followed_by: { count: 42 } };
      return new Response(`<div>${code}</div><script type="application/json">${JSON.stringify({ user: profile })}</script>`, { headers: { "content-type": "text/html" } });
    }
    assert.equal(url.origin, "https://profile-recovery.example.test", "never contact a real service");
    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "rpc/social_post_wallet_state") return json({ posts: [], accounts: [] });
    if (table === "linked_social_accounts") {
      if (init?.method === "PATCH") row = { ...row, ...JSON.parse(String(init.body)) };
      return json([row]);
    }
    if (table === "rpc/update_social_profile_recovery") {
      const body = JSON.parse(String(init?.body)) as Row;
      assert.deepEqual(body.p_expected_health, row.profile_health);
      assert.equal(body.p_worker_code, row.worker_code);
      rpcCalls.push(body);
      if (body.p_restore && restoreFailure) return json({ code: "P0001", message: restoreFailure }, 409);
      row = { ...row, profile_health: body.p_health, ...(body.p_restore ? { status: "active", handle: body.p_handle, profile_url: body.p_profile_url } : {}) };
      return json(row);
    }
    if (table === "gigs") return json([{ id: "gig", title: "Creator gig", company: "Brand", payout: "₹49", payout_type: "Per post" }]);
    if (table === "social_account_posts") return json([{ id: "post", account_id: accountId, url: "https://www.instagram.com/reel/OLD/", status: "approved", source: "profile", updated_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", views: 1234 }]);
    if (["gig_applications", "integration_settings", "social_account_snapshots"].includes(table)) return json([]);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = oldFetch; process.env = { ...oldEnv }; });
const correct = () => recoverAccountProfile(actor, { accountId, handle: "creator.fixed", profileUrl: "https://www.instagram.com/creator.fixed/" });

test("an owned renamed profile restores its original row and uses the same platform identity", async () => {
  const result = await correct();
  assert.equal(result.restored, true);
  assert.equal(result.row.id, accountId);
  assert.equal(result.row.status, "active");
  assert.equal(result.row.handle, "creator.fixed");
  assert.equal(rpcCalls.length, 2, "claim the attempt, then restore against that exact claim");
  assert.equal(rpcCalls[1].p_external_id, "ig-123");
});

test("a code elsewhere in a page never substitutes for the profile's own bio", async () => {
  mode = "no_code";
  const result = await correct();
  assert.equal(result.restored, false);
  assert.equal(row.status, "unlinked");
  assert.ok(rpcCalls.every(call => call.p_restore === false));
  assert.match(result.message, /Add RL-/);
});

test("a missing profile stays removed while a login block creates a manual verification request", async () => {
  mode = "missing";
  const result = await correct();
  assert.equal(result.restored, false);
  assert.equal((health().recovery as Row).manualReview, false);
  assert.match(result.message, /could not find/);
  (health().recovery as Row).submittedAt = "2026-10-01T00:00:00Z";
  mode = "login";
  const blocked = await correct();
  assert.equal(blocked.restored, false);
  assert.equal((health().recovery as Row).manualReview, true);
  assert.equal(row.status, "unlinked");
});

test("ownership of a different profile cannot inherit the old account's history", async () => {
  mode = "wrong_identity";
  const result = await correct();
  assert.equal(result.restored, false);
  assert.equal((health().recovery as Row).blocked, true);
  assert.ok(rpcCalls.every(call => call.p_restore === false));
});

test("other creators, invalid profile links and repeated checks cannot mutate recovery", async () => {
  await assert.rejects(recoverAccountProfile({ ...actor, aliases: ["WKR-OTHER"] }, { accountId, handle: "creator.fixed", profileUrl: "https://www.instagram.com/creator.fixed/" }), error => error instanceof ApiError && error.status === 404);
  await assert.rejects(recoverAccountProfile(actor, { accountId, handle: "creator.fixed", profileUrl: "https://attacker.example.test/creator.fixed/" }), error => error instanceof ApiError && error.status === 400);
  assert.equal(rpcCalls.length, 0);
  mode = "no_code";
  await correct();
  await assert.rejects(correct(), error => error instanceof ApiError && error.status === 429);
  assert.equal(rpcCalls.length, 2);
});

test("Meta IDs and public profile IDs are not treated as comparable identities", async () => {
  row.sync_provider = "meta";
  row.external_id = "meta-business-id";
  const result = await correct();
  assert.equal(result.restored, false);
  assert.equal((health().recovery as Row).manualReview, true);
  assert.notEqual((health().recovery as Row).blocked, true);
});

test("a full account slot produces a durable review message instead of leaving a verification stuck", async () => {
  restoreFailure = "profile_account_limit";
  const result = await correct();
  assert.equal(result.restored, false);
  assert.equal(row.status, "unlinked");
  assert.equal((health().recovery as Row).manualReview, true);
  assert.match(String((health().recovery as Row).message), /account slot/);
});

test("manual restoration needs an explicit confirmation of the latest recovery request", async () => {
  const recovery = { handle: "creator.fixed", profileUrl: "https://www.instagram.com/creator.fixed/", submittedAt: new Date().toISOString(), manualReview: true, message: "Review" };
  row.profile_health = { ...health(), recovery };
  await assert.rejects(restoreAccountProfile(actor.userId, accountId, false, recovery), error => error instanceof ApiError && error.status === 400);
  await assert.rejects(restoreAccountProfile(actor.userId, accountId, true, { ...recovery, handle: "outdated" }), error => error instanceof ApiError && error.status === 409);
  await assert.rejects(setAccountStatus(accountId, "active"), error => error instanceof ApiError && error.status === 409);
  const result = await restoreAccountProfile(actor.userId, accountId, true, recovery);
  assert.equal(result.status, "active");
});

test("removed profiles leave Linked but stay available as recovery issues with saved reels", async () => {
  const result = await listCreatorAccounts(actor.aliases);
  assert.equal(result.accounts.length, 0);
  assert.equal(result.accountIssues?.length, 1);
  assert.equal(result.accountIssues?.[0].posts[0].views, 1234);
  assert.match(result.accountIssues?.[0].profileHealth?.verifyCode ?? "", /^RL-[A-Z0-9]{6}$/);
  row.profile_health = {};
  assert.equal((await listCreatorAccounts(actor.aliases)).accountIssues?.length, 0, "manually unlinked accounts are not recoverable without team approval");
});

test("an explicit admin report creates recovery without deleting the account or its history", async () => {
  row.status = "active";
  row.profile_health = {};
  await assert.rejects(reportMissingAccountProfile(actor.userId, accountId, false), error => error instanceof ApiError && error.status === 400);
  const result = await reportMissingAccountProfile(actor.userId, accountId, true);
  assert.equal(result.id, accountId);
  assert.equal(result.status, "unlinked");
  assert.equal(health().status, "missing");
  assert.equal(health().confirmedBy, actor.userId);
  assert.equal(result.sync_lock_token, null);
  assert.equal((await listCreatorAccounts(actor.aliases)).accountIssues?.length, 1);
});
