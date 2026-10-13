import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysSinceSnapshot,
  engagementRate,
  formatChange,
  formatCompact,
  formatPct,
  metricChange,
  metricSeries,
  parseMetricInput,
  bestPostingDay,
  followerPace,
  nextMilestone,
  parsePayoutAmount,
  postEngagementRate,
  postingCadence,
  reelEarnings,
  reelViewSummary,
  type SocialPost,
  type SocialSnapshot,
} from '../../lib/socialAnalytics';

const DAY = 86_400_000;
const now = Date.parse('2026-10-08T12:00:00Z');
const snap = (daysAgo: number, values: Partial<SocialSnapshot>): SocialSnapshot => ({
  id: String(daysAgo),
  capturedAt: new Date(now - daysAgo * DAY).toISOString(),
  periodDays: 7,
  source: 'manual',
  ...values,
});
const reel = { id: 'p', url: 'https://x', updatedAt: '', createdAt: '', status: 'approved' as const, submittedByWorker: false, source: 'manual' as const };
const history = [snap(1, { followers: 1500, reach: 9000, engagements: 540 }), snap(30, { followers: 900 }), snap(8, { followers: 1200, reach: 6000 })];

test('changes compare the latest check-in that has the metric with the one before', () => {
  assert.deepEqual(metricChange(history, 'followers'), { value: 1500, previous: 1200, change: 300, pct: 25, capturedAt: history[0].capturedAt });
  const reach = metricChange(history, 'reach');
  assert.equal(reach.change, 3000);
  assert.equal(metricChange(history, 'linkClicks').value, undefined);
  assert.equal(metricChange([snap(1, { followers: 0 }), snap(2, { followers: 0 })], 'followers').pct, undefined, 'no divide by zero');
});

test('series are ordered, ranged and skip missing values', () => {
  assert.deepEqual(metricSeries(history, 'followers', 0, now).map((p) => p.v), [900, 1200, 1500]);
  assert.deepEqual(metricSeries(history, 'followers', 7, now).map((p) => p.v), [1500]);
  assert.deepEqual(metricSeries(history, 'reach', 30, now).map((p) => p.v), [6000, 9000]);
  assert.equal(daysSinceSnapshot(history, now), 1);
  assert.equal(daysSinceSnapshot([], now), undefined);
});

test('engagement rates', () => {
  assert.equal(engagementRate({ reach: 9000, engagements: 540 }), 6);
  assert.equal(engagementRate({ reach: 0, engagements: 5 }), undefined);
  assert.equal(postEngagementRate({ ...reel, views: 1000, likes: 40, comments: 5, shares: 3, saves: 2 }), 5);
  assert.equal(postEngagementRate({ ...reel, reach: 500, views: 1000, likes: 50 }), 10, 'reach is preferred over views');
});

test('number formatting and admin input parsing', () => {
  assert.equal(formatCompact(9_999), '9,999');
  assert.equal(formatCompact(12_400), '12.4K');
  assert.equal(formatCompact(1_250_000), '1.3M');
  assert.equal(formatCompact(undefined), '–');
  assert.equal(formatPct(6), '6%');
  assert.equal(formatPct(5.25), '5.3%');
  assert.equal(formatChange(-340), '−340');
  assert.equal(formatChange(1200), '+1,200');
  assert.equal(parseMetricInput('12,400'), 12_400);
  assert.equal(parseMetricInput('12.4k'), 12_400);
  assert.equal(parseMetricInput('1.2M'), 1_200_000);
  assert.equal(parseMetricInput(''), undefined);
  assert.equal(parseMetricInput('-5'), undefined);
  assert.equal(parseMetricInput('abc'), undefined);
});

const post = (daysAgo: number, views: number, status: SocialPost['status'] = 'approved'): SocialPost => ({
  ...reel,
  id: `${daysAgo}-${views}`,
  postedAt: new Date(now - daysAgo * DAY).toISOString(),
  views,
  status,
});

test('posting cadence ignores rejected reels', () => {
  const posts = [post(1, 100), post(3, 100), post(10, 100), post(20, 100), post(2, 100, 'rejected')];
  assert.deepEqual(postingCadence(posts, now), { last7: 2, last30: 4, perWeek: 1 });
});

