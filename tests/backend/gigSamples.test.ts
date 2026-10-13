import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GIG_SAMPLES, encodeGigSample, formatSampleDuration, isSampleLine, parseGigSamples, sampleIsVertical } from '../../lib/gigSamples';

const url = (n: number) => `https://cdn.example.test/samples/${n}.mp4`;

test('samples round-trip through requirements alongside other lines', () => {
  const line = encodeGigSample({ url: url(1), caption: '  Morning   routine hook ', poster: 'https://cdn.example.test/p1.jpg', duration: 18.44, width: 1080, height: 1920 });
  assert.ok(line && line.startsWith('Sample::'));
  const requirements = ['Brief::Make a reel', 'Meta::application_mode=apply', line, 'Media::https://cdn.example.test/private.png', 'Show the product in 3s'];
  assert.deepEqual(parseGigSamples(requirements), [
    { url: url(1), caption: 'Morning routine hook', poster: 'https://cdn.example.test/p1.jpg', duration: 18.4, width: 1080, height: 1920 },
  ]);
  // Requirement lists must never show the raw sample line.
  assert.deepEqual(requirements.filter((item) => !isSampleLine(item) && !/^(brief|meta|media)::/i.test(item)), ['Show the product in 3s']);
});

test('unsafe or malformed entries are dropped, never rendered', () => {
  const samples = parseGigSamples([
    'Sample::{"url":"javascript:alert(1)"}',
    'Sample::{"url":"data:video/mp4;base64,AAAA"}',
    'Sample::{not json',
    `Sample::{"url":"${url(2)}","poster":"javascript:alert(1)","duration":-5}`,
    `Sample::${url(3)}`, // legacy bare URL
  ]);
  assert.deepEqual(samples, [{ url: url(2) }, { url: url(3) }]);
  assert.equal(encodeGigSample({ url: 'ftp://x/y.mp4' }), null);
});

test('duplicates are removed and the per-gig cap is enforced', () => {
  const lines = Array.from({ length: 10 }, (_, i) => encodeGigSample({ url: url(i % 8) })!);
  const samples = parseGigSamples(lines);
  assert.equal(samples.length, MAX_GIG_SAMPLES);
  assert.equal(new Set(samples.map((s) => s.url)).size, samples.length);
  assert.ok(encodeGigSample({ url: url(1), caption: 'x'.repeat(500) })!.length < 400, 'captions are length-limited');
});

test('layout helpers', () => {
  assert.equal(formatSampleDuration(65.4), '1:05');
  assert.equal(formatSampleDuration(undefined), '');
  assert.equal(sampleIsVertical({ url: url(1), width: 1920, height: 1080 }), false);
  assert.equal(sampleIsVertical({ url: url(1) }), true, 'unknown size defaults to vertical reels');
});
