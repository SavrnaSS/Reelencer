import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { accountSyncDue, syncAccount, syncAvailability } from '../../lib/api/socialSync';
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
      order: () => q,
      limit: () => q,
      update: (p: Row) => ((op = 'update'), (payload = p), q),
      insert: (p: Row) => (writes.push({ table, op: 'insert', payload: p, filters: [] }), Promise.resolve({ error: null })),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (op === 'update') writes.push({ table, op, payload, filters });
        return Promise.resolve(op === 'update' ? { error: null } : { data: rows(), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { sb: { from } as never, writes };
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

test('youtube sync derives period views from the previous lifetime total', async () => {
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
  assert.equal(snapshot.impressions, 2500);
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
  const state = await syncAccount(sb, { id: 'acc', platform: 'Instagram', handle: 'creator', status: 'active' }, cfg({}));
  assert.equal(state.status, 'error');
  assert.match(state.error ?? '', /limited/);
  assert.equal(writes.filter((w) => w.table !== 'linked_social_accounts').length, 0);
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

 test('legacy scheduled sync does not access the network or database without a section visit', async () => {
  const { syncAllAccounts } = await import('../../lib/api/socialAccounts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Background sync must not make requests'); };
  try {
    assert.deepEqual(await syncAllAccounts(), { synced: 0, failed: 0, due: 0, skipped: true, reason: 'visit_driven_sync' });
  } finally { globalThis.fetch = originalFetch; }
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
