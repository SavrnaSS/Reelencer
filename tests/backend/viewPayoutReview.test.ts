import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustedViewAmount, viewReviewEvidence, type ViewClaimItem, type ViewObservation } from '../../lib/viewPayoutReview';
const now = Date.parse('2026-10-08T08:00:00Z');
const item: ViewClaimItem = { id: 'item', post_id: 'post', url: 'https://www.instagram.com/reel/ABC/', from_views: 0, to_views: 1500, amount_inr: 73.5, source: 'profile', captured_at: new Date(now).toISOString() };
const point = (i: number, views: number, likes: number | null = 20, comments: number | null = 10): ViewObservation => ({ captured_at: new Date(now - (5 - i) * 3_600_000).toISOString(), views, likes, comments, source: 'profile' });
test('deduction previews match frozen cumulative rounding and reject invalid counts', () => {
  assert.equal(adjustedViewAmount(item,49,500),49);
  assert.equal(adjustedViewAmount(item,49,1500),0);
  assert.equal(adjustedViewAmount({...item,from_views: 1012,to_views:1066},49,10),2.15);
  assert.equal(adjustedViewAmount({...item,from_views:1,to_views:2},49,0),0.05);
  for(const invalid of [-1,0.5,1501,NaN,Infinity]) assert.throws(()=>adjustedViewAmount(item,49,invalid));
});
test('growth and engagement signals are descriptive and missing data is never labelled organic', () => {
  const history=[100,200,300,400,500,10500].map((views,i)=>point(i,views,0,0));
  const review=viewReviewEvidence(item,{views:10500,status:'approved'},history,now);
  assert.ok(review.flags.some(flag=>flag.includes('median pace')));
  assert.ok(review.flags.some(flag=>flag.includes('organic traffic')));
  assert.equal(review.interactionRate,0);
  assert.equal('organic' in review,false);
  const empty=viewReviewEvidence(item,undefined,[],now);
  assert.equal(empty.interactionRate,undefined);
  assert.ok(empty.flags.some(flag=>flag.includes('Limited measurement history')));
  assert.ok(empty.flags.some(flag=>flag.includes('Current view count is unavailable')));
  assert.equal(viewReviewEvidence(item,{views:2000,status:'approved'},[point(0,2000,null,3)],now).interactionRate,undefined);
});
test('review flags account for stale evidence, lower counters, out-of-order history and corrections', () => {
  const review=viewReviewEvidence({...item,captured_at:new Date(now-25*3_600_000).toISOString()},{views:1000,status:'approved'},[point(2,1000),point(0,2000),point(1,1500)],now);
  assert.ok(review.flags.some(flag=>flag.includes('Approval is blocked')));
  assert.ok(review.flags.some(flag=>flag.includes('older than 24 hours')));
  assert.ok(review.flags.some(flag=>flag.includes('platform corrections')));
  assert.equal(review.observations[0].views,2000);
});
