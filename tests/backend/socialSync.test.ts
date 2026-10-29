import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { accountSyncDue, runScheduledSocialSync, syncAccount, syncAvailability } from '../../lib/api/socialSync';
import { externalPostId, followerEngagementRate } from '../../lib/socialAnalytics';

type Row = Record<string, unknown>;

/** Minimal stand-in for the Supabase query builder: filters by eq(), records writes. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: 'insert' | 'update'; payload: Row; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      in: () => q,
      order: () => q,
      limit: () => q,
      update: (p: Row) => ((op = 'update'), (payload = p), q),
      upsert: () => Promise.resolve({ error: null }),
      insert: (p: Row) => (writes.push({ table, op: 'insert', payload: p, filters: [] }), Promise.resolve({ error: null })),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (op === 'update') writes.push({ table, op, payload, filters });
        return Promise.resolve(op === 'update' ? { data: [{ id: 'updated' }], error: null } : { data: rows(), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  const rpc = async (_name: string, args: Row) => ({ data: args.p_account_id ? [{ id: args.p_account_id, sync_lock_token: 'test-lease', last_sync_attempt_at: new Date().toISOString() }] : [], error: null });
  return { sb: { from, rpc } as never, writes };
}

const cfg = (values: Partial<{ youtubeApiKey: string; metaAccessToken: string; metaIgBusinessId: string }>) => ({
  youtubeApiKey: '', metaAccessToken: '', metaIgBusinessId: '', anthropicApiKey: '', ...values,
  source: { youtubeApiKey: 'env' as const, metaAccessToken: 'env' as const, metaIgBusinessId: 'env' as const, anthropicApiKey: 'env' as const },
});
const realFetch = globalThis.fetch;
const env = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});
const respond = (routes: [RegExp, unknown][]) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: 'not mocked' } }), { status: hit ? 200 : 404 });
  }) as typeof fetch;
};

test('public profiles refresh every five minutes and failed reads back off for thirty minutes', () => {
  const now = Date.now();
  const account = { status: 'active', platform: 'Instagram', sync_status: 'ok', last_synced_at: new Date(now - 4 * 60_000).toISOString() };
  assert.equal(accountSyncDue(account, now, 3 * 3_600_000), false);
  assert.equal(accountSyncDue(account, now + 60_000, 3 * 3_600_000), true);
  assert.equal(accountSyncDue({ ...account, sync_status: 'error' }, now + 60_000, 3 * 3_600_000), false);
  assert.equal(accountSyncDue({ ...account, sync_status: 'error' }, now + 26 * 60_000, 3 * 3_600_000), true);
  assert.equal(accountSyncDue({ ...account, last_synced_at: null }, now, 3 * 3_600_000), true);
  assert.equal(accountSyncDue({ ...account, last_synced_at: 'invalid' }, now, 3 * 3_600_000), true);
  assert.equal(accountSyncDue({ ...account, status: 'paused', last_synced_at: null }, now, 0), false);
  assert.equal(accountSyncDue({ ...account, platform: 'YouTube' }, now + 60_000, 3 * 3_600_000), false);
});

test('a single missing profile is rechecked; a repeated explicit absence unlinks it without deleting saved data', async () => {
  globalThis.fetch = async () => new Response('Profile missing', { status: 404 });
  for (const confirmed of [false, true]) {
    const health = confirmed ? { status: 'suspected', missingChecks: 1, firstMissingAt: new Date(Date.now() - 360_000).toISOString() } : {};
    const account = { id: `profile-missing-${confirmed}`, status: 'active', platform: 'Instagram', handle: 'creator', profile_health: health, last_synced_at: '2026-10-20T00:00:00Z' };
    const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
    const result = await syncAccount(sb, account, cfg({}));
    assert.equal(result.errorCode, 'not_found');
    const update = writes.find(write => write.table === 'linked_social_accounts')!;
    assert.equal((update.payload.profile_health as Row).status, confirmed ? 'missing' : 'suspected');
    assert.equal(update.payload.status, confirmed ? 'unlinked' : undefined);
    assert.equal(update.payload.last_synced_at, undefined);
    assert.equal(writes.filter(write => write.table !== 'linked_social_accounts').length, 0);
  }
});

test('login walls, access failures and missing Meta eligibility never remove an account', async () => {
  for (const status of [302, 401, 403, 429, 503]) {
    globalThis.fetch = async () => new Response('Blocked', { status });
    const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
    await syncAccount(sb, { id: `profile-blocked-${status}`, status: 'active', platform: 'Instagram', handle: 'creator', profile_health: { status: 'suspected', missingChecks: 1, firstMissingAt: '2026-10-01T00:00:00Z' } }, cfg({}));
    assert.ok(writes.every(write => write.payload.status !== 'unlinked'));
    assert.ok(writes.every(write => write.payload.profile_health === undefined));
  }
  globalThis.fetch = async input => String(input).includes('graph.facebook.com') ? new Response('{}', { headers: { 'content-type': 'application/json' } }) : new Response('Login', { status: 302 });
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  await syncAccount(sb, { id: 'ineligible-profile', status: 'active', platform: 'Instagram', handle: 'creator', profile_health: {} }, cfg({ metaAccessToken: 'test-token', metaIgBusinessId: '123' }));
  assert.ok(writes.every(write => write.payload.status !== 'unlinked'));
});

test('a successful profile read clears an earlier missing-profile observation', async () => {
  globalThis.fetch = async () => new Response('<meta name="description" content="12 Followers, 2 Following, 0 Posts (@creator)">', { headers: { 'content-type': 'text/html' } });
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  await syncAccount(sb, { id: 'profile-returned', status: 'active', platform: 'Instagram', handle: 'creator', profile_health: { status: 'suspected', missingChecks: 1, firstMissingAt: '2026-10-01T00:00:00Z' } }, cfg({}));
  const health = writes.find(write => write.table === 'linked_social_accounts')?.payload.profile_health as Row;
  assert.equal(health.status, 'healthy');
  assert.equal(health.missingChecks, 0);
});

test('overlapping account sync requests share one read and one snapshot', async () => {
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  let reads = 0;
  globalThis.fetch = (async () => {
    reads++;
    return new Response('<meta name="description" content="12 Followers, 2 Following, 0 Posts (@creator)">', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const account = { id: 'overlap', status: 'active', platform: 'Instagram', handle: 'creator' };
  const states = await Promise.all([syncAccount(sb, account, cfg({})), syncAccount(sb, account, cfg({}))]);
  assert.equal(reads, 1);
  assert.ok(states.every((state) => state.status === 'ok'));
  assert.equal(writes.filter((write) => write.table === 'social_account_snapshots').length, 1);
});

test('post ids match across link formats', () => {
  assert.equal(externalPostId('https://www.instagram.com/reel/ABC123/?igsh=x'), 'ig:ABC123');
  assert.equal(externalPostId('https://instagram.com/p/ABC123/'), 'ig:ABC123');
  assert.equal(externalPostId('https://www.youtube.com/shorts/vid42'), 'yt:vid42');
  assert.equal(externalPostId('https://youtu.be/vid42'), 'yt:vid42');
  assert.equal(externalPostId('https://www.youtube.com/watch?v=vid42'), 'yt:vid42');
  assert.equal(externalPostId('https://x.com/a/status/1'), undefined);
});

test('engagement by followers when reach is missing', () => {
  const base = { url: 'https://x', updatedAt: '', createdAt: '2026-10-01T00:00:00Z', status: 'approved' as const, submittedByWorker: false, source: 'api' as const };
  assert.equal(followerEngagementRate([{ ...base, id: 'a', likes: 90, comments: 10 }, { ...base, id: 'b', likes: 40, comments: 10 }], 1000), 7.5);
  assert.equal(followerEngagementRate([], 1000), undefined);
});

test('sync availability follows platform and configuration', () => {
  const none = { youtubeApiKey: '', metaAccessToken: '', metaIgBusinessId: '' };
  assert.deepEqual(syncAvailability('YouTube Shorts', none), { available: false, status: 'not_configured' });
  assert.deepEqual(syncAvailability('YouTube', { ...none, youtubeApiKey: 'k' }), { available: true, status: 'pending' });
  assert.deepEqual(syncAvailability('Instagram', { ...none, metaAccessToken: 't' }), { available: true, status: 'pending' }, 'profile reads need no credentials');
  assert.deepEqual(syncAvailability('TikTok', { ...none, youtubeApiKey: 'k' }), { available: false, status: 'unsupported' });
});

test('instagram sync updates known reels, adds new ones for review and records a snapshot', async () => {
  process.env.META_GRAPH_ACCESS_TOKEN = 'token';
  process.env.META_IG_BUSINESS_ACCOUNT_ID = '17841';
  const account = { id: 'acc', platform: 'Instagram', handle: 'wanderlite.pune', status: 'active', linked_at: '2026-10-01T00:00:00Z' };
  const { sb, writes } = fakeDb({
    social_account_snapshots: [],
    social_account_posts: [{ id: 'p1', account_id: 'acc', url: 'https://www.instagram.com/reel/OLD1/', likes: 10, comments: 1, caption: 'Mine' }],
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), 'https://www.instagram.com/wanderlite.pune/');
    return new Response(`<script type="application/json">${JSON.stringify({ user: {
      id: '999', username: 'wanderlite.pune', edge_followed_by: { count: 1520 }, edge_follow: { count: 48 },
      edge_owner_to_timeline_media: { count: 21, edges: [
        { node: { shortcode: 'OLD1', is_video: true, like_count: 25, comment_count: 4, taken_at: 1791021600 } },
        { node: { shortcode: 'NEW2', is_video: true, like_count: 7, comment_count: 0, taken_at: 1791367200, caption: { text: 'Night market\nmore text' } } },
        { node: { shortcode: 'ANCIENT', like_count: 1, comment_count: 0, taken_at: 1735689600 } },
      ] },
    } })}</script>`, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const state = await syncAccount(sb, account, cfg({}));
  assert.equal(state.status, 'ok');
  const postUpdate = writes.find((w) => w.table === 'social_account_posts' && w.op === 'update');
  assert.equal(postUpdate?.payload.likes, 25);
  const inserted = writes.filter((w) => w.table === 'social_account_posts' && w.op === 'insert');
  assert.equal(inserted.length, 1, 'posts from before linking are ignored');
  assert.equal(inserted[0].payload.status, 'submitted');
  assert.equal(inserted[0].payload.source, 'profile');
  assert.equal(inserted[0].payload.caption, 'Night market');
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.followers, 1520);
  assert.equal(snapshot.following, 48);
  assert.equal(snapshot.source, 'profile');
  assert.equal(snapshot.engagements, null, 'no interaction delta on the first sync');
  const accountUpdate = writes.find((w) => w.table === 'linked_social_accounts')!.payload;
  assert.equal(accountUpdate.sync_status, 'ok');
  assert.equal(accountUpdate.external_id, '999');
});

test('instagram sync tracks reels from the linking day only and leaves earlier reels untouched', async () => {
  // Linked 29 Oct 2026 at 13:22 India time: reels count from 29 Oct 00:00 IST (28 Oct 18:30 UTC).
  const account = { id: 'win', platform: 'Instagram', handle: 'window.test', status: 'active', linked_at: '2026-10-29T07:52:00Z' };
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  const { sb, writes } = fakeDb({
    social_account_snapshots: [],
    social_account_posts: [
      { id: 'old', account_id: 'win', url: 'https://www.instagram.com/reel/OLDAPPROVED/', posted_at: '2026-10-20T10:00:00Z', status: 'approved', likes: 5 },
      { id: 'undated', account_id: 'win', url: 'https://www.instagram.com/reel/UNDATED/', status: 'submitted', likes: 1 },
    ],
  });
  globalThis.fetch = (async () => new Response(`<script type="application/json">${JSON.stringify({ user: {
    id: '42', username: 'window.test', edge_followed_by: { count: 10 }, edge_follow: { count: 1 },
    edge_owner_to_timeline_media: { count: 4, edges: [
      { node: { shortcode: 'OLDAPPROVED', is_video: true, like_count: 900, comment_count: 9, taken_at: seconds('2026-10-20T10:00:00Z') } },
      { node: { shortcode: 'UNDATED', is_video: true, like_count: 3, comment_count: 0, taken_at: seconds('2026-10-25T10:00:00Z') } },
      { node: { shortcode: 'SAMEDAY', is_video: true, like_count: 2, comment_count: 0, taken_at: seconds('2026-10-28T20:00:00Z') } },
      { node: { shortcode: 'DAYBEFORE', is_video: true, like_count: 2, comment_count: 0, taken_at: seconds('2026-10-28T12:00:00Z') } },
    ] },
  } })}</script>`, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  assert.equal((await syncAccount(sb, account, cfg({}))).status, 'ok');
  const postWrites = writes.filter((w) => w.table === 'social_account_posts');
  assert.equal(postWrites.some((w) => w.filters.some(([, v]) => v === 'old')), false, 'reels from before linking are not refreshed');
  const closed = postWrites.find((w) => w.filters.some(([, v]) => v === 'undated'))!;
  assert.equal(closed.payload.status, 'rejected', 'a waiting reel found to predate linking is closed');
  assert.match(String(closed.payload.review_note), /before this account was linked/);
  assert.equal(closed.payload.likes, undefined, 'its numbers are not tracked');
  const inserted = postWrites.filter((w) => w.op === 'insert').map((w) => w.payload.url);
  assert.deepEqual(inserted, ['https://www.instagram.com/reel/SAMEDAY/'], 'only the reel from the linking day is discovered');
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.engagements, null, 'first sync has no interaction delta');
});

test('period views and totals count tracked reels only, never reels from before linking', async () => {
  const account = { id: 'gain', platform: 'Instagram', handle: 'gain.test', status: 'active', linked_at: '2026-10-29T07:52:00Z' };
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  const { sb, writes } = fakeDb({
    social_account_snapshots: [{ account_id: 'gain', source: 'profile', captured_at: new Date(Date.now() - 86_400_000).toISOString(), total_views: 100 }],
    social_account_posts: [
      { id: 'old', account_id: 'gain', url: 'https://www.instagram.com/reel/OLD/', posted_at: '2026-10-01T00:00:00Z', status: 'approved', views: 1000 },
      { id: 'cur', account_id: 'gain', url: 'https://www.instagram.com/reel/CUR/', posted_at: '2026-10-30T00:00:00Z', status: 'approved', views: 100 },
    ],
  });
  globalThis.fetch = (async () => new Response(`<script type="application/json">${JSON.stringify({ user: {
    id: '7', username: 'gain.test', edge_followed_by: { count: 10 }, edge_follow: { count: 1 },
    edge_owner_to_timeline_media: { count: 2, edges: [
      { node: { shortcode: 'OLD', is_video: true, video_view_count: 5000, taken_at: seconds('2026-10-01T00:00:00Z') } },
      { node: { shortcode: 'CUR', is_video: true, video_view_count: 300, taken_at: seconds('2026-10-30T00:00:00Z') } },
    ] },
  } })}</script>`, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  assert.equal((await syncAccount(sb, account, cfg({}))).status, 'ok');
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.impressions, 200, 'only the tracked reel grew from 100 to 300; the old reel’s 4,000 new views are ignored');
  assert.equal(snapshot.total_views, 300);
});

test('a reel the team removed is never refreshed, re-discovered or counted by sync', async () => {
  const account = { id: 'rm', platform: 'Instagram', handle: 'removed.test', status: 'active', linked_at: '2026-10-29T07:52:00Z' };
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  const { sb, writes } = fakeDb({
    social_account_snapshots: [{ account_id: 'rm', source: 'profile', captured_at: new Date(Date.now() - 86_400_000).toISOString() }],
    social_account_posts: [{ id: 'gone', account_id: 'rm', url: 'https://www.instagram.com/reel/GONE/', posted_at: '2026-10-30T00:00:00Z', status: 'rejected', views: 10, removed_at: '2026-10-31T00:00:00Z' }],
  });
  globalThis.fetch = (async () => new Response(`<script type="application/json">${JSON.stringify({ user: {
    id: '8', username: 'removed.test', edge_followed_by: { count: 10 }, edge_follow: { count: 1 },
    edge_owner_to_timeline_media: { count: 1, edges: [{ node: { shortcode: 'GONE', is_video: true, video_view_count: 9000, like_count: 50, taken_at: seconds('2026-10-30T00:00:00Z') } }] },
  } })}</script>`, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  assert.equal((await syncAccount(sb, account, cfg({}))).status, 'ok');
  assert.equal(writes.filter((w) => w.table === 'social_account_posts').length, 0, 'no update and no new row for the removed reel');
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.impressions, null, 'its 8,990 new views are not counted');
  assert.equal(snapshot.total_views, null);
});

test('youtube period views come from tracked reels, not the channel lifetime total', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  const account = { id: 'acc', platform: 'YouTube', handle: 'TravelLite', status: 'active', linked_at: '2026-10-01T00:00:00Z' };
  const lastSync = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { sb, writes } = fakeDb({
    social_account_snapshots: [{ account_id: 'acc', source: 'api', captured_at: lastSync, total_views: 10_000 }],
    social_account_posts: [],
  });
  respond([
    [/\/channels\?/, { items: [{ id: 'UC1', statistics: { subscriberCount: '800', viewCount: '12500', videoCount: '9' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }],
    [/\/playlistItems\?/, { items: [{ contentDetails: { videoId: 'v1' } }] }],
    [/\/videos\?/, { items: [{ id: 'v1', statistics: { viewCount: '4000', likeCount: '300', commentCount: '12' }, snippet: { title: 'Hostel hacks', publishedAt: '2026-10-05T09:00:00Z' } }] }],
  ]);
  await syncAccount(sb, account, cfg({ youtubeApiKey: 'k' }));
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.impressions, 4000, 'the new tracked reel, not 12,500 − 10,000 channel views that include older videos');
  assert.equal(snapshot.total_views, 4000);
  assert.equal(snapshot.period_days, 3);
  assert.equal(snapshot.followers, 800);
  const inserted = writes.find((w) => w.table === 'social_account_posts' && w.op === 'insert')!.payload;
  assert.equal(inserted.url, 'https://www.youtube.com/shorts/v1');
  assert.equal(inserted.views, 4000);
});

test('a missing account surfaces a helpful error and marks the sync as failed', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  respond([[/\/channels\?/, { items: [] }]]);
  const state = await syncAccount(sb, { id: 'acc', platform: 'YouTube', handle: 'ghost', status: 'active', linked_at: '2026-10-01T00:00:00Z' }, cfg({ youtubeApiKey: 'k' }));
  assert.equal(state.status, 'error');
  assert.match(state.error ?? '', /No YouTube channel found for @ghost/);
  assert.equal(writes.find((w) => w.table === 'linked_social_accounts')?.payload.sync_status, 'error');
});

test('blocked Instagram reads preserve previous snapshots and post metrics', async () => {
  const { sb, writes } = fakeDb({
    social_account_snapshots: [{ account_id: 'acc', source: 'profile', followers: 100 }],
    social_account_posts: [{ id: 'p1', account_id: 'acc', likes: 20 }],
  });
  globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
  const success = '2026-10-20T01:00:00Z';
  const state = await syncAccount(sb, { id: 'acc', platform: 'Instagram', handle: 'creator', status: 'active', last_synced_at: success }, cfg({}));
  assert.equal(state.status, 'error');
  assert.match(state.error ?? '', /limited/);
  assert.equal(writes.filter((w) => w.table !== 'linked_social_accounts').length, 0);
  assert.equal(state.lastSyncedAt, success);
  assert.equal(state.errorCode, 'rate_limited');
  assert.ok(Date.parse(state.nextSyncAt!) > Date.now() + 29 * 60_000);
  assert.equal('last_synced_at' in writes.find(write => write.table === 'linked_social_accounts')!.payload, false);
});

test('the scheduled queue isolates one blocked account and still saves the next account', async () => {
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  let claims = 0;
  (sb as unknown as { rpc: (name: string, args: Row) => Promise<unknown> }).rpc = async () => ({ data: claims++ === 0 ? [
    { id: 'blocked', platform: 'Instagram', handle: 'blocked', status: 'active', sync_lock_token: 'first' },
    { id: 'healthy', platform: 'Instagram', handle: 'healthy', status: 'active', sync_lock_token: 'second' },
  ] : [], error: null });
  globalThis.fetch = async input => String(input).includes('/blocked/') ? new Response(null, { status: 429 })
    : new Response('<meta name="description" content="12 Followers, 2 Following, 0 Posts (@healthy)">', { headers: { 'content-type': 'text/html' } });
  const result = await runScheduledSocialSync(sb, cfg({}));
  assert.equal(result.processed, 2);
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 1);
  const snapshot = writes.find(write => write.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.account_id, 'healthy');
  assert.equal(snapshot.followers, 12);
});

test('a login redirect falls back to the public profile embed and records actual counts', async () => {
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [] });
  const urls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/creator/')) return new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/accounts/login/' } });
    return new Response('<meta name="description" content="817 Followers, 2 Following, 0 Posts (@creator)">', { headers: { 'content-type': 'text/html' } });
  };
  const result = await syncAccount(sb, { id: 'embed-recovery', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({}));
  assert.equal(result.status, 'ok');
  assert.deepEqual(urls, ['https://www.instagram.com/creator/', 'https://www.instagram.com/creator/embed/']);
  assert.equal(writes.find(write => write.table === 'social_account_snapshots')!.payload.followers, 817);
});

test('official Instagram counts and supplementary public views keep separate measurement provenance', async () => {
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [
    { id: 'reel', account_id: 'api-profile', status: 'approved', url: 'https://www.instagram.com/reel/ABC/', views: 3 },
  ] });
  globalThis.fetch = async input => String(input).includes('graph.facebook.com')
    ? new Response(JSON.stringify({ business_discovery: { id: '900', username: 'creator', followers_count: 2000, media_count: 1, media: { data: [{ permalink: 'https://www.instagram.com/reel/ABC/', like_count: 50 }] } } }))
    : new Response(`<script type="application/json">${JSON.stringify({ shortcode: 'ABC', owner: { username: 'creator' }, video_view_count: 2500, like_count: 49, taken_at: 1791021600 })}</script>`, { headers: { 'content-type': 'text/html' } });
  const result = await syncAccount(sb, { id: 'api-profile', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({ metaAccessToken: 'secret', metaIgBusinessId: '17840001' }));
  assert.equal(result.status, 'ok');
  assert.equal(result.provider, 'meta');
  const snapshot = writes.find(write => write.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.followers, 2000);
  assert.equal(snapshot.source, 'api');
  const post = writes.find(write => write.table === 'social_account_posts')!.payload;
  assert.equal(post.views, 2500);
  assert.equal(post.views_source, 'profile');
  assert.equal(post.likes, 50, 'exact API counts take priority over public metadata');
  assert.equal('status' in post, false);
});

test('unexposed metrics never overwrite known post statistics', async () => {
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [{ id: 'p1', account_id: 'acc', url: 'https://www.instagram.com/p/ABC/', likes: 50, comments: 10, views: 1000 }] });
  globalThis.fetch = (async () => new Response(`<script type="application/json">${JSON.stringify({ user: { username: 'creator', follower_count: 100, edge_owner_to_timeline_media: { count: 1, edges: [{ node: { shortcode: 'ABC', like_count: 99, like_and_view_counts_disabled: true } }] } } })}</script>`, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  const state = await syncAccount(sb, { id: 'acc', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({}));
  assert.equal(state.status, 'ok');
  const update = writes.find((w) => w.table === 'social_account_posts')!.payload;
  for (const key of ['likes', 'comments', 'views', 'views_captured_at', 'views_source']) assert.equal(key in update, false);
});

test('tracked reel-page counts refresh saved views and likes without changing approval', async () => {
  const { sb, writes } = fakeDb({
    social_account_snapshots: [],
    social_account_posts: [{ id: 'p1', account_id: 'acc', url: 'https://www.instagram.com/reel/ABC/', views: 100, likes: 10, status: 'approved' }],
  });
  globalThis.fetch = (async (input) => {
    const html = String(input).includes('/reel/')
      ? `<script type="application/json">${JSON.stringify({ shortcode: 'ABC', owner: { username: 'creator' }, play_count: 12000, like_count: 200 })}</script>`
      : '<meta name="description" content="123 Followers, 4 Following, 1 Posts (@creator)">';
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const state = await syncAccount(sb, { id: 'acc', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({}));
  assert.equal(state.status, 'ok');
  const update = writes.find((w) => w.table === 'social_account_posts' && w.op === 'update')!.payload;
  assert.equal(update.views, 12000);
  assert.equal(update.views_source, 'profile');
  assert.equal(Number.isFinite(Date.parse(String(update.views_captured_at))), true);
  assert.equal(update.likes, 200);
  assert.equal('status' in update, false);
  assert.equal(writes.filter((w) => w.table === 'social_account_posts' && w.op === 'insert').length, 0);
});

test('an empty scheduled queue checks the database without contacting any platform', async () => {
  const { sb } = fakeDb({});
  globalThis.fetch = async () => { throw new Error('No platform reads are due'); };
  const result = await runScheduledSocialSync(sb, cfg({}));
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.synced, 0);
});

test('new reels are imported for review despite a full tracked list, and repeated syncs do not duplicate them', async () => {
  const now = Date.now();
  const published = Math.floor(now / 1000) - 30;
  const tables: Record<string, Row[]> = {
    social_account_snapshots: [],
    social_account_posts: Array.from({ length: 6 }, (_, i) => ({ id: `old-${i}`, account_id: 'discovery', url: `https://www.instagram.com/reel/OLD${i}/`, status: i === 0 ? 'rejected' : 'approved', views: 100 })),
  };
  const { sb, writes } = fakeDb(tables);
  const owner = { username: 'creator' };
  const timeline = [
    { shortcode: 'NEW1', is_video: true, owner, taken_at: published },
    { shortcode: 'NEW2', is_video: true, owner, taken_at: published - 1 },
    { shortcode: 'PHOTO', is_video: false, owner, taken_at: published },
    { shortcode: 'UNDATED', is_video: true, owner },
    { shortcode: 'ANCIENT', is_video: true, owner, taken_at: published - 86400 * 3 },
  ];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    const code = new URL(url).pathname.split('/')[2];
    const data = url.endsWith('/creator/') ? { user: { username: 'creator', follower_count: 123, media_count: 12 } } : url.endsWith('/creator/embed/')
      ? { user: { username: 'creator', edge_followed_by: { count: 100 }, edge_owner_to_timeline_media: { count: 12, edges: timeline.map(node=>({node})) } } }
      : { shortcode: code, is_video: true, owner, video_view_count: 50, like_count: 3 };
    return new Response(`<script type="application/json">${JSON.stringify(data)}</script>`, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const account = { id: 'discovery', platform: 'Instagram', handle: 'creator', status: 'active', linked_at: new Date(now - 120_000).toISOString() };
  assert.equal((await syncAccount(sb, account, cfg({}))).status, 'ok');
  const inserted = writes.filter(write => write.table === 'social_account_posts' && write.op === 'insert');
  assert.deepEqual(inserted.map(write=>write.payload.external_id).sort(),['ig:NEW1','ig:NEW2']);
  for(const write of inserted) {
    assert.equal(write.payload.status,'submitted');
    assert.equal(write.payload.submitted_by_worker,false);
    assert.equal(write.payload.views,50);
    assert.equal(write.payload.source,'profile');
    tables.social_account_posts.push({ id: `saved-${String(write.payload.external_id)}`, ...write.payload });
  }
  const snapshot = writes.find(write=>write.table==='social_account_snapshots')!.payload;
  tables.social_account_snapshots.push(snapshot);
  assert.equal(snapshot.followers,123);
  assert.equal((await syncAccount(sb, account, cfg({}))).status,'ok');
  assert.equal(writes.filter(write=>write.table==='social_account_posts' && write.op==='insert').length,2);
  assert.equal(writes.some(write=>write.op==='update' && write.table==='social_account_posts' && 'status' in write.payload),false,'existing approvals and rejections remain intact');
});

test('a submitted reel waiting for counts is checked before older measured reels', async () => {
  const tracked = Array.from({ length: 8 }, (_, i) => ({ id: `old-${i}`, account_id: 'priority', url: `https://www.instagram.com/reel/OLD${i}/`, status: 'approved', views: 100, updated_at: '2026-10-01T00:00:00Z' }));
  const { sb, writes } = fakeDb({ social_account_snapshots: [], social_account_posts: [...tracked,
    { id: 'waiting', account_id: 'priority', url: 'https://www.instagram.com/reel/WAITING/', status: 'submitted', views: null, updated_at: new Date().toISOString() },
  ] });
  const reads: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/reel/')) reads.push(url);
    const page = url.includes('/reel/') ? `<script type="application/json">${JSON.stringify({ shortcode: new URL(url).pathname.split('/')[2], owner: { username: 'creator' }, is_video: true, video_view_count: 25 })}</script>`
      : '<meta name="description" content="123 Followers, 4 Following, 9 Posts (@creator)">';
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  assert.equal((await syncAccount(sb, { id: 'priority', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({}))).status, 'ok');
  assert.equal(reads[0], 'https://www.instagram.com/reel/WAITING/embed/');
  const update = writes.find(write => write.table === 'social_account_posts' && write.filters.some(([key, value]) => key === 'id' && value === 'waiting'));
  assert.equal(update?.payload.views, 25);
  assert.equal('status' in (update?.payload ?? {}), false);
});
