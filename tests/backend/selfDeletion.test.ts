import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/me/delete-account/route";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const creator = "44444444-4444-4444-8444-444444444444";
let calls: { path: string; body: Record<string, unknown> | null }[];
let email: string, adminRpc: boolean, rpcError: { code: string; message: string } | null, logoutFails: boolean;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://delete.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.ADMIN_EMAIL = "operator@example.test";
  calls = []; email = "creator@example.test"; adminRpc = false; rpcError = null; logoutFails = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://delete.example.test", "tests must not reach a real service");
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: creator, email, email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/auth/v1/logout") return logoutFails ? Response.json({ msg: "down" }, { status: 500 }) : new Response(null, { status: 204 });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ worker_code: "WKR-DEL", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "WKR-DEL", active: true }]);
    if (url.pathname === "/rest/v1/rpc/app_is_admin") return Response.json(adminRpc);
    if (url.pathname === "/rest/v1/rpc/consume_api_rate_limit" || url.pathname === "/rest/v1/rpc/record_worker_access") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/request_own_worker_deletion") {
      if (rpcError) return Response.json(rpcError, { status: rpcError.code === "PGRST202" ? 404 : 400 });
      return Response.json({ status: "deleted", changed: true, deletedAt: "2026-11-12T10:00:00Z", purgeAfter: "2026-11-19T10:00:00Z" });
    }
    throw new Error("Unexpected backend route: " + url.pathname);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

const context = { params: Promise.resolve({}) };
const request = (body: unknown) => new NextRequest("https://app.example.test/api/me/delete-account", {
  method: "POST", headers: { authorization: "Bearer creator-session", "content-type": "application/json" }, body: JSON.stringify(body),
});

test("a creator deletes their own account with the typed confirmation, and every session is signed out", async () => {
  const response = await POST(request({ confirm: "DELETE", reason: "  Not posting any more  " }), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "deleted");
  assert.deepEqual(calls.find(c => c.path === "/rest/v1/rpc/request_own_worker_deletion")?.body, { p_user: creator, p_reason: "Not posting any more" });
  assert.ok(calls.some(c => c.path === "/auth/v1/logout"), "all sessions are revoked");
});

test("deletion needs DELETE typed, and nothing changes without it", async () => {
  const response = await POST(request({ confirm: "delete" }), context);
  assert.equal(response.status, 400);
  assert.equal(calls.some(c => c.path === "/rest/v1/rpc/request_own_worker_deletion"), false);
});

test("a failed sign-out never turns a saved deletion into an error", async () => {
  logoutFails = true;
  const response = await POST(request({ confirm: "DELETE" }), context);
  assert.equal(response.status, 200);
});

test("administrators are refused, and a missing database update is reported clearly", async () => {
  email = "operator@example.test"; adminRpc = true;
  assert.equal((await POST(request({ confirm: "DELETE" }), context)).status, 403);
  email = "creator@example.test"; adminRpc = false; rpcError = { code: "PGRST202", message: "Could not find the function" };
  const missing = await POST(request({ confirm: "DELETE" }), context);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "schema_outdated");
});
