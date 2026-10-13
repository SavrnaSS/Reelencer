import test from 'node:test';
import assert from 'node:assert/strict';

import { liveSelfieChallenge, isLiveSelfiePath, SELFIE_CHALLENGES } from '../../lib/kycSelfie';
import { createSelfieSession, verifySelfieSession } from '../../lib/api/kycSelfie';

// Tokens are encrypted with this secret, read at call time.
process.env.WORK_EMAIL_CRYPTO_SECRET ||= 'test-secret-that-is-at-least-32-characters-long';

const user = '11111111-1111-4111-8111-111111111111';
const uuid = '9b2f4c1e-3a5d-4e6f-8a7b-1c2d3e4f5a6b';

test('only selfies stored through the live capture path count as live', () => {
  assert.equal(liveSelfieChallenge(`kyc/${user}/selfie-live-two-fingers-${uuid}.jpg`)?.text, 'Hold up two fingers');
  assert.equal(isLiveSelfiePath(`kyc/${user}/selfie-${uuid}.jpg`), false);
  assert.equal(isLiveSelfiePath(`kyc/${user}/selfie-live-not-a-challenge-${uuid}.jpg`), false);
  assert.equal(isLiveSelfiePath(`kyc/${user}/selfie-live-smile-${uuid}.png`), false);
  assert.equal(isLiveSelfiePath(null), false);
});

test('capture sessions bind the user and expire; tampering is rejected', () => {
  const session = createSelfieSession(user);
  assert.ok(SELFIE_CHALLENGES.some((c) => c.id === session.challenge.id));
  assert.equal(verifySelfieSession(session.token, user), session.challenge.id);
  assert.throws(() => verifySelfieSession(session.token, '22222222-2222-4222-8222-222222222222'), /in-page camera/);
  assert.throws(() => verifySelfieSession(session.token.slice(0, -4) + 'AAAA', user), /in-page camera/);
  assert.throws(() => verifySelfieSession(undefined, user), /in-page camera/);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60_000;
    assert.throws(() => verifySelfieSession(session.token, user), /expired/);
  } finally {
    Date.now = realNow;
  }
});
