import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/social-accounts/route";

type Row = Record<string, unknown>;
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const postId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const savedEnv = { ...process.env };
const realFetch = globalThis.fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
let posts: Row[];
let account: Row;
let blocked: boolean;
let owner: string;
let discoveredDuringRead: boolean;
let writes: { method: string; body: Row }[];
let reads: string[];
let reelsTabViews: number | undefined;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://backend.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  posts = [];
  account = { id: accountId, worker_code: "WKR-TEST", handle: "creator", platform: "Instagram", status: "active" };
  blocked = false;
  owner = "creator";
  discoveredDuringRead = false;
  writes = [];
  reads = [];
  reelsTabViews = undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://www.instagram.com") {
      reads.push(url.href);
      if (blocked) return new Response(null, { status: 429 });
      if (discoveredDuringRead && !posts.length) posts.push(storedPost({ status: "approved", submitted_by_worker: false }));
      return new Response(`<script type="application/json">${JSON.stringify({ shortcode: "NEW", owner: { username: owner }, is_video: true,
        taken_at: Math.floor(Date.now() / 1000) - 90, video_view_count: url.pathname === "/creator/reels/" ? reelsTabViews ?? 0 : 0, like_count: 5, comment_count: 2, caption: { text: "Caption from Instagram" },
      })}</script>`, { headers: { "content-type": "text/html" } });
    }
    assert.equal(url.origin, "https://backend.example.test", "Tests must never contact a real service");
    const method = init?.method ?? "GET";
    if (url.pathname === "/auth/v1/user") return json({ id: userId, email: "qa@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return json([{ id: userId, worker_code: "WKR-TEST", active: true }]);
    if (url.pathname === "/rest/v1/workers") return json([{ id: "WKR-TEST", user_id: userId, active: true }]);
    if (url.pathname === "/rest/v1/rpc/consume_api_rate_limit") return json(true);
    if (url.pathname === "/rest/v1/linked_social_accounts") return json([account]);
    if (url.pathname === "/rest/v1/social_account_posts") {
      assert.equal(url.searchParams.get("account_id") ?? "eq." + accountId, "eq." + accountId);
      if (method === "GET") return json(posts);
      const body = JSON.parse(String(init?.body)) as Row;
      writes.push({ method, body });
      if (method === "POST") {
        if (posts.some(post => post.url === body.url)) return json({ code: "23505", message: "Duplicate" }, 409);
        const post = storedPost(body);
        posts.push(post);
        return json(post, 201);
      }
      if (method === "PATCH") {
        const post = posts.find(post => "eq." + String(post.id) === url.searchParams.get("id"));
        assert.ok(post);
        Object.assign(post, body);
        return json(post);
      }
    }
    throw new Error("Unexpected test request: " + url.pathname);
  };
});

afterEach(() => { globalThis.fetch = realFetch; process.env = { ...savedEnv }; });

function storedPost(values: Row = {}): Row {
  const now = new Date().toISOString();
  return { id: postId, account_id: accountId, url: "https://www.instagram.com/reel/NEW/", external_id: "ig:NEW", status: "submitted", submitted_by_worker: true,
    created_at: now, updated_at: now, source: "manual", caption: "", ...values };
}

async function submit(url = "https://www.instagram.com/reel/NEW/?igsh=shared") {
  return POST(new NextRequest("https://app.example.test/api/social-accounts", {
    method: "POST", headers: { authorization: "Bearer worker", "content-type": "application/json" },
    body: JSON.stringify({ action: "submit_reel", accountId, url, caption: "User fallback", postedAt: new Date().toISOString() }),
  }), { params: Promise.resolve({}) });
}

