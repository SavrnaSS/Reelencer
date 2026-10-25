import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { readCurrentApplications } from "../../lib/api/applicationReads";
import { loadAutomationApplications } from "../../lib/api/applicationAutomation";
import { applyApplicationUpdate } from "../../lib/api/gigApplications";
import { GET } from "../../app/api/gig-applications/route";

const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
const id = "33333333-3333-4333-8333-333333333333";
const calls: URL[] = [];
let cap = 100, unavailable = false;
const rows = Array.from({ length: 1105 }, (_, index) => ({ id: `app-${index}`, gig_id: "gig-1", worker_code: "WKR-CURRENT", worker_name: "Current Creator", status: "Pending", applied_at: "2026-10-25T10:00:00Z" }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
before(() => {
  process.env = { ...oldEnv, NEXT_PUBLIC_SUPABASE_URL: "https://applications.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", ADMIN_EMAIL: "operator@example.test", NEXT_PUBLIC_ENABLE_DEMO_MODE: "false" };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://applications.example.test", "No real services are contacted");
    calls.push(url);
    if (url.pathname === "/auth/v1/user") return json({ id, email: "operator@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/rpc/app_is_admin") return json(true);
    if (url.pathname === "/rest/v1/profiles") return json([{ id, worker_code: "ADMIN", role: "Admin", active: true }]);
    if (url.pathname === "/rest/v1/workers") return json([]);
    assert.equal(url.pathname, "/rest/v1/current_gig_applications", "Raw retained applications must not feed operational reads");
    assert.equal(init?.method ?? "GET", "GET", "Hidden applications cannot reach an update or email request");
    if (unavailable) return json({ code: "08006", message: "Data temporarily unavailable" }, 503);
    if (url.searchParams.has("id")) return json([]);
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Math.min(cap, Number(url.searchParams.get("limit") ?? 1000));
    return json(rows.slice(offset, offset + limit));
  };
});
beforeEach(() => { calls.length = 0; cap = 100; unavailable = false; });
after(() => { globalThis.fetch = oldFetch; process.env = oldEnv; });
const client = () => createClient("https://applications.example.test", "test-service", { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });

test("application pagination proves completeness beyond 1,000 rows even with a smaller server page cap", async () => {
  const result = await readCurrentApplications(client(), { gigId: "gig-1", workerAliases: ["WKR-CURRENT", id] });
  assert.equal(result.length, 1105);
  assert.equal(new Set(result.map(row => row.id)).size, 1105);
  assert.equal(Number(calls.at(-1)?.searchParams.get("offset")), 1105);
  assert.ok(calls.every(url => url.searchParams.get("order") === "applied_at.desc,id.desc" && url.searchParams.get("gig_id") === "eq.gig-1" && url.searchParams.has("worker_code")));
});

test("the authenticated application feed and automation matching share the same filtered source", async () => {
  cap = 1000;
  const response = await GET(new NextRequest("https://app.example.test/api/gig-applications?gigId=gig-1", { headers: { authorization: "Bearer admin" } }), { params: Promise.resolve({}) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 1105);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const apps = await loadAutomationApplications();
  assert.equal(apps.length, 1105);
});

test("an application hidden after deletion cannot be edited or notified from a stale direct ID", async () => {
  await assert.rejects(applyApplicationUpdate({ userId: id, isAdmin: true, aliases: [] }, "deleted-app", { status: "Accepted" }), /Application not found/);
  assert.equal(calls.length, 1);
});

test("a failed ownership-aware read fails closed instead of falling back to unfiltered rows", async () => {
  unavailable = true;
  await assert.rejects(readCurrentApplications(client()), /data service is unavailable/i);
  assert.equal(calls.length, 1);
});
