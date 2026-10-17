import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountPlatformFor,
  encodeAccountInstructions,
  instructionLines,
  normalizeHandle,
  ownershipProven,
  parseAccountInstructions,
  payoutPhrase,
  publicAccountSetup,
  readStoredAccountSetup,
  redactProposal,
  validateAccountOwnership,
  validateAccountSetup,
} from '../../lib/accountSetup';

const ig = accountPlatformFor('Instagram');
const valid = { handle: 'glowco.pune', profileUrl: 'https://www.instagram.com/glowco.pune/', email: 'Me+glow@example.com', password: 'S3cure-pass', phone: '', notes: '' };

test('gig platforms map to account rules', () => {
  assert.equal(accountPlatformFor('Instagram').id, 'instagram');
  assert.equal(accountPlatformFor('YouTube Shorts').id, 'youtube');
  assert.equal(accountPlatformFor('TikTok').id, 'tiktok');
  assert.equal(accountPlatformFor('X').id, 'x');
  assert.equal(accountPlatformFor('LinkedIn').id, 'linkedin');
  const other = accountPlatformFor('Snapchat');
  assert.equal(other.id, 'other');
  assert.equal(other.label, 'Snapchat');
});

test('handles are tidied from @names and pasted profile links', () => {
  assert.equal(normalizeHandle('@GlowCo.Pune', ig), 'glowco.pune');
  assert.equal(normalizeHandle('https://www.instagram.com/glowco.pune/?igsh=abc', ig), 'glowco.pune');
  assert.equal(normalizeHandle('instagram.com/glowco.pune', ig), 'glowco.pune');
  assert.equal(normalizeHandle('https://www.youtube.com/@TravelLite', accountPlatformFor('YouTube')), 'TravelLite');
  assert.equal(normalizeHandle('https://www.linkedin.com/in/asha-verma/', accountPlatformFor('LinkedIn')), 'asha-verma');
});

test('validation catches each field and accepts a complete submission', () => {
  assert.deepEqual(validateAccountSetup(valid, ig), {});
  const errors = validateAccountSetup({ handle: 'bad handle!', profileUrl: 'https://www.youtube.com/@x', email: 'nope', password: '123', phone: 'abc' }, ig);
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'handle', 'password', 'phone', 'profileUrl']);
  assert.ok(validateAccountSetup({ ...valid, password: '' }, ig).password, 'password required the first time');
  assert.equal(validateAccountSetup({ ...valid, password: '' }, ig, { passwordOptional: true }).password, undefined, 'blank keeps the saved password on resubmit');
  assert.ok(validateAccountSetup({ ...valid, profileUrl: 'javascript:alert(1)' }, ig).profileUrl);
});

test('admin instructions round-trip through a requirement line', () => {
  const line = encodeAccountInstructions('1. Username: brand.city\r\n- Bio from the brief\n\n');
  assert.ok(line?.startsWith('Meta::account_setup='));
  const requirements = ['Brief::Post daily', line!, 'Vertical 9:16'];
  assert.equal(parseAccountInstructions(requirements), '1. Username: brand.city\n- Bio from the brief');
  assert.deepEqual(instructionLines(parseAccountInstructions(requirements)), ['Username: brand.city', 'Bio from the brief']);
  assert.equal(encodeAccountInstructions('   '), null);
  assert.equal(parseAccountInstructions(['Meta::account_setup=%E0%A4%A']), '', 'malformed encoding is ignored');
});

test('the encrypted password never leaves the server', () => {
  const stored = { platform: 'Instagram', handle: 'glowco.pune', profileUrl: valid.profileUrl, email: 'me@example.com', passwordEnc: 'enc:v1:secret', status: 'Submitted', revision: 2, submittedAt: '2026-10-08T00:00:00.000Z' };
  const view = publicAccountSetup(stored)!;
  assert.equal('passwordEnc' in view, false);
  assert.equal(view.hasPassword, true);
  const proposal: { pitch: string; accountSetup?: unknown } = { pitch: 'hi', accountSetup: stored };
  const redacted = redactProposal(proposal);
  assert.equal(JSON.stringify(redacted).includes('enc:v1'), false);
  assert.equal(redacted.pitch, 'hi');
  const plain: { pitch: string; accountSetup?: unknown } = { pitch: 'x' };
  assert.deepEqual(redactProposal(plain), { pitch: 'x' });
  assert.equal(readStoredAccountSetup({ handle: 'x', email: 'y', status: 'Hacked' }), undefined, 'unknown statuses are rejected');
});

test('payout wording follows the gig payout type', () => {
  assert.equal(payoutPhrase('₹2,800', 'Per post'), '₹2,800 per approved post');
  assert.equal(payoutPhrase('₹100', 'Per 1k Views'), '₹100 per 1,000 views on approved reels');
  assert.equal(payoutPhrase('₹900', 'Per task'), '₹900 per approved task');
  assert.equal(payoutPhrase('₹40,000', 'Monthly'), '₹40,000 a month');
  assert.equal(payoutPhrase('₹5,000', 'Project'), '₹5,000');
  assert.equal(payoutPhrase('', 'Per post'), '');
});

test('bio-code verification needs only the username and profile link', () => {
  assert.deepEqual(validateAccountOwnership({ handle: 'glowco.pune', profileUrl: valid.profileUrl }, ig), {});
  const errors = validateAccountOwnership({ handle: 'bad handle!', profileUrl: 'https://x.com/a', notes: 'x'.repeat(601) }, ig);
  assert.deepEqual(Object.keys(errors).sort(), ['handle', 'notes', 'profileUrl']);
  // loginOptional drops the login requirements but still checks values that are given.
  assert.deepEqual(validateAccountSetup({ ...valid, email: '', password: '' }, ig, { loginOptional: true }), {});
  assert.ok(validateAccountSetup({ ...valid, email: 'nope', password: '' }, ig, { loginOptional: true }).email);
});

test('stored setups carry the bio code and the last read, and need no login', () => {
  const stored = readStoredAccountSetup({
    platform: 'Instagram', handle: 'glowco.pune', profileUrl: valid.profileUrl, status: 'Submitted', submittedAt: '2026-10-17T00:00:00.000Z',
    verifyCode: 'RL-ABC234', ownership: 'found', ownershipDetail: 'RL-ABC234 found in the bio.', checkedAt: '2026-10-17T00:01:00.000Z', followers: 0, posts: 0, isPrivate: false,
  })!;
  assert.equal(stored.email, '');
  assert.equal(stored.verifyCode, 'RL-ABC234');
  assert.equal(stored.ownership, 'found');
  assert.equal(stored.followers, 0);
  assert.equal(ownershipProven(publicAccountSetup(stored)), true);
  const odd = readStoredAccountSetup({ handle: 'x', status: 'Submitted', verifyCode: 'nope', ownership: 'hacked', followers: -4 })!;
  assert.equal(odd.verifyCode, undefined, 'malformed codes are dropped');
  assert.equal(odd.ownership, undefined, 'unknown ownership states are dropped');
  assert.equal(odd.followers, undefined);
  assert.equal(ownershipProven(publicAccountSetup(odd)), false);
});
