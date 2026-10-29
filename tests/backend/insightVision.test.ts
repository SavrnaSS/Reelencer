import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, matchReels, normalizeReading, readScreenshots, sniffImage, suspiciousJump } from '../../lib/api/insightVision';

type Row = Record<string, unknown>;
const env = { ...process.env };
const realFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...env };
  globalThis.fetch = realFetch;
});

/** Query-builder stand-in covering what applyReading uses. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; payload: Row }[] = [];
  const from = (table: string) => {
    let op = 'select';
    let payload: Row = {};
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      not: () => q,
      order: () => q,
      limit: () => q,
      insert: (p: Row) => ((op = 'insert'), (payload = p), writes.push({ table, op, payload: p }), q),
      update: (p: Row) => ((op = 'update'), (payload = p), q),
      single: () => Promise.resolve({ data: { id: 'snap1', ...payload }, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (op === 'update') writes.push({ table, op, payload });
        return Promise.resolve(op === 'select' ? { data: rows(), error: null } : { error: null }).then(resolve);
      },
    };
    return q;
  };
  return { sb: { from } as never, writes };
}

test('model output is validated: numbers clamped, junk dropped, handle normalized', () => {
  const r = normalizeReading({
    screens: ['profile', 'account_insights', 'hacked'],
    handle: '@AimoneyGina',
    account: { followers: 2558, accounts_reached: '12,400', views_or_impressions: -5, period_days: 400, profile_visits: 'lots' },
    reels: [{ posted_on: '2026-10-05', views: 48200, likes: 2900 }, { posted_on: 'yesterday' }, { caption_hint: 'x' }],
    confidence: 1.7,
    warnings: ['Top cropped', 42],
  });
  assert.deepEqual(r.screens, ['profile', 'account_insights']);
  assert.equal(r.handle, 'aimoneygina');
  assert.equal(r.account.followers, 2558);
  assert.equal(r.account.reach, 12400);
  assert.equal(r.account.impressions, undefined);
  assert.equal(r.account.periodDays, undefined);
  assert.equal(r.account.profileViews, undefined);
  assert.equal(r.reels.length, 1, 'reels without numbers are dropped');
  assert.equal(r.reels[0].postedOn, '2026-10-05');
  assert.equal(r.confidence, 0, 'out-of-range confidence is distrusted');
  assert.deepEqual(r.warnings, ['Top cropped']);
});

test('images are recognised by their bytes, not their names', () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
});

test('reels are matched by date first, then caption words', () => {
  const posts = [
    { id: 'a', postedAt: '2026-10-05T10:00:00Z', caption: 'Unboxing the service kit', status: 'approved' as const },
    { id: 'b', postedAt: '2026-10-02T10:00:00Z', caption: 'First impressions', status: 'approved' as const },
    { id: 'c', postedAt: '2026-10-05T18:00:00Z', caption: 'Night market eats', status: 'rejected' as const },
  ];
  const pairs = matchReels([{ postedOn: '2026-10-05', views: 1 }, { captionHint: 'first impressions of it', views: 2 }, { postedOn: '2026-09-01', views: 3 }], posts);
  assert.deepEqual(pairs.map((p) => p.postId), ['a', 'b', undefined]);
});

test('large jumps are flagged', () => {
  assert.equal(suspiciousJump(2500, 2700), false);
  assert.equal(suspiciousJump(2500, 260_000), true);
  assert.equal(suspiciousJump(undefined, 260_000), false);
});

test('screenshots go to the vision model with a forced tool and come back validated', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  let sent: Row = {};
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_insights', input: { screens: ['profile'], handle: 'aimoneygina', account: { followers: 2558 }, confidence: 0.94 } }] }), { status: 200 });
  }) as typeof fetch;
  const reading = await readScreenshots([{ bytes: new Uint8Array([1, 2, 3]), type: 'image/png' }], { platform: 'Instagram', handle: 'aimoneygina', today: '2026-10-08' });
  assert.equal(reading.account.followers, 2558);
  assert.deepEqual(sent.tool_choice, { type: 'tool', name: 'record_insights' });
  const content = (sent.messages as { content: Row[] }[])[0].content;
  assert.equal(content[0].type, 'image');
  assert.match(String(content[1].text), /@aimoneygina.*2026-10-08/);
});

test('saving: rejects other accounts and unclear readings, stores a screenshot check-in and updates matched reels', async () => {
  const account = { id: 'acc', handle: 'aimoneygina' };
  const base = { screens: ['profile' as const], reels: [], warnings: [] };
  const { sb, writes } = fakeDb({
    social_account_snapshots: [{ account_id: 'acc', followers: 2400 }],
    social_account_posts: [{ id: 'p1', account_id: 'acc', posted_at: '2026-10-05T10:00:00Z', caption: 'Unboxing', status: 'approved' }],
  });
  const opts = { actorId: 'u1', byCreator: true, imageCount: 2 };
  await assert.rejects(applyReading(sb, account, { ...base, handle: 'someoneelse', account: { followers: 10 }, confidence: 0.9 }, opts), /from @someoneelse, not @aimoneygina/);
  await assert.rejects(applyReading(sb, account, { ...base, handle: 'aimoneygina', account: { followers: 10 }, confidence: 0.3 }, opts), /weren't clear enough/);
  await assert.rejects(applyReading(sb, account, { ...base, handle: 'aimoneygina', account: { followers: 900_000 }, confidence: 0.9 }, opts), /far from the last check-in/);

  const result = await applyReading(
    sb,
    account,
    { ...base, handle: 'aimoneygina', account: { followers: 2558, reach: 12400, periodDays: 30 }, reels: [{ postedOn: '2026-10-05', views: 48200, shares: 410 }], confidence: 0.92 },
    opts,
  );
  const snapshot = writes.find((w) => w.table === 'social_account_snapshots')!.payload;
  assert.equal(snapshot.source, 'screenshot');
  assert.equal(snapshot.followers, 2558);
  assert.equal(snapshot.period_days, 30);
  assert.match(String(snapshot.note), /2 screenshots · confidence 92% · uploaded by creator/);
  assert.deepEqual(result.updatedPostIds, ['p1']);
  const reelUpdate = writes.find((w) => w.table === 'social_account_posts' && w.op === 'update')!.payload;
  assert.equal(reelUpdate.views, 48200);
  assert.equal(reelUpdate.shares, 410);
});

test('screenshot readings never update reels from before the account was linked', async () => {
  const account = { id: 'acc', handle: 'aimoneygina', linked_at: '2026-10-29T07:52:00Z' };
  const { sb, writes } = fakeDb({
    social_account_snapshots: [],
    social_account_posts: [
      { id: 'old', account_id: 'acc', posted_at: '2026-10-05T10:00:00Z', caption: 'Old reel', status: 'approved' },
      { id: 'new', account_id: 'acc', posted_at: '2026-10-30T10:00:00Z', caption: 'New reel', status: 'approved' },
    ],
  });
  const reading = { screens: ['reel_insights' as const], handle: 'aimoneygina', account: {}, warnings: [], confidence: 0.95 };
  const opts = { actorId: 'u1', byCreator: true, imageCount: 1 };
  await assert.rejects(applyReading(sb, account, { ...reading, reels: [{ postedOn: '2026-10-05', views: 90_000 }] }, opts), /couldn't be matched/);
  const result = await applyReading(sb, account, { ...reading, reels: [{ postedOn: '2026-10-30', views: 1_200 }] }, opts);
  assert.deepEqual(result.updatedPostIds, ['new']);
  await assert.rejects(applyReading(sb, account, { ...reading, reels: [{ views: 5 }] }, { ...opts, postId: 'old' }), /couldn't be matched/, 'a direct update of a pre-link reel is refused too');
  assert.equal(writes.filter((w) => w.table === 'social_account_posts').length, 1);
});
