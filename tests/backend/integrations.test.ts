import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSyncConfig, testSyncProvider } from '../../lib/api/integrations';

const env = { ...process.env };
const realFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...env };
  globalThis.fetch = realFetch;
});

test('environment variables are used first and reported as the source', async () => {
  process.env.YOUTUBE_API_KEY = 'yt-from-env';
  delete process.env.META_GRAPH_ACCESS_TOKEN;
  const config = await resolveSyncConfig();
  assert.equal(config.youtubeApiKey, 'yt-from-env');
  assert.equal(config.source.youtubeApiKey, 'env');
  assert.notEqual(config.source.metaAccessToken, 'env');
});

test('connection tests explain what is missing or wrong without exposing the key', async () => {
  delete process.env.META_GRAPH_ACCESS_TOKEN;
  delete process.env.META_IG_BUSINESS_ACCOUNT_ID;
  globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
  const blocked = await testSyncProvider('instagram', { instagramHandle: 'reelencer.hq' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /limited profile reads/);

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 })) as typeof fetch;
  const bad = await testSyncProvider('youtube', { youtubeApiKey: 'secret-key-123' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /API key not valid/);
  assert.doesNotMatch(bad.message, /secret-key-123/);

  globalThis.fetch = (async (input) => {
    assert.equal(String(input), 'https://www.instagram.com/reelencer.hq/');
    return new Response('<meta property="og:description" content="10 Followers, 2 Following, 3 Posts - Reelencer (@reelencer.hq)">', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const ok = await testSyncProvider('instagram', { instagramHandle: 'reelencer.hq' });
  assert.deepEqual(ok.ok, true);
  assert.match(ok.message, /10 followers/);
});
