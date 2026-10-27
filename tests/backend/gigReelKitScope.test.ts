import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, PATCH, POST } from "../../app/api/gigs/route";
import { DEFAULT_REEL_KIT, encodeReelKit, parseCompanyReelKit, parseReelKit } from "../../lib/reelKit";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const userId = "11111111-1111-4111-8111-111111111111";
const reelencerId = "REELENCER-GIG";
const secondReelencerId = "SECOND-REELENCER-GIG";
// Even the previously eligible ID must lose access when its company is different.
const otherId = "GIG-MGMPU";
const picture = "Media::https://media.example.test/reference.png";
const kit = { ...DEFAULT_REEL_KIT, approved: 50898.47, paidOut: 29310.2 };
const kitLine = `Media::${encodeReelKit(kit)}`;
type Row = Record<string, unknown>;
let rows: Row[];
let writes: Row[];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gig-kit-scope.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.ADMIN_EMAIL = "operator@example.test";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
  rows = [reelencerId, secondReelencerId, otherId].map(id => ({ id, title: "Same reaction-video title", company: id === otherId ? "Another brand" : id === secondReelencerId ? " reelencer " : "Reelencer", workload: "Reels", payout: "₹49", payout_type: "Per 1k Views", gig_type: "Content Posting", requirements: [picture, kitLine], status: "Open" }));
  writes = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://gig-kit-scope.example.test", "never contact a live service");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId, email: "operator@example.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: userId, worker_code: "ADMIN", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "ADMIN", active: true }]);
    if (["/rest/v1/rpc/app_is_admin", "/rest/v1/rpc/consume_api_rate_limit"].includes(url.pathname)) return Response.json(true);
    if (url.pathname === "/rest/v1/gigs") {
      if (init?.method === "PATCH" || init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? body.id ?? `GENERATED-${writes.length}`;
        const next = { ...rows.find(row => row.id === id), ...body, id };
        rows = [...rows.filter(row => row.id !== id), next];
        return Response.json(next);
      }
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      return Response.json(id ? rows.find(row => row.id === id) ?? null : rows);
    }
    throw new Error(`Unexpected test read: ${url.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const context = { params: Promise.resolve({}) };
const request = (method: string, body?: unknown) => new NextRequest("https://app.example.test/api/gigs", { method, headers: { authorization: "Bearer admin-session", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("gig reads retain every Reelencer gig's figures and hide kits from other companies, regardless of ID", async () => {
  const response = await GET(request("GET"), context);
  assert.equal(response.status, 200);
  const gigs = await response.json();
  assert.deepEqual(parseCompanyReelKit(gigs[0].company, gigs[0].requirements), kit);
  assert.deepEqual(parseCompanyReelKit(gigs[1].company, gigs[1].requirements), kit);
  assert.deepEqual(gigs[2].requirements, [picture]);
  assert.equal(parseReelKit(gigs[2].requirements), null);
  assert.equal(writes.length, 0);
});

test("new gigs can save the kit when their company is Reelencer", async () => {
  for (const id of ["NEW-GIG", undefined]) {
    const response = await POST(request("POST", { id, title: "A new campaign", company: " REELENCER ", workload: "Reels", payout: "₹49", gigType: "Content Posting", requirements: [picture, kitLine] }), context);
    assert.equal(response.status, 200);
    const gig = await response.json();
    assert.deepEqual(parseCompanyReelKit(gig.company, gig.requirements), kit);
  }
  assert.equal(writes.length, 2);
});

test("new gigs for other companies cannot save a copied kit", async () => {
  for (const company of ["Another brand", "Reelencer Studio", "My Reelencer"]) {
    const response = await POST(request("POST", { title: "Same reaction-video title", company, workload: "Reels", payout: "₹49", gigType: "Content Posting", requirements: [picture, kitLine] }), context);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "reel_kit_scope");
  }
  assert.equal(writes.length, 0);
});

test("a different company cannot enable the kit with a requirements-only update", async () => {
  const response = await PATCH(request("PATCH", { id: otherId, updates: { title: rows[0].title, requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "reel_kit_scope");
  assert.equal(writes.length, 0);
});

test("requirements-only updates use the stored company and retain eligible wallet figures", async () => {
  const response = await PATCH(request("PATCH", { id: secondReelencerId, updates: { title: "Renamed campaign", requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 200);
  const gig = await response.json();
  assert.equal(gig.title, "Renamed campaign");
  assert.deepEqual(parseCompanyReelKit(gig.company, gig.requirements), kit);
  assert.equal(writes.length, 1);
});

test("ordinary reference-file changes on other gigs still save without a wallet kit", async () => {
  const response = await PATCH(request("PATCH", { id: otherId, updates: { requirements: [picture, "Brief::Ordinary creator brief"] } }), context);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).requirements, [picture, "Brief::Ordinary creator brief"]);
  assert.equal(writes.length, 1);
});

test("changing only the company away from Reelencer removes the kit and preserves other references", async () => {
  const response = await PATCH(request("PATCH", { id: reelencerId, updates: { company: "Another brand" } }), context);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).requirements, [picture]);
  assert.deepEqual(writes[0].requirements, [picture]);

  const restored = await PATCH(request("PATCH", { id: reelencerId, updates: { company: "Reelencer" } }), context);
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).requirements, [picture], "the removed kit must not return after a later rename");
});

test("changing to another company with an explicitly retained kit is rejected", async () => {
  const response = await PATCH(request("PATCH", { id: reelencerId, updates: { company: "Another brand", requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "reel_kit_scope");
  assert.equal(writes.length, 0);
});

test("changing a gig's company to Reelencer allows its own kit configuration", async () => {
  const response = await PATCH(request("PATCH", { id: otherId, updates: { company: "Reelencer", requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 200);
  const gig = await response.json();
  assert.deepEqual(parseCompanyReelKit(gig.company, gig.requirements), kit);
});

test("case-only company changes and unrelated updates preserve Reelencer's saved kit", async () => {
  for (const updates of [{ company: "REELENCER" }, { status: "Paused" }]) {
    const response = await PATCH(request("PATCH", { id: reelencerId, updates }), context);
    assert.equal(response.status, 200);
    const gig = await response.json();
    assert.deepEqual(parseCompanyReelKit(gig.company, gig.requirements), kit);
  }
});

test("updating a missing gig cannot bypass company validation", async () => {
  const response = await PATCH(request("PATCH", { id: "MISSING-GIG", updates: { requirements: [kitLine] } }), context);
  assert.equal(response.status, 404);
  assert.equal(writes.length, 0);
});

test("development gigs preserve kits on partial updates and remove them on a company change", async () => {
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "true";
  const created = await POST(request("POST", { id: "DEV-COMPANY-KIT", title: "Development campaign", company: "Reelencer", workload: "Reels", payout: "₹49", gigType: "Content Posting", requirements: [picture, kitLine] }), context);
  assert.equal(created.status, 200);
  const retained = await PATCH(request("PATCH", { id: "DEV-COMPANY-KIT", updates: { status: "Paused" } }), context);
  assert.equal(retained.status, 200);
  assert.deepEqual(parseReelKit((await retained.json()).requirements), kit);
  const removed = await PATCH(request("PATCH", { id: "DEV-COMPANY-KIT", updates: { company: "Another brand" } }), context);
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).requirements, [picture]);
  assert.equal(writes.length, 0, "development fixtures must not write to the database");
});
