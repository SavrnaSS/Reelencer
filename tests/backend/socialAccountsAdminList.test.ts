import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { listAllAccounts } from "../../lib/api/socialAccounts";

type Row = Record<string, unknown>;
const savedEnv = { ...process.env };
const realFetch = globalThis.fetch;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACCOUNTS = 1234;
let longestUrl: number;

const ids = (filter: string | null) => (filter?.match(/^in\.\((.*)\)$/)?.[1] ?? "").split(",").filter(Boolean);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://backend.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  longestUrl = 0;
  const accounts: Row[] = Array.from({ length: ACCOUNTS }, (_, i) => ({ id: uuid(i), application_id: uuid(i), gig_id: uuid(1_000_000 + (i % 3)), worker_code: `WKR-${i}`,
    platform: "Instagram", handle: `creator${i}`, profile_url: `https://www.instagram.com/creator${i}/`, status: "active", linked_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    assert.equal(url.origin, "https://backend.example.test", "Tests must never contact a real service");
    longestUrl = Math.max(longestUrl, url.href.length);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? Infinity);
    const page = (rows: Row[]) => json(rows.slice(offset, offset + limit));
    if (url.pathname === "/rest/v1/linked_social_accounts") return page([...accounts].reverse());
    if (url.pathname === "/rest/v1/social_account_posts") return page(ids(url.searchParams.get("account_id")).map(id => ({ id: id.replace(/^0/, "p"), account_id: id,
      url: `https://www.instagram.com/reel/${id}/`, status: "approved", submitted_by_worker: true, source: "profile", views: 10, created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" })));
    if (url.pathname === "/rest/v1/social_account_snapshots") return json(ids(url.searchParams.get("account_id")).map(id => ({ id: id.replace(/^0/, "s"), account_id: id,
      captured_at: new Date().toISOString(), period_days: 1, followers: 100, source: "profile" })));
    if (url.pathname === "/rest/v1/gigs") return json(ids(url.searchParams.get("id")).map(id => ({ id, title: `Gig ${id.slice(-1)}`, company: "Co", payout: "100", payout_type: "per_reel" })));
    if (url.pathname === "/rest/v1/rpc/social_post_wallet_state") return json({ posts: [], accounts: [] });
    return json([]);
  };
});

afterEach(() => { globalThis.fetch = realFetch; process.env = { ...savedEnv }; });

test("the admin list returns every linked account with its own reels while keeping each request URL short", async () => {
  const accounts = await listAllAccounts();
  assert.equal(accounts.length, ACCOUNTS, "accounts past the first page are included");
  assert.equal(new Set(accounts.map(account => account.id)).size, ACCOUNTS);
  for (const account of accounts) {
    assert.deepEqual(account.posts.map(post => post.id), [account.id.replace(/^0/, "p")]);
    assert.equal(account.snapshots.length, 1);
    assert.ok(account.gigTitle);
  }
  assert.ok(longestUrl < 8_000, `longest request URL was ${longestUrl} characters`);
});
