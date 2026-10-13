import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVerifyCode, requestStep, riskFrom, type RequestCheck } from '../../lib/accountRequests';
import { extractInstagramProfile } from '../../lib/api/instagramProfile';

const check = (id: RequestCheck['id'], status: RequestCheck['status']): RequestCheck => ({ id, label: id, status, detail: '' });

test('verification codes use the stored format and unambiguous characters', () => {
  const code = makeVerifyCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
  assert.match(code, /^RL-[A-Z0-9]{6}$/);
  assert.doesNotMatch(code.slice(3), /[01IO]/);
});

test('risk: failures are high, proven ownership without flags is low', () => {
  assert.equal(riskFrom([]), 'unknown');
  assert.equal(riskFrom([check('ownership', 'pass'), check('duplicate', 'pass')]), 'low');
  assert.equal(riskFrom([check('ownership', 'pass'), check('email', 'warn')]), 'medium');
  assert.equal(riskFrom([check('ownership', 'pending'), check('profile', 'pass')]), 'medium');
  assert.equal(riskFrom([check('ownership', 'pending'), check('email', 'warn'), check('profile', 'warn')]), 'high');
  assert.equal(riskFrom([check('ownership', 'pass'), check('duplicate', 'fail')]), 'high');
});

test('progress step follows ownership and the decision', () => {
  assert.equal(requestStep({ status: 'pending', checks: [check('ownership', 'pending')] }), 1);
  assert.equal(requestStep({ status: 'pending', checks: [check('ownership', 'pass')] }), 2);
  assert.equal(requestStep({ status: 'approved', checks: [] }), 3);
});

test('public profile reader exposes the bio and privacy flag', () => {
  const data = { username: 'glowco.pune', id: '1', biography: 'Skincare tips RL-ABC234', is_private: false, edge_followed_by: { count: 1200 }, edge_follow: { count: 10 }, edge_owner_to_timeline_media: { count: 4, edges: [] } };
  const html = `<script type="application/json">${JSON.stringify({ user: data })}</script>`;
  const profile = extractInstagramProfile(html, 'glowco.pune');
  assert.equal(profile.biography, 'Skincare tips RL-ABC234');
  assert.equal(profile.isPrivate, false);
  assert.equal(profile.followers, 1200);
});