test("submitting a reel fetches its public metrics and saves one canonical pending-review record", async () => {
  const response = await submit();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.post.url, "https://www.instagram.com/reel/NEW/");
  assert.equal(payload.post.caption, "Caption from Instagram");
  assert.equal(payload.post.views, 0, "Measured zero stays distinct from unavailable");
  assert.equal(payload.post.likes, 5);
  assert.equal(payload.post.comments, 2);
  assert.equal(payload.post.viewsSource, "profile");
  assert.ok(payload.post.viewsCapturedAt);
  assert.equal(payload.post.status, "submitted");
  assert.equal(payload.alreadyAdded, false);
  assert.match(payload.message, /latest public stats/);
  assert.deepEqual(reads, ["https://www.instagram.com/reel/NEW/embed/", "https://www.instagram.com/reel/NEW/", "https://www.instagram.com/creator/reels/"]);
  const retry = await submit("https://m.instagram.com/p/NEW/?utm_source=share");
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).alreadyAdded, true);
  assert.equal(posts.length, 1);
});

test("creator submissions save current Reels-tab views when the embed and reel page lag", async () => {
  reelsTabViews = 2003;
  const response = await submit();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.post.views, 2003);
  assert.equal(payload.post.status, "submitted", "fresh metrics never approve the submission");
  assert.equal(payload.post.viewsSource, "profile");
  assert.equal(posts.length, 1);
  assert.equal(reads.length, 3, "direct reads remain bounded");
});

test("blocked reads still save a reel for review and never replace stored numbers on retry", async () => {
  blocked = true;
  const response = await submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.post.views, undefined);
  assert.equal(result.post.caption, "User fallback");
  assert.match(result.message, /automatic sync will retry/);
  assert.equal(reads.length, 1);
  Object.assign(posts[0], { views: 800, views_captured_at: "2026-10-08T00:00:00Z", views_source: "profile" });
  const retry = await submit();
  const saved = (await retry.json()).post;
  assert.equal(saved.views, 800);
  assert.equal(saved.viewsCapturedAt, "2026-10-08T00:00:00Z");
  assert.equal(posts.length, 1);
});

test("an already tracked reel retains its approval even with a full pending queue and another URL format", async () => {
  posts = [storedPost({ url: "https://instagram.com/p/NEW/?igsh=legacy", external_id: "", status: "approved", submitted_by_worker: false }),
    ...Array.from({ length: 30 }, (_, i) => storedPost({ id: "pending-" + i, url: `https://www.instagram.com/reel/PENDING${i}/`, external_id: `ig:PENDING${i}` })),
  ];
  const response = await submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.post.status, "approved");
  assert.equal(result.post.submittedByWorker, false);
  assert.equal(result.alreadyAdded, true);
  assert.equal(posts.length, 31);
  assert.ok(writes.every(write => !("status" in write.body)));
});

test("discovery during submission reuses the inserted record and preserves its review decision", async () => {
  discoveredDuringRead = true;
  const response = await submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.post.status, "approved");
  assert.equal(result.post.submittedByWorker, false);
  assert.equal(result.alreadyAdded, true);
  assert.equal(posts.length, 1);
  assert.ok(writes.some(write => write.method === "POST"));
  assert.ok(writes.filter(write => write.method === "PATCH").every(write => !("status" in write.body)));
});

test("profile links, another worker's account and a full new-submission queue fail before platform reads", async () => {
  assert.equal((await submit("https://www.instagram.com/creator/")).status, 400);
  account.worker_code = "WKR-OTHER";
  assert.equal((await submit()).status, 404);
  account.worker_code = "WKR-TEST";
  posts = Array.from({ length: 30 }, (_, i) => storedPost({ id: "pending-" + i, url: `https://www.instagram.com/reel/PENDING${i}/`, external_id: `ig:PENDING${i}` }));
  assert.equal((await submit()).status, 429);
  assert.equal(reads.length, 0);
  assert.equal(writes.length, 0);
});

test("another author's reel never contributes fetched metrics", async () => {
  owner = "someone.else";
  const response = await submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.post.views, undefined);
  assert.equal(result.post.likes, undefined);
  assert.equal(result.post.status, "submitted");
  assert.equal(result.post.caption, "User fallback");
});
