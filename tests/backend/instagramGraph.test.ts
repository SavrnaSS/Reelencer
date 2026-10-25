import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchInstagramBusinessProfile } from "../../lib/api/instagramGraph";
import { SocialSyncError } from "../../lib/socialSyncSchedule";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const config = { metaAccessToken: "private-api-token", metaIgBusinessId: "1784000001" };
const response = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("official discovery authenticates in headers, verifies the handle and never invents reel views", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "graph.facebook.com");
    assert.equal(url.search.includes(config.metaAccessToken), false);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${config.metaAccessToken}`);
    assert.match(url.searchParams.get("fields")!, /business_discovery.username\(creator\)/);
    return response({ business_discovery: { id: "123", username: "creator", followers_count: 900, follows_count: 4, media_count: 3, media: { data: [
      { permalink: "https://www.instagram.com/reel/ABC/", timestamp: "2026-10-01T12:00:00Z", like_count: 0, comments_count: 2 },
      { permalink: "https://evil.example/reel/FAKE/", like_count: 999 },
    ] } } });
  };
  const result = await fetchInstagramBusinessProfile("@creator", config);
  assert.equal(result.followers, 900);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].likes, 0);
  assert.equal(result.media[0].views, undefined);
  assert.equal(result.media[0].externalId, "ig:ABC");
  globalThis.fetch = async () => response({ business_discovery: { username: "another", followers_count: 900 } });
  await assert.rejects(fetchInstagramBusinessProfile("creator", config), /requested account/);
});

test("Meta quota and expired token errors are classified without exposing response secrets", async () => {
  globalThis.fetch = async () => response({ error: { code: 190, message: config.metaAccessToken } }, 400);
  await assert.rejects(fetchInstagramBusinessProfile("creator", config), error => error instanceof SocialSyncError && error.code === "credentials" && !error.message.includes(config.metaAccessToken));
  globalThis.fetch = async () => response({ error: { code: 4 } }, 429, { "retry-after": "7200" });
  await assert.rejects(fetchInstagramBusinessProfile("creator", config), error => error instanceof SocialSyncError && error.code === "rate_limited" && error.retryAfterMs === 7_200_000);
});
