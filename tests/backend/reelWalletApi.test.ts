import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reviewPost, upsertPost } from "../../lib/api/socialAccounts";

const env = { ...process.env }, realFetch = globalThis.fetch;
const actor = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
const post = "33333333-3333-4333-8333-333333333333";
const stamp = "2026-10-30T10:00:00Z";
let missing = false;
let calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
const row = { id: post, account_id: account, status: "approved", url: "https://www.instagram.com/reel/ABC/", posted_at: stamp, views: 1000, source: "manual", created_at: stamp, updated_at: stamp };
beforeEach(() => {
  missing = false; calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://wallet-api.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://wallet-api.example.test", "never contact a real service");
    const path = url.pathname.replace("/rest/v1/", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path, method, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (path === "linked_social_accounts") return json({ id: account, status: "active", handle: "creator", linked_at: "2026-10-01T00:00:00Z" });
    if (path === "social_account_posts") { assert.equal(method, "GET"); return json(null); }
    if (path === "rpc/social_post_wallet_state") return json({ posts: [{ postId: post, creditedINR: 49, consumedViews: 1000, pendingClaimINR: 0, fixedCredit: false }], accounts: [] });
    if (["rpc/approve_social_post_and_credit", "rpc/save_social_post_with_wallet"].includes(path)) return missing ? json({ code: "PGRST202", message: "Missing migration" }, 404) : json({ post: row });
    throw new Error(`Unexpected request: ${path}`);
  };
});
afterEach(() => { process.env = { ...env }; globalThis.fetch = realFetch; });

test("approval uses the atomic wallet RPC and immediately returns ledger-backed credit evidence", async () => {
  const result = await reviewPost(actor, post, "approved", "Reviewed");
  assert.deepEqual(calls[0], { path: "rpc/approve_social_post_and_credit", method: "POST", body: { p_actor: actor, p_post: post, p_note: "Reviewed" } });
  assert.equal(result.post.walletCredit?.creditedINR, 49);
  assert.equal(result.post.status, "approved");
  assert.ok(!calls.some(call => call.method === "PATCH"));
});

test("a missing wallet migration fails approval without falling back to an uncredited REST approval", async () => {
  missing = true;
  await assert.rejects(reviewPost(actor, post, "approved"), (error: unknown) => (error as { status?: number; code?: string }).status === 503 && (error as { code?: string }).code === "schema_outdated");
  assert.equal(calls.length, 1);
});

test("manual approved saves use the same atomic wallet path and verified admin identity", async () => {
  const result = await upsertPost(actor, { accountId: account, url: row.url, postedAt: stamp, views: 1000, status: "approved" });
  const save = calls.find(call => call.path === "rpc/save_social_post_with_wallet")!;
  assert.equal(save.body.p_actor, actor);
  const saved = save.body.p_input as Record<string, unknown>;
  assert.equal(saved.account_id, account);
  assert.equal(saved.status, "approved");
  assert.equal(saved.views, 1000);
  assert.equal(result.walletCredit?.creditedINR, 49);
  assert.ok(!calls.some(call => call.path === "social_account_posts" && call.method !== "GET"));
});
