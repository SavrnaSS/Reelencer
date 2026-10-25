import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as directory } from "../../app/api/admin/workers/route";
import { GET as snapshot } from "../../app/api/admin/snapshot/route";

const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
const admin = "33333333-3333-4333-8333-333333333333";
const active = "11111111-1111-4111-8111-111111111111";
const suspended = "22222222-2222-4222-8222-222222222222";
const deleted = "44444444-4444-4444-8444-444444444444";
const profiles = [
  { id: admin, role: "Admin", worker_code: "ADMIN", email: "operator@example.test", display_name: "Operator", active: true },
  { id: active, role: "Worker", worker_code: "WKR-ACTIVE", email: "active@example.test", display_name: "Alice", active: true },
  { id: suspended, role: "Worker", worker_code: "WKR-SUSPENDED", email: "suspended@example.test", display_name: "Sam", active: false },
  { id: deleted, role: "Worker", worker_code: "WKR-DELETED", email: "deleted@example.test", display_name: "Deleted Creator", active: false },
];
const workers = profiles.filter(row => row.role === "Worker").map(row => ({ id: row.worker_code, user_id: row.id, email: row.email, name: row.display_name, active: row.active }));
const authUsers = profiles.map(row => ({ id: row.id, email: row.email, email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: { name: row.display_name }, is_anonymous: false }));
const context = { params: Promise.resolve({}) };
const request = (path: string) => new NextRequest("https://app.example.test" + path, { headers: { authorization: "Bearer admin" } });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

before(() => {
  process.env = { ...originalEnv, NEXT_PUBLIC_SUPABASE_URL: "https://worker-visibility.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", ADMIN_EMAIL: "operator@example.test", NEXT_PUBLIC_ENABLE_DEMO_MODE: "false" };
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://worker-visibility.example.test", "Tests cannot contact real services");
    if (url.pathname === "/auth/v1/user") return json(authUsers[0]);
    if (url.pathname === "/auth/v1/admin/users") return json({ users: url.searchParams.get("page") === "1" ? authUsers : [], aud: "authenticated" });
    if (url.pathname === "/rest/v1/rpc/app_is_admin") return json(true);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (url.pathname === "/rest/v1/profiles") return json(url.searchParams.has("id") ? profiles.filter(row => "eq." + row.id === url.searchParams.get("id")) : profiles.slice(offset));
    if (url.pathname === "/rest/v1/workers") return json(url.searchParams.has("user_id") ? workers.filter(row => "eq." + row.user_id === url.searchParams.get("user_id")) : workers.slice(offset));
    if (url.pathname === "/rest/v1/worker_moderation") return json([
      { user_id: suspended, status: "suspended" },
      { user_id: deleted, status: "deleted", deleted_at: "2026-10-25T10:00:00Z" },
    ].slice(offset));
    if (url.pathname === "/rest/v1/assignments") return json([{ worker_id: deleted, account_id: "account-history" }]);
    if (url.pathname === "/rest/v1/work_items") return json([{ id: "work-history", public_id: "WI-HISTORY", worker_id: deleted, status: "Approved", reward_inr: 45, created_at: "2026-10-01T10:00:00Z" }]);
    if (["/rest/v1/accounts", "/rest/v1/worker_account_assignments", "/rest/v1/upi_configs"].includes(url.pathname)) return json([]);
    throw new Error("Unexpected test request: " + url.pathname);
  };
});
after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

test("worker API defaults to current accounts and retains suspended users", async () => {
  const response = await directory(request("/api/admin/workers"), context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.workers.map((row: { id: string }) => row.id), ["WKR-ACTIVE", "WKR-SUSPENDED"]);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("the protected management request still includes deleted accounts for restoration", async () => {
  const response = await directory(request("/api/admin/workers?includeDeleted=true"), context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.workers.length, 3);
  assert.equal(data.workers.find((row: { id: string }) => row.id === "WKR-DELETED").moderationStatus, "deleted");
});

test("overview snapshots hide deleted identities while preserving historical earnings and canonical worker aliases", async () => {
  const response = await snapshot(request("/api/admin/snapshot"), context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.workers.map((row: { id: string }) => row.id), ["WKR-ACTIVE", "WKR-SUSPENDED"]);
  assert.equal(data.workItems[0].workerId, "WKR-DELETED");
  assert.equal(data.workItems[0].rewardINR, 45);
  assert.equal(data.assignments[0].workerId, "WKR-DELETED");
});
