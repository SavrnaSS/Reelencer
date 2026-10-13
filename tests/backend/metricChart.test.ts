import test from 'node:test';
import assert from 'node:assert/strict';
import { timeTicks } from '../../app/dashboard/MetricChart';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const t0 = new Date(2026, 9, 8, 9, 30).getTime();

test('x ticks are unique, ordered, inside the range and never closer than the label width', () => {
  for (const [span, width] of [[3.2 * DAY, 1700], [3.2 * DAY, 300], [20 * HOUR, 700], [80 * DAY, 900], [400 * DAY, 900]]) {
    const ticks = timeTicks(t0, t0 + span, width);
    assert.ok(ticks.length >= 1, `ticks for ${span / DAY}d`);
    assert.equal(new Set(ticks.map((t) => t.label)).size, ticks.length, 'labels repeat');
    const pxPerMs = width / span;
    for (let i = 0; i < ticks.length; i++) {
      assert.ok(ticks[i].t >= t0 && ticks[i].t <= t0 + span);
      if (i) assert.ok((ticks[i].t - ticks[i - 1].t) * pxPerMs >= 72 * 0.95, 'labels too close');
    }
  }
});

test('a few days of readings are labelled once per day at local midnight', () => {
  const ticks = timeTicks(t0, t0 + 3.2 * DAY, 1700);
  assert.deepEqual(ticks.map((t) => new Date(t.t).getHours()), ticks.map(() => 0));
  assert.equal(ticks.length, 3);
});
