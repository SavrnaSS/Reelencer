import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, PATCH, POST } from "../../app/api/gigs/route";
import { DEFAULT_REEL_KIT, REEL_KIT_GIG_ID, encodeReelKit, parseGigReelKit, parseReelKit } from "../../lib/reelKit";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const userId = "11111111-1111-4111-8111-111111111111";
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
  rows = [REEL_KIT_GIG_ID, "OTHER-GIG"].map(id => ({ id, title: "Same reaction-video title", company: "Brand", workload: "Reels", payout: "₹49", payout_type: "Per 1k Views", gig_type: "Content Posting", requirements: [picture, kitLine], status: "Open" }));
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
        const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? body.id;
        const next = { ...rows.find(row => row.id === id), ...body, id };
        rows = [...rows.filter(row => row.id !== id), next];
        return Response.json(next);
      }
      return Response.json(rows);
    }
    throw new Error(`Unexpected test read: ${url.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const context = { params: Promise.resolve({}) };
const request = (method: string, body?: unknown) => new NextRequest("https://app.example.test/api/gigs", { method, headers: { authorization: "Bearer admin-session", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("gig reads retain the owner's configured figures and hide copied kit metadata on other gigs", async () => {
  const response = await GET(request("GET"), context);
  assert.equal(response.status, 200);
  const gigs = await response.json();
  assert.deepEqual(parseGigReelKit(REEL_KIT_GIG_ID, gigs[0].requirements), kit);
  assert.deepEqual(gigs[1].requirements, [picture]);
  assert.equal(parseReelKit(gigs[1].requirements), null);
  assert.equal(writes.length, 0);
});

test("new gigs cannot acquire the wallet kit through a copied create payload", async () => {
  for (const id of ["NEW-GIG", undefined]) {
    const response = await POST(request("POST", { id, title: "Same reaction-video title", company: "Brand", workload: "Reels", payout: "₹49", gigType: "Content Posting", requirements: [picture, kitLine] }), context);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "reel_kit_scope");
  }
  assert.equal(writes.length, 0);
});

test("a different gig cannot enable the kit by copying the original gig title and settings", async () => {
  const response = await PATCH(request("PATCH", { id: "OTHER-GIG", updates: { title: rows[0].title, requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "reel_kit_scope");
  assert.equal(writes.length, 0);
});

test("renaming the original gig keeps its wallet configuration attached to the same saved record", async () => {
  const response = await PATCH(request("PATCH", { id: REEL_KIT_GIG_ID, updates: { title: "Renamed campaign", requirements: [picture, kitLine] } }), context);
  assert.equal(response.status, 200);
  const gig = await response.json();
  assert.equal(gig.title, "Renamed campaign");
  assert.deepEqual(parseGigReelKit(gig.id, gig.requirements), kit);
  assert.equal(writes.length, 1);
});

test("ordinary reference-file changes on other gigs still save without a wallet kit", async () => {
  const response = await PATCH(request("PATCH", { id: "OTHER-GIG", updates: { requirements: [picture, "Brief::Ordinary creator brief"] } }), context);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).requirements, [picture, "Brief::Ordinary creator brief"]);
  assert.equal(writes.length, 1);
});
