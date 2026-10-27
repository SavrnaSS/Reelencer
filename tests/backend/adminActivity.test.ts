import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/admin/activity/route";
import { isAdminActivity } from "../../lib/adminOverview";

const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
let admin: boolean, failed: boolean, malformed: boolean;
let reads: number[];
function activity(days: number) {
  const end = Date.parse("2026-10-27T00:00:00Z");
  const summary = { activeUsers: 0, newUsers: 0, applications: 0, reels: 0, claims: 0, withdrawals: 0, actions: 0 };
  const rows = Array.from({ length: days }, (_, index) => ({ date: new Date(end - (days - index - 1) * 86_400_000).toISOString().slice(0, 10), ...summary }));
  return { generatedAt: "2026-10-27T18:00:00Z", timezone: "Asia/Kolkata", period: { days, start: rows[0].date, end: "2026-10-27" }, totalUsers: 12,
    counts: { linkedAccounts: 3, pendingClaims: 1, pendingWithdrawals: 2, pendingPayouts: 3 }, summary, previous: summary,
    queues: { applications: 0, kyc: 0, reels: 0, profiles: 0, claims: 1, withdrawals: 2 }, days: rows, recent: [] };
}
beforeEach(() => {
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://activity.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-service", ADMIN_EMAIL: "operator@example.test" });
  admin = true; failed = false; malformed = false; reads = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://activity.example.test", "never contact a real service");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "11111111-1111-4111-8111-111111111111", email: admin ? "operator@example.test" : "worker@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ worker_code: "WKR-TEST", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "WKR-TEST", active: true }]);
    if (url.pathname === "/rest/v1/rpc/app_is_admin") return Response.json(admin);
    assert.equal(url.pathname, "/rest/v1/rpc/admin_activity_overview");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body), ["p_days"], "client dates or SQL cannot change the reporting window");
    reads.push(body.p_days);
    if (failed) return Response.json({ code: "XX000", message: "private database details" }, { status: 500 });
    return Response.json(malformed ? { days: [] } : activity(body.p_days));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const request = (query = "") => new NextRequest(`https://app.example.test/api/admin/activity${query}`, { headers: { authorization: "Bearer test-session" } });
const context = { params: Promise.resolve({}) };

test("activity API serves validated admin-only analytics for supported periods and defaults to 30 days", async () => {
  for (const query of ["", "?days=7", "?days=30", "?days=90"]) {
    const response = await GET(request(query), context);
    assert.equal(response.status, 200);
    assert.equal(isAdminActivity(await response.json()), true);
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  }
  assert.deepEqual(reads, [30, 7, 30, 90]);
});
test("invalid periods fail before any analytics query", async () => {
  for (const value of ["0", "-7", "365", "7.0", "3e1", "", "30;drop table profiles"]) {
    assert.equal((await GET(request(`?days=${encodeURIComponent(value)}`), context)).status, 400);
  }
  assert.deepEqual(reads, []);
});
test("database failures and malformed aggregate responses remain unavailable without leaking details", async () => {
  failed = true;
  const failure = await GET(request(), context);
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes("private database details"));
  failed = false; malformed = true;
  const invalid = await GET(request(), context);
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json()).code, "activity_unavailable");
});
test("workers and anonymous callers cannot read activity analytics", async () => {
  admin = false;
  assert.equal((await GET(request(), context)).status, 403);
  assert.equal((await GET(new NextRequest("https://app.example.test/api/admin/activity"), context)).status, 401);
  assert.deepEqual(reads, []);
});
