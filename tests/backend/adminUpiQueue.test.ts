import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../../app/api/admin/upi-configs/route";
import { PUT } from "../../app/api/upi/route";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const admin = "11111111-1111-4111-8111-111111111111";
const worker = "22222222-2222-4222-8222-222222222222";
type Row = { worker_id: string; upi_id: string; verified: boolean; updated_at: string | null; payout_schedule: string; payout_day: string; profile: { worker_code: string; display_name: string; role: string; active: boolean } };
const row = (index: number, overrides: Partial<Row> = {}): Row => ({ worker_id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, upi_id: `creator${index}@bank`, verified: false, updated_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(), payout_schedule: "Weekly", payout_day: "Fri", profile: { worker_code: `WKR-${index}`, display_name: `Creator ${index}`, role: "Worker", active: true }, ...overrides });
let rows: Row[], excludedWorkers: string[], moderated: string[], reads: string[], rpcBodies: Record<string, unknown>[], administrator: boolean, failure: string | null, stale: boolean;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://upi.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.ADMIN_EMAIL = "operator@example.test";
  rows = [row(1)]; excludedWorkers = []; moderated = []; reads = []; rpcBodies = []; administrator = true; failure = null; stale = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://upi.example.test", "no live data may be read or changed");
    const table = url.pathname.replace("/rest/v1/", "");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: admin, email: administrator ? "operator@example.test" : "creator@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (table === "rpc/app_is_admin") return Response.json(administrator);
    if (table === "profiles" && url.searchParams.has("id") && url.searchParams.get("id") === `eq.${admin}`) return Response.json([{ worker_code: "ADMIN", active: true }]);
    if (table === "workers" && url.searchParams.get("user_id") === `eq.${admin}`) return Response.json([{ id: "ADMIN", active: true }]);
    if (table.startsWith("rpc/")) {
      const body = JSON.parse(String(init?.body)); rpcBodies.push(body);
      if (table === "rpc/verify_upi_config") return stale ? Response.json({ code: "P0001", message: "invalid_transition" }, { status: 400 }) : Response.json({ worker_id: body.p_worker, upi_id: body.p_upi, verified: body.p_verified });
      if (table === "rpc/save_upi_config") return Response.json({ worker_id: admin, upi_id: body.p_upi, verified: false, updated_at: "2026-10-30T02:00:00Z", payout_schedule: body.p_schedule, payout_day: body.p_day });
      assert.fail(`Unexpected mutation ${table}`);
    }
    assert.ok(!init?.method || init.method === "GET", "queue reads must not mutate or stamp payment details");
    reads.push(table);
    if (failure === table) return Response.json({ message: "unavailable" }, { status: 503 });
    if (table === "upi_configs") {
      if (!url.searchParams.has("profile.role")) return Response.json(rows);
      assert.equal(url.searchParams.get("verified"), "eq.false");
      assert.equal(url.searchParams.get("upi_id"), "neq.");
      assert.equal(url.searchParams.get("profile.role"), "eq.Worker");
      assert.equal(url.searchParams.get("profile.active"), "eq.true");
      assert.match(url.searchParams.get("select") ?? "", /profiles!inner/);
      assert.equal(url.searchParams.get("order"), "worker_id.asc");
      const cursor = url.searchParams.get("worker_id")?.replace(/^gt\./, "") ?? "";
      return Response.json(rows.filter(item => !item.verified && item.upi_id !== "" && item.profile.active && item.profile.role === "Worker" && item.worker_id > cursor).sort((a,b) => a.worker_id.localeCompare(b.worker_id)).slice(0, Number(url.searchParams.get("limit"))));
    }
    if (table === "workers" || table === "worker_moderation") {
      const ids = url.searchParams.get("user_id")?.slice(4, -1).split(",") ?? [];
      assert.equal(url.searchParams.get(table === "workers" ? "active" : "status"), table === "workers" ? "eq.false" : "neq.active");
      return Response.json((table === "workers" ? excludedWorkers : moderated).filter(id => ids.includes(id)).map(user_id => ({ user_id })));
    }
    if (table === "profiles") return Response.json(rows.map(item => ({ id: item.worker_id, worker_code: item.profile.worker_code, display_name: item.profile.display_name })));
    assert.fail(`Unexpected read ${url.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const context = { params: Promise.resolve({}) };
const request = (query = "?status=pending&limit=5") => new NextRequest(`https://app.example.test/api/admin/upi-configs${query}`, { headers: { authorization: "Bearer test-session" } });
const mutation = (path: string, method: string, body: unknown) => new NextRequest(`https://app.example.test${path}`, { method, headers: { authorization: "Bearer test-session", "content-type": "application/json" }, body: JSON.stringify(body) });

test("pending queue excludes verified, inactive, admin and moderated profiles with an exact count", async () => {
  rows = Array.from({ length: 8 }, (_, i) => row(i));
  rows[1].verified = true; rows[2].profile.active = false; rows[3].profile.role = "Admin"; rows[4].upi_id = "   ";
  excludedWorkers = [rows[5].worker_id]; moderated = [rows[6].worker_id];
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pendingCount, 2);
  assert.deepEqual(result.upiConfigs.map((item: { workerCode: string }) => item.workerCode), ["WKR-7", "WKR-0"]);
  assert.equal(result.upiConfigs[0].workerName, "Creator 7");
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.ok(!reads.includes("snapshot"));
});

