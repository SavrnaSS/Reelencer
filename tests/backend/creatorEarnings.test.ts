import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAccountEarnings, summarizePayoutBatches } from '../../lib/creatorEarnings';
import { formatAmount } from '../../lib/money';
import { reelEarnings, type LinkedSocialAccount, type SocialPost } from '../../lib/socialAnalytics';

const post = (id: string, status: SocialPost['status'], views?: number): SocialPost => ({
  id, status, views, url: `https://instagram.com/reel/${id}/`, createdAt: '', updatedAt: '', source: 'manual', submittedByWorker: false,
});
const account = (id: string, posts: SocialPost[], overrides: Partial<LinkedSocialAccount> = {}): LinkedSocialAccount => ({
  id, posts, applicationId: id, gigId: id, workerCode: 'WKR-TEST', platform: 'Instagram', handle: id, profileUrl: '',
  status: 'active', linkedAt: '', snapshots: [], payout: '₹49', payoutType: 'Per 1k Views', sync: { available: false, status: 'pending' }, ...overrides,
});

test('shared approved and pending totals match the account card down to paise', () => {
  const linked = account('aimoneygina', [post('approved', 'approved', 1308), post('pending', 'submitted', 33115), post('rejected', 'rejected', 1000000)]);
  const summary = summarizeAccountEarnings([linked]);
  const card = reelEarnings(linked)!;
  assert.equal(summary.approved, 64.09);
  assert.equal(summary.pending, 1622.64);
  assert.equal(formatAmount(summary.approved), card.earned);
  assert.equal(formatAmount(summary.pending), card.pendingValue);
  assert.equal(formatAmount(summary.approved), '₹64.09');
  assert.equal(formatAmount(summary.pending), '₹1,622.64');
  const approved = summarizeAccountEarnings([{ ...linked, posts: linked.posts.map(item => item.status === 'submitted' ? { ...item, status: 'approved' } : item) }]);
  assert.equal(approved.approved, 1686.73);
  assert.equal(approved.pending, 0);
});

test('multiple rates add each displayed account amount once and preserve missing and zero counts', () => {
  const a = account('first', [post('a', 'approved', 1000), post('missing', 'submitted'), post('zero', 'approved', 0)], { payout: '₹0.10' });
  const b = account('second', [post('b', 'approved', 1000)], { payout: '₹0.20', status: 'paused' });
  const c = account('fixed', [post('c', 'approved'), post('d', 'submitted')], { payout: '₹10.25', payoutType: 'Per post' });
  const result = summarizeAccountEarnings([a, b, c, a]);
  assert.equal(result.approved, 10.55);
  assert.equal(result.pending, 10.25);
  assert.equal(result.accountCount, 3);
  assert.equal(result.approvedReels, 4);
  assert.equal(result.pendingReels, 2);
  assert.equal(result.missingCounts, 1);
  assert.equal(result.breakdown.find(item => item.accountId === 'first')?.pending, 0);
});

test('INR totals exclude unlinked accounts, ambiguous rates and foreign currencies', () => {
  const posts = [post('p', 'approved', 1000)];
  const result = summarizeAccountEarnings([
    account('unlinked', posts, { status: 'unlinked' }),
    account('range', posts, { payout: '₹49 – ₹99' }),
    account('foreign', posts, { payout: '$49' }),
    account('monthly', posts, { payoutType: 'Monthly' }),
    account('inr', posts, { payout: 'INR 49' }),
  ]);
  assert.equal(result.approved, 49);
  assert.equal(result.accountCount, 1);
  assert.equal(summarizeAccountEarnings([]).approved, 0);
});

test('payout totals count actual paid and open cycles, excluding failed and rejected withdrawals', () => {
  const batch = (status: string, amountINR: number) => ({ status, items: [{ amountINR }] });
  const totals = summarizePayoutBatches([
    batch('Paid', 64.09), batch(' paid ', 0.01), batch('Draft', 1000.11), batch('Processing', 622.53),
    batch('Failed', 9999), batch('Rejected', 9999), batch('Cancelled', 9999),
  ]);
  assert.deepEqual(totals, { credited: 64.10, pending: 1622.64, liveBatches: 2 });
  assert.equal(formatAmount(totals.credited), '₹64.1');
  assert.equal(formatAmount(0), '₹0');
});