test('follower pace is a fitted weekly slope and drives the milestone projection', () => {
  const steady = [0, 7, 14, 21].map((d, i) => snap(d, { followers: 1000 - i * 70 }));
  assert.equal(Math.round(followerPace(steady, now)!), 70);
  assert.equal(followerPace([snap(1, { followers: 10 })], now), undefined, 'needs two check-ins');
  const m = nextMilestone(2_300, 50, now)!;
  assert.equal(m.target, 2_500);
  assert.equal(m.eta, new Date(now + 4 * 7 * DAY).toISOString());
  assert.equal(nextMilestone(2_300, 0, now)!.eta, undefined, 'no date when not growing');
  assert.equal(nextMilestone(2_300, 1, now)!.eta, undefined, 'no date beyond a year');
});

test('milestone progress, remaining count and target use the same exact follower reading', () => {
  const milestone = nextMilestone(3735, undefined, now)!;
  assert.equal(milestone.target, 5000);
  assert.equal(milestone.remaining, 1265);
  assert.equal(milestone.percent, 75);
  assert.equal(milestone.progress, 3735 / 5000);
  assert.equal(milestone.eta, undefined);
  const grown = nextMilestone(4000, undefined, now)!;
  assert.equal(grown.remaining, 1000);
  assert.equal(grown.percent, 80);
  const lost = nextMilestone(3700, undefined, now)!;
  assert.equal(lost.remaining, 1300);
  assert.equal(lost.percent, 74);
});

test('milestones advance at the boundary and never round an unfinished goal to 100%', () => {
  const almost = nextMilestone(4999, 100, now)!;
  assert.equal(almost.target, 5000);
  assert.equal(almost.remaining, 1);
  assert.equal(almost.percent, 99);
  assert.equal(almost.progress, 4999 / 5000);
  const reached = nextMilestone(5000, 100, now)!;
  assert.equal(reached.target, 10000);
  assert.equal(reached.remaining, 5000);
  assert.equal(reached.percent, 50);
  assert.equal(nextMilestone(0, undefined, now)?.progress, 0, 'zero has no fabricated progress');
});

test('milestone ladder continues for accounts above one million followers', () => {
  for (const [followers, target] of [[1000000, 2500000], [2500000, 5000000], [5000000, 10000000], [10000000, 25000000], [2000000000, 2500000000]]) {
    const milestone = nextMilestone(followers, undefined, now)!;
    assert.equal(milestone.target, target);
    assert.equal(milestone.remaining, target - followers);
  }
});

