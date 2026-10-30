import test from 'node:test';
import assert from 'node:assert/strict';
import { accountVerifyCode, contentPostingSetupMail } from '../../lib/api/accountSetup';
import { encodeAccountInstructions } from '../../lib/accountSetup';
import { renderBrandEmail } from '../../lib/email/brandEmail';

process.env.WORK_EMAIL_CRYPTO_SECRET ||= 'test-secret-key-for-content-posting-mail-0123456789';

const gigUrl = 'https://reelencer.example/dashboard?section=find&gigId=g1';
const gig = {
  id: 'g1', title: 'Glow Co skincare reels', company: 'Glow Co', platform: 'Instagram', gig_type: 'Content Posting',
  payout: '₹2,800', payout_type: 'Per post',
  requirements: ['Deliver 4 reels', encodeAccountInstructions('1. Username like glowco.<city>\n2. Use the logo as the profile photo')],
};

test('content posting setup email carries the personal code, the brief and a link to the account form', () => {
  const config = contentPostingSetupMail({ applicationId: 'app-1', gig, gigUrl });
  const code = accountVerifyCode('app-1');
  assert.match(code, /^RL-[A-Z0-9]{6}$/);
  assert.equal(config.code?.value, code);
  assert.equal(config.subject, 'Glow Co skincare reels: your next step');
  assert.equal(config.ctaHref, `${gigUrl}#account-setup`);
  // Every link stays on Reelencer: a code next to a link to another site's settings reads as phishing.
  assert.equal(config.secondaryCtaHref, undefined);
  assert.doesNotMatch(JSON.stringify(config), /verify your|start earning|instagram\.com/i);
  assert.ok(config.steps?.some((step) => step.body.includes(code)), 'the bio step names the code');
  assert.ok(config.highlights?.some((item) => item.label === 'Rate' && item.value === '₹2,800 per approved post'));
  const brief = config.sections?.find((section) => section.label === "From Glow Co's brief");
  assert.equal(brief?.value, '• Username like glowco.<city>\n• Use the logo as the profile photo');

  const { html, text } = renderBrandEmail({ siteUrl: 'https://reelencer.example', ...config, cta: { label: config.ctaLabel!, href: config.ctaHref! } });
  assert.ok(html.includes(code) && text.includes(`Your profile code: ${code}`));
  assert.ok(html.includes('glowco.&lt;city&gt;'), 'brief text is escaped');
  // Instructions come before the button, so the reader knows what the button is for.
  assert.ok(html.indexOf('How to finish setup') < html.indexOf('Open account setup'));
  assert.ok(text.indexOf('How to finish setup:') < text.indexOf('Open account setup:'));
});

test('platforms the server cannot read say the team checks the code', () => {
  const config = contentPostingSetupMail({ applicationId: 'app-2', gig: { ...gig, platform: 'YouTube Shorts', requirements: [] }, gigUrl });
  assert.equal(config.steps?.at(-1)?.title, 'The team confirms it');
  assert.ok(!config.sections?.some((section) => section.label.startsWith('From')));
});
