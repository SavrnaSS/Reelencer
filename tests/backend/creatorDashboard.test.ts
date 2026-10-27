import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { authenticate } from "../../lib/api/auth";
import { creatorDashboardResponse } from "../../lib/api/creatorDashboard";
import { withApi } from "../../lib/api/route";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const userId = "11111111-1111-4111-8111-111111111111";
let authReads: number;
beforeEach(() => {
  authReads = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dashboard-cache.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://dashboard-cache.example.test");
    if (url.pathname === "/auth/v1/user") {
      authReads++;
      return Response.json({ id: userId, email: "creator@example.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false });
    }
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: userId, worker_code: "WKR-CREATOR", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "WKR-CREATOR", active: true }]);
    throw new Error(`Unexpected read: ${url.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const request = (etag?: string) => new NextRequest("https://app.example.test/api/dashboard", { headers: { authorization: "Bearer test-session", ...(etag ? { "if-none-match": etag } : {}) } });
const context = { params: Promise.resolve({}) };

function readers(fail: string[] = [], revision = 1) {
  return Object.fromEntries(["gigs", "applications", "assignments", "payoutBatches"].map(key => [key, { path: `/api/${key}`, read: async (child: NextRequest) => {
    const actor = await authenticate(child);
    assert.equal(actor.user.id, userId);
    assert.equal(child.nextUrl.searchParams.get("workerId"), key === "gigs" ? null : "WKR-CREATOR");
    if (fail.includes(key)) throw new Error("private provider failure");
    return Response.json([{ id: key, revision }]);
  } }]));
}
const handler = (sources = readers()) => withApi({ auth: "user" }, async req => creatorDashboardResponse(req, await authenticate(req), sources));

test("one dashboard request verifies the actor once and reuses authorization for all four read models", async () => {
  const response = await handler()(request(), context);
  assert.equal(response.status, 200);
  assert.equal(authReads, 1);
  const payload = await response.json();
  assert.equal(payload.userId, userId);
  assert.deepEqual(Object.keys(payload.data).sort(), ["applications", "assignments", "gigs", "payoutBatches"]);
  assert.deepEqual(payload.errors, []);
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
});

test("conditional reads reduce transfer while still verifying current authorization and fresh data", async () => {
  const first = await handler()(request(), context);
  const etag = first.headers.get("etag")!;
  const same = await handler()(request(etag), context);
  assert.equal(same.status, 304);
  assert.equal(await same.text(), "");
  assert.equal(authReads, 2, "a saved response never bypasses current access checks");
  const changed = await handler(readers([], 2))(request(etag), context);
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
});

test("a partial read reports only failed sections and never replaces them with empty data", async () => {
  const response = await handler(readers(["payoutBatches"]))(request(), context);
  const payload = await response.json();
  assert.deepEqual(payload.errors, ["payoutBatches"]);
  assert.equal("payoutBatches" in payload.data, false);
  assert.ok(Array.isArray(payload.data.applications));
  assert.equal(response.headers.get("etag"), null);
  assert.ok(!JSON.stringify(payload).includes("private provider"));
});

test("unauthenticated and cross-user reads fail before a dashboard resource can run", async () => {
  const noSession = await handler()(new NextRequest("https://app.example.test/api/dashboard"), context);
  assert.equal(noSession.status, 401);
  assert.equal(authReads, 0);
  const other = new NextRequest("https://app.example.test/api/dashboard?workerId=WKR-OTHER", { headers: { authorization: "Bearer test-session" } });
  const denied = await handler()(other, context);
  assert.equal(denied.status, 403);
});
