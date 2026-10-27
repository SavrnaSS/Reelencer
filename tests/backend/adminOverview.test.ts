import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/admin/overview/route";
import { isAdminOverviewCounts } from "../../lib/adminOverview";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const userId = "11111111-1111-4111-8111-111111111111";
let administrator: boolean;
let failure: string | null;
let missingCount: string | null;
let counts: Record<string, number>;
let reads: string[];
const statuses: Record<string, string[]> = {
  linked_social_accounts: ["active", "paused", "active", "unlinked"],
  view_payout_claims: ["Pending", "Approved", "Rejected", "Hard rejected"],
  payout_batches: ["Draft", "Processing", "Paid", "Failed"],
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://overview.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.ADMIN_EMAIL = "operator@example.test";
  administrator = true; failure = null; missingCount = null; counts = {}; reads = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://overview.example.test", "never contact a live service");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId, email: administrator ? "operator@example.test" : "worker@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ worker_code: "WKR-TEST", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "WKR-TEST", active: true }]);
    if (url.pathname === "/rest/v1/rpc/app_is_admin") return Response.json(administrator);
    const table = url.pathname.replace("/rest/v1/", "");
    assert.ok(table in statuses, "only the actual linked-account and payout tables may supply counts");
    assert.equal(init?.method, "HEAD", "do not fetch private account or financial records for counters");
    assert.equal(url.searchParams.get("select"), "id");
    assert.equal(url.searchParams.has("limit"), false, "totals must not be capped by a row limit");
    assert.equal(new Headers(init?.headers).get("prefer"), "count=exact");
    reads.push(table);
    if (failure === table) return new Response(null, { status: 503 });
    const filter = url.searchParams.get("status");
    assert.equal(filter, table === "linked_social_accounts" ? "in.(active,paused)" : table === "view_payout_claims" ? "eq.Pending" : "in.(Draft,Processing)");
    const allowed = filter!.startsWith("eq.") ? [filter!.slice(3)] : filter!.slice(4,-1).split(",");
    const count = counts[table] ?? statuses[table].filter(status => allowed.includes(status)).length;
    return new Response(null, { headers: missingCount === table ? {} : { "content-range": `*/${count}` } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const request = () => new NextRequest("https://app.example.test/api/admin/overview", { headers: { authorization: "Bearer test-session" } });
const context = { params: Promise.resolve({}) };

test("overview counts linked accounts and pending claims/withdrawals, excluding unlinked and completed records", async () => {
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { linkedAccounts: 3, pendingClaims: 1, pendingWithdrawals: 2, pendingPayouts: 3 });
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.equal(reads.length, 3);
});

test("exact totals remain accurate above the hosted database row cap", async () => {
  counts = { linked_social_accounts: 2501, view_payout_claims: 1201, payout_batches: 1001 };
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { linkedAccounts: 2501, pendingClaims: 1201, pendingWithdrawals: 1001, pendingPayouts: 2202 });
});

test("an empty queue is a verified zero", async () => {
  counts = { linked_social_accounts: 0, view_payout_claims: 0, payout_batches: 0 };
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { linkedAccounts: 0, pendingClaims: 0, pendingWithdrawals: 0, pendingPayouts: 0 });
});

test("failed or missing counts are unavailable rather than reported as zero", async () => {
  for (const table of Object.keys(statuses)) {
    failure = table;
    assert.equal((await GET(request(), context)).status, 503);
  }
  failure = null; missingCount = "view_payout_claims";
  const response = await GET(request(), context);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "overview_unavailable");
});

test("workers and signed-out visitors cannot read administrator totals", async () => {
  administrator = false;
  assert.equal((await GET(request(), context)).status, 403);
  assert.equal((await GET(new NextRequest("https://app.example.test/api/admin/overview"), context)).status, 401);
  assert.equal(reads.length, 0);
});

test("the cache validator rejects incomplete, negative and inconsistent totals", () => {
  const valid = { linkedAccounts: 3, pendingClaims: 1, pendingWithdrawals: 2, pendingPayouts: 3 };
  assert.equal(isAdminOverviewCounts(valid), true);
  for (const value of [null, {}, { ...valid, linkedAccounts: null }, { ...valid, linkedAccounts: "3" }, { ...valid, pendingClaims: -1 }, { ...valid, pendingWithdrawals: 1.5 }, { ...valid, pendingPayouts: 0 }]) {
    assert.equal(isAdminOverviewCounts(value), false);
  }
});
