import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listCreatorAccounts } from '../../lib/api/socialAccounts';
import { metricChange, nextMilestone } from '../../lib/socialAnalytics';

const env = { ...process.env };
const realFetch = globalThis.fetch;
afterEach(() => { process.env = { ...env }; globalThis.fetch = realFetch; });

test('frequent sync history keeps the newest followers under a database row cap while charts remain chronological', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://live-backend.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const now = Date.now();
  const history = Array.from({ length: 5001 }, (_, i) => ({
    id: `snapshot-${i}`, account_id: id, followers: 1000 + i, source: 'profile', period_days: 1,
    captured_at: new Date(now - (5000 - i) * 300_000).toISOString(),
    created_at: new Date(now - (5000 - i) * 300_000).toISOString(),
  }));
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://live-backend.example.test', 'never contact a real service');
    const table = url.pathname.replace('/rest/v1/', '');
    let rows: unknown[] = [];
    if (table === 'linked_social_accounts') {
      assert.equal(url.searchParams.get('worker_code'), 'in.(WKR-LIVE)');
      rows = [{ id, application_id: id, gig_id: 'live', worker_code: 'WKR-LIVE', platform: 'Instagram', handle: 'creator', status: 'active', linked_at: new Date(now).toISOString() }];
    } else if (table === 'social_account_snapshots') {
      assert.equal(url.searchParams.get('account_id'), `in.(${id})`);
      assert.equal(url.searchParams.get('order'), 'captured_at.desc,created_at.desc');
      // Hosted PostgREST may cap rows below the requested limit.
      rows = [...history].reverse().slice(0, Math.min(1000, Number(url.searchParams.get('limit'))));
    } else if (table === 'gigs') {
      rows = [{ id: 'live', title: 'Live gig', company: 'Test', payout: '₹49', payout_type: 'Per 1k Views' }];
    } else {
      assert.ok(['integration_settings', 'gig_applications', 'social_account_posts'].includes(table), `unexpected table ${table}`);
    }
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  };
  const result = await listCreatorAccounts(['WKR-LIVE']);
  assert.equal(result.accounts.length, 1);
  const snapshots = result.accounts[0].snapshots;
  assert.equal(snapshots.length, 1000);
  assert.equal(snapshots[0].id, 'snapshot-4001');
  assert.equal(snapshots.at(-1)?.id, 'snapshot-5000');
  assert.ok(snapshots.every((snapshot, i) => !i || Date.parse(snapshot.capturedAt) >= Date.parse(snapshots[i - 1].capturedAt)));
  const latest = metricChange(snapshots, 'followers');
  assert.equal(latest.value, 6000);
  const milestone = nextMilestone(latest.value, undefined, now)!;
  assert.equal(milestone.target, 10000);
  assert.equal(milestone.percent, 60);
  assert.equal(milestone.remaining, 4000);
});