test('missing or invalid counts cannot create a milestone or replace a valid follower reading', () => {
  for (const followers of [undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(nextMilestone(followers, 100, now), undefined);
  const invalid = [snap(0, { followers: NaN }), snap(0, { followers: -1 }), snap(0, { followers: 1.5 }), snap(0, { followers: 9999, capturedAt: 'invalid' })];
  const readings = [snap(2, { followers: 3700 }), ...invalid, snap(1, { followers: 3735 }), snap(0, { reach: 20 })];
  const copy = [...readings];
  const current = metricChange(readings, 'followers');
  assert.equal(current.value, 3735);
  assert.equal(current.change, 35);
  assert.equal(current.capturedAt, snap(1, {}).capturedAt, 'fresh reach-only snapshots do not make followers look fresh');
  assert.deepEqual(readings, copy, 'sorting does not mutate history');
});

test('invalid and future readings cannot distort growth projections', () => {
  const steady = [snap(0, { followers: 1000 }), snap(7, { followers: 930 }), snap(14, { followers: 860 })];
  assert.equal(Math.round(followerPace([...steady, snap(0, { followers: NaN }), snap(0, { followers: -1 }), snap(-7, { followers: 90000 }), snap(0, { followers: 99999, capturedAt: 'invalid' })], now)!), 70);
  for (const pace of [NaN, Infinity, -Infinity, -1, 0]) assert.equal(nextMilestone(3735, pace, now)?.eta, undefined);
  assert.equal(nextMilestone(3735, 100, NaN)?.eta, undefined);
});

test('best posting day needs enough reels and a clear lead', () => {
  const thursday = (weeksAgo: number, views: number) => ({ ...post(0, views), postedAt: new Date(Date.UTC(2026, 9, 1) - weeksAgo * 7 * DAY + 12 * 3600_000).toISOString() });
  const monday = (weeksAgo: number, views: number) => ({ ...post(0, views), postedAt: new Date(Date.UTC(2026, 8, 28) - weeksAgo * 7 * DAY + 12 * 3600_000).toISOString() });
  const best = bestPostingDay([thursday(0, 9000), thursday(1, 8000), monday(0, 2000), monday(1, 1000)]);
  assert.equal(best?.day, 'Thursday');
  assert.ok((best?.lift ?? 0) > 1.5);
  assert.equal(bestPostingDay([thursday(0, 5000), monday(0, 5000), thursday(1, 5000), monday(1, 5000)]), undefined, 'no clear lead');
  assert.equal(bestPostingDay([thursday(0, 9000), monday(0, 1000)]), undefined, 'too few reels');
});

test('reel earnings only for per-post gigs with a parseable rate', () => {
  assert.deepEqual(parsePayoutAmount('₹2,800'), { amount: 2800, symbol: '₹' });
  assert.equal(parsePayoutAmount('₹2,000 - ₹3,000'), undefined);
  const posts = [post(1, 1, 'approved'), post(2, 1, 'approved'), post(3, 1, 'submitted'), post(4, 1, 'rejected')];
  assert.deepEqual(reelEarnings({ posts, payout: '₹2,800', payoutType: 'Per post' }), { approved: 2, pending: 1, rateAmount: 2800, symbol: '₹', approvedAmount: 5600, pendingAmount: 2800, rate: '₹2,800', earned: '₹5,600', pendingValue: '₹2,800' });
  assert.equal(reelEarnings({ posts, payout: '₹2,800', payoutType: 'Monthly' }), undefined);
});

test('view payouts prorate approved views and separate pending and missing counts', () => {
  const posts: SocialPost[] = [
    { ...reel, id: 'a', views: 1500 },
    { ...reel, id: 'b', views: 250 },
    { ...reel, id: 'missing' },
    { ...reel, id: 'zero', views: 0 },
    { ...reel, id: 'pending', status: 'submitted', views: 1250 },
    { ...reel, id: 'rejected', status: 'rejected', views: 999999 },
  ];
  const earnings = reelEarnings({ posts, payout: '₹100', payoutType: 'Per 1k Views' });
  assert.equal(earnings?.earned, '₹175');
  assert.equal(earnings?.pendingValue, '₹125');
  assert.equal(earnings?.approvedViews, 1750);
  assert.equal(earnings?.unmeasuredApproved, 1);
  assert.equal(earnings?.basis, 'views');
  const updated = reelEarnings({ posts: posts.map((p) => p.id === 'a' ? { ...p, views: 2500 } : p), payout: '₹100', payoutType: 'Per 1k Views' });
  assert.equal(updated?.earned, '₹275');
});

test('view payouts round combined earnings to cents and reject ambiguous rates', () => {
  const account = { posts: [{ ...reel, views: 100 }], payout: '₹0.05', payoutType: 'Per 1k Views' };
  assert.equal(reelEarnings(account)?.earned, '₹0.01');
  for (const payout of ['₹0', '₹-100', '₹100 - ₹200', 'Negotiable', '₹0.001', '₹1,,000']) {
    assert.equal(reelEarnings({ ...account, payout }), undefined, payout);
  }
});

test('reel view totals distinguish missing, zero and partial coverage, excluding rejected reels', () => {
  assert.equal(reelViewSummary([{ ...reel }]).total, undefined);
  const captured = '2026-10-08T06:00:00Z';
  const summary = reelViewSummary([{ ...reel, views: 0, viewsCapturedAt: captured }, { ...reel, id: 'second', views: 993, viewsCapturedAt: captured }, { ...reel, id: 'missing', status: 'submitted' }, { ...reel, id: 'excluded', views: 100000, status: 'rejected' }]);
  assert.deepEqual(summary, { total: 993, measured: 2, missing: 1, average: 496.5, oldestCapturedAt: captured });
  assert.equal(reelViewSummary([{ ...reel, views: 0 }]).total, 0);
  assert.equal(reelViewSummary([{ ...reel, views: 10, viewsCapturedAt: captured }, { ...reel, views: 20 }]).oldestCapturedAt, undefined);
});
