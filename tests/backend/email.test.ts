import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBrandEmail, firstName, emailAssetOrigin, fillRecipient, RECIPIENT_TOKEN } from '../../lib/email/brandEmail';
import { BRAND_ASSETS } from '../../lib/brand';

const base = {
  siteUrl: 'https://reelencer.example',
  eyebrow: 'Proposal Approved',
  title: 'Your proposal has moved into onboarding',
  tone: 'success' as const,
  greeting: 'Hi Asha,',
  intro: 'Review for Summer Reels is complete.',
  cta: { label: 'Open onboarding panel', href: 'https://reelencer.example/dashboard?section=find&gigId=1&x=2' },
};

test('user-written content is escaped, never injected', () => {
  const { html } = renderBrandEmail({ ...base, sections: [{ label: 'Recruiter note', value: '<img src=x onerror=alert(1)> "quoted" & more' }] });
  assert.ok(!html.includes('<img src=x'), 'raw HTML from notes must not reach the email');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &amp; more'));
  assert.ok(html.includes('href="https://reelencer.example/dashboard?section=find&amp;gigId=1&amp;x=2"'), 'CTA href is attribute-escaped');
});

test('emails and URLs become styled links (no default blue auto-linking), trailing punctuation excluded', () => {
  const { html } = renderBrandEmail({ ...base, intro: 'We tried asha@example.com. See https://reelencer.example/help.' });
  assert.match(html, /<a class="t-ink" href="mailto:asha@example\.com"[^>]*text-decoration:none[^>]*>asha@example\.com<\/a>\./);
  assert.match(html, /<a class="link" href="https:\/\/reelencer\.example\/help"[^>]*>https:\/\/reelencer\.example\/help<\/a>\./);
});

test('layout is production-safe across clients', () => {
  const { html } = renderBrandEmail({ ...base, secondaryCta: { label: 'Open WhatsApp group', href: 'https://chat.whatsapp.com/x' }, highlights: [{ label: 'Decision', value: 'Approved' }], sections: [{ label: 'Empty', value: '   ' }] });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<v:roundrect[^>]+fillcolor="#1f2b24"/, 'Outlook gets a VML button in the dashboard primary colour');
  assert.equal((html.match(/<v:roundrect/g) ?? []).length, 2, 'both buttons are bulletproof');
  assert.ok(!html.includes('>Empty<'), 'blank sections are skipped');
  assert.ok(html.includes(`src="https://reelencer.example${BRAND_ASSETS.emailLogo}"`), 'email clients get a public PNG of the current logo');
  const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(images, [`https://reelencer.example${BRAND_ASSETS.emailLogo}`, `https://reelencer.example${BRAND_ASSETS.emailArt.success}`], 'only the logo and the tone illustration load remotely');
  assert.match(html, /width="32" height="32" alt=""/, 'the decorative logo has reserved dimensions');
  assert.match(html, /width="558" height="210" alt=""/, 'the illustration has reserved dimensions');
  assert.ok(html.includes('class="brand"'), 'the brand name remains readable when images are blocked');
  assert.match(html, /class="chip"[^>]*>.*Proposal Approved<\/span>/, 'the status chip names the update');
  assert.ok(html.includes('@media (prefers-color-scheme: dark)'), 'dark mode palette is included');
  assert.ok(Buffer.byteLength(html) < 100_000, 'stays under Gmail’s ~102KB clipping limit');
});

