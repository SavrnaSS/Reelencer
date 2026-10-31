import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { payoutHistoryMetadata, payoutHistoryPostId, safePayoutReelUrl } from "../../lib/payoutHistoryMetadata";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/payoutbatches/route";

const postId = "33333333-3333-4333-8333-333333333333";

test("payout history returns readable ledger titles without exposing review or submission details", () => {
  const metadata = payoutHistoryMetadata({ title: " Approved\nreel view earnings ", submission: { postId, password: "private" }, review: { note: "private review" } }, "https://www.instagram.com/reel/ABC123/?igsh=secret");
  assert.deepEqual(metadata, { workItemTitle: "Approved reel view earnings", reelUrl: "https://www.instagram.com/reel/ABC123/" });
  assert.equal(payoutHistoryPostId({ submission: { postId } }), postId);
  assert.equal(payoutHistoryPostId({ review: { postId } }), postId);
});

test("missing and internal-ID titles leave the UI's readable fallback available", () => {
  for (const title of [undefined, null, "  ", postId, `VIEW-${postId}`, `REEL-${postId}`]) {
    assert.equal(payoutHistoryMetadata({ title }).workItemTitle, undefined);
  }
  assert.deepEqual(payoutHistoryMetadata(undefined), { workItemTitle: undefined, reelUrl: undefined });
  assert.equal(payoutHistoryMetadata({ title: "x".repeat(200) }).workItemTitle?.length, 180);
  for (const submission of [null, [], { postId: "not-a-uuid" }, { postId: 123 }]) assert.equal(payoutHistoryPostId({ submission }), undefined);
});

test("legacy work submission links and current reel links use safe canonical permalinks", () => {
  assert.equal(payoutHistoryMetadata({ title: "Reaction reel", submission: { reelUrl: "https://m.instagram.com/p/ABC123/?tracking=secret" } }).reelUrl, "https://www.instagram.com/reel/ABC123/");
  for (const url of ["https://youtu.be/abcDEF12345?si=secret", "https://www.youtube.com/shorts/abcDEF12345?feature=share", "https://m.youtube.com/watch?v=abcDEF12345&list=secret"]) {
    assert.equal(safePayoutReelUrl(url), "https://www.youtube.com/watch?v=abcDEF12345");
  }
  assert.equal(payoutHistoryMetadata({ submission: { reelUrl: "https://www.instagram.com/reel/SAFE/" } }, "https://evil.example/reel/").reelUrl, "https://www.instagram.com/reel/SAFE/");
});

test("untrusted URLs cannot create payout history external links", () => {
  for (const url of [undefined, 12, "javascript:alert(1)", "http://www.instagram.com/reel/ABC/", "https://instagram.com.evil.example/reel/ABC/", "https://name:password@www.instagram.com/reel/ABC/", "https://www.youtube.com/redirect?v=abcDEF12345", "https://youtu.be/abcDEF12345/extra", "https://www.instagram.com/accounts/login/", "https://www.instagram.com:444/reel/ABC/", "https://www.youtube.com/watch?v=bad%3Cscript%3E"]) {
    assert.equal(safePayoutReelUrl(url), undefined, `unsafe or unsupported URL ${String(url)}`);
  }
});

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const workId = "44444444-4444-4444-8444-444444444444";
const env = { ...process.env }, originalFetch = globalThis.fetch;
let reads: string[], linksUnavailable: boolean;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://history.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
  reads = []; linksUnavailable = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://history.example.test", "no live service may be contacted");
    assert.ok(!init?.method || init.method === "GET", "history reads must not mutate payments");
    reads.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner, email: "creator@example.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ worker_code: "CREATOR", active: true }]);
    if (url.pathname === "/rest/v1/workers") return Response.json([{ id: "CREATOR", active: true }]);
    if (url.pathname === "/rest/v1/payout_batches") {
      assert.equal(url.searchParams.get("worker_id"), `eq.${owner}`);
      return Response.json([{ id: "batch-1", worker_id: owner, cycle_label: "Withdrawal", period_start: "2026-10-31", period_end: "2026-10-31", status: "Paid", created_at: "2026-10-31T02:00:00Z", method: "UPI", payment_reference: "UTR-PAID-123", origin: "auto" }]);
    }
    if (url.pathname === "/rest/v1/payout_items") {
      assert.equal(url.searchParams.get("worker_id"), `eq.${owner}`);
      assert.equal(url.searchParams.get("batch_id"), "in.(batch-1)");
      return Response.json([{ id: "item-1", batch_id: "batch-1", work_item_id: workId, worker_id: owner, handle: "", amount_inr: "44.69", status: "Paid" }]);
    }
    if (url.pathname === "/rest/v1/work_items") {
      assert.equal(url.searchParams.get("worker_id"), `eq.${owner}`);
      assert.equal(url.searchParams.get("id"), `in.(${workId})`);
      return Response.json([{ id: workId, public_id: `VIEW-${postId}`, title: "Approved reel view earnings", submission: { postId, views: 912, password: "private" }, review: { source: "view_payout_claim", note: "private review" } }]);
    }
    if (url.pathname === "/rest/v1/social_account_posts") {
      assert.equal(url.searchParams.get("select"), "id,url");
      assert.equal(url.searchParams.get("id"), `in.(${postId})`);
      return linksUnavailable ? Response.json({ message: "reel unavailable" }, { status: 503 }) : Response.json([{ id: postId, url: "https://www.instagram.com/reel/PAID123/?igsh=secret" }]);
    }
    assert.fail(`Unexpected history read ${url.pathname}`);
  };
});
afterEach(() => { process.env = { ...env }; globalThis.fetch = originalFetch; });
const request = (workerId = "CREATOR") => new NextRequest(`https://app.example.test/api/payoutbatches?workerId=${workerId}`, { headers: { authorization: "Bearer test-session" } });
const context = { params: Promise.resolve({}) };

test("history API adds readable titles and public reel links while preserving exact payout data", async () => {
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  const [batch] = await response.json();
  assert.equal(batch.origin, "auto");
  assert.equal(batch.paymentReference, "UTR-PAID-123");
  assert.equal(batch.items[0].workItemTitle, "Approved reel view earnings");
  assert.equal(batch.items[0].reelUrl, "https://www.instagram.com/reel/PAID123/");
  assert.equal(batch.items[0].amountINR, 44.69);
  assert.equal(batch.items[0].workItemId, workId, "stable internal references remain available for existing consumers");
  assert.ok(!(JSON.stringify(batch).includes("private")), "private source details never become display metadata");
});

test("missing optional reel enrichment does not hide a valid payout history", async () => {
  linksUnavailable = true;
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  const [batch] = await response.json();
  assert.equal(batch.items[0].amountINR, 44.69);
  assert.equal(batch.items[0].workItemTitle, "Approved reel view earnings");
  assert.equal(batch.items[0].reelUrl, undefined);
});

test("history rejects another worker before reading their payout or reel metadata", async () => {
  const response = await GET(request(other), context);
  assert.equal(response.status, 403);
  assert.ok(!reads.some(path => path.includes("payout_") || path.endsWith("social_account_posts")));
});