test("pending count spans multiple database pages while the preview stays capped and latest first", async () => {
  rows = Array.from({ length: 405 }, (_, i) => row(i));
  rows[0].updated_at = null;
  const response = await GET(request("?status=pending&limit=5"), context);
  const result = await response.json();
  assert.equal(result.pendingCount, 405);
  assert.equal(result.upiConfigs.length, 5);
  assert.deepEqual(result.upiConfigs.map((item: { workerCode: string }) => item.workerCode), [404, 403, 402, 401, 400].map(i => `WKR-${i}`));
  assert.equal(reads.filter(table => table === "upi_configs").length, 3);
});

test("unknown historical timestamps and empty queues stay honest", async () => {
  rows[0].updated_at = null;
  let result = await (await GET(request(), context)).json();
  assert.equal("updatedAt" in result.upiConfigs[0], false);
  rows = [];
  result = await (await GET(request(), context)).json();
  assert.deepEqual(result, { ok: true, pendingCount: 0, upiConfigs: [] });
});

test("failed eligibility checks never turn a pending queue into a false empty state", async () => {
  for (const table of ["upi_configs", "workers", "worker_moderation"]) {
    failure = table;
    assert.equal((await GET(request(), context)).status, 503);
  }
});

test("queue validates limits and keeps the legacy all-configs response compatible", async () => {
  for (const query of ["?status=verified", "?status=pending&limit=0", "?status=pending&limit=21", "?status=pending&limit=5x"]) assert.equal((await GET(request(query), context)).status, 400);
  const response = await GET(request(""), context);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal("pendingCount" in result, false);
  assert.equal(result.upiConfigs[0].upiId, rows[0].upi_id);
  assert.equal(result.upiConfigs[0].workerCode, "WKR-1");
});

test("only admins can read or verify the queue, and exact saved IDs are forwarded unchanged", async () => {
  const response = await PATCH(mutation("/api/admin/upi-configs", "PATCH", { workerId: worker, upiId: "checked@bank", verified: true }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(rpcBodies, [{ p_actor: admin, p_worker: worker, p_upi: "checked@bank", p_verified: true }]);
  administrator = false;
  assert.equal((await GET(request(), context)).status, 403);
  assert.equal((await PATCH(mutation("/api/admin/upi-configs", "PATCH", { workerId: worker, upiId: "checked@bank", verified: true }), context)).status, 403);
  assert.equal((await GET(new NextRequest("https://app.example.test/api/admin/upi-configs?status=pending"), context)).status, 401);
  assert.equal(rpcBodies.length, 1);
});

test("a changed UPI returns conflict so the feed can refresh before another review", async () => {
  stale = true;
  const response = await PATCH(mutation("/api/admin/upi-configs", "PATCH", { workerId: worker, upiId: "old@bank", verified: true }), context);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "invalid_transition");
});

test("creator saves return the atomic RPC result without a second timestamp update", async () => {
  administrator = false;
  const response = await PUT(mutation("/api/upi", "PUT", { upiId: "new@bank", payoutSchedule: "Weekly", payoutDay: "Fri" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { upiId: "new@bank", verified: false, updatedAt: "2026-10-30T02:00:00Z", payoutSchedule: "Weekly", payoutDay: "Fri" });
  assert.deepEqual(rpcBodies, [{ p_worker: admin, p_upi: "new@bank", p_schedule: "Weekly", p_day: "Fri" }]);
  assert.deepEqual(reads, []);
});