test('button labels keep their own colour, so clients forcing links to inherit colour can\'t hide them', () => {
  const { html } = renderBrandEmail({ ...base, secondaryCta: { label: 'Find new gigs', href: 'https://reelencer.example/find' } });
  assert.match(html, /class="btn-primary"[^>]*><span class="btn-label" style="color:#ffffff;">Open onboarding panel<\/span><span class="btn-label btn-arrow" style="color:#ffffff;[^"]*">&#8594;<\/span><\/a>/);
  assert.match(html, /class="btn-secondary"[^>]*><span class="btn-label" style="color:#1a201c;">Find new gigs<\/span><\/a>/);
  assert.match(html, /bgcolor="#1f2b24"[^>]*color:#ffffff;/, 'the primary cell is dark with white text even if the link styling is stripped');
});

test('illustrations follow the tone unless one is chosen, and every one exists', async () => {
  const { existsSync } = await import('node:fs');
  const art = (html: string) => /email-(?!logo)([a-z]+)\.[a-f0-9]{12}\.png/.exec(html)?.[1];
  assert.equal(art(renderBrandEmail({ ...base, tone: 'warning' }).html), 'attention');
  assert.equal(art(renderBrandEmail({ ...base, tone: 'closed' }).html), 'closed');
  assert.equal(art(renderBrandEmail({ ...base, tone: 'neutral' }).html), 'inbox');
  assert.equal(art(renderBrandEmail({ ...base, illustration: 'security' }).html), 'security');
  for (const path of Object.values(BRAND_ASSETS.emailArt)) assert.ok(existsSync(`public${path}`), path);
});

test('the recipient placeholder is filled with the escaped address in both parts', () => {
  const rendered = renderBrandEmail(base);
  assert.ok(rendered.html.includes(RECIPIENT_TOKEN) && rendered.text.includes(RECIPIENT_TOKEN));
  const filled = fillRecipient(rendered, 'a&b@example.com');
  assert.ok(!filled.html.includes(RECIPIENT_TOKEN) && !filled.text?.includes(RECIPIENT_TOKEN));
  assert.ok(filled.html.includes('a&amp;b@example.com'));
  assert.ok(filled.text?.includes('Sent to a&b@example.com.'));
});

test('plain-text part carries the message and every link', () => {
  const { text } = renderBrandEmail({ ...base, secondaryCta: { label: 'Open WhatsApp group', href: 'https://chat.whatsapp.com/x' }, sections: [{ label: 'Recruiter note', value: 'Line one\nLine two' }] });
  assert.match(text, /^Reelencer\n\nPROPOSAL APPROVED: Your proposal has moved into onboarding/);
  assert.ok(text.includes('Open onboarding panel: https://reelencer.example/dashboard?section=find&gigId=1&x=2'));
  assert.ok(text.includes('Open WhatsApp group: https://chat.whatsapp.com/x'));
  assert.ok(text.includes('Recruiter note:\nLine one\nLine two'));
  assert.ok(!/\n\n\n/.test(text), 'no runs of blank lines');
});

test('greeting name helper ignores placeholders', () => {
  assert.equal(firstName('Asha Creator'), 'Asha');
  assert.equal(firstName('there'), '');
  assert.equal(firstName(undefined), '');
});

test('every email uses the same logo, always from a public https origin', () => {
  const logoSrcs = (html: string) => [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]).filter((src) => src.includes('/brand/email-logo.'));
  const publicHtml = renderBrandEmail(base).html;
  const srcs = logoSrcs(publicHtml);
  assert.equal(srcs.length, 1, 'one logo, in the header');
  assert.ok(srcs.every((src) => src === `https://reelencer.example${BRAND_ASSETS.emailLogo}`), 'the current logo asset');

  // Mail sent from dev, LAN or tunnels must never reference an address the recipient can't reach.
  const saved = { ...process.env };
  try {
    delete process.env.EMAIL_ASSET_ORIGIN; delete process.env.NEXT_PUBLIC_SITE_URL; delete process.env.APP_URL; delete process.env.NEXT_PUBLIC_APP_URL;
    for (const site of ['http://localhost:3000', 'https://localhost', 'http://reelencer.com', 'https://192.168.1.20:3000', 'https://10.0.0.5', 'https://app.local', 'https://[::1]']) {
      assert.equal(emailAssetOrigin(site), 'https://reelencer.com', site);
      assert.ok([...renderBrandEmail({ ...base, siteUrl: site }).html.matchAll(/<img src="([^"]+)"/g)].every((m) => m[1].startsWith('https://reelencer.com/brand/email-')), site);
    }
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.reelencer.com/';
    assert.equal(emailAssetOrigin('http://localhost:3000'), 'https://staging.reelencer.com');
    assert.equal(emailAssetOrigin('https://reelencer.example'), 'https://reelencer.example');
  } finally {
    process.env = saved;
  }
});

test('the email logo asset is the 3x tile PNG', async () => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(`public${BRAND_ASSETS.emailLogo}`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 144);
  assert.equal(png.readUInt32BE(20), 144);
});
