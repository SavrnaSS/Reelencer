// Checks transactional email setup: which provider sends, from which address, and (for Resend) whether the business
// domain is verified, listing any DNS records still missing. `--send you@example.com` sends a branded test email.
//   npm run mail:check
//   npm run mail:check -- --send you@example.com
import { domainOf, mailDomain, resendKey, resolveProvider, resolveSender, supportAddress } from '../lib/email/config.ts';

const args = process.argv.slice(2);
const sendIndex = args.indexOf('--send');
const testTo = sendIndex >= 0 ? args[sendIndex + 1] : '';
const ok = (label, value) => console.log(`  ✓ ${label}: ${value}`);
const bad = (label, value) => { console.log(`  ✗ ${label}: ${value}`); process.exitCode = 1; };
const note = (text) => console.log(`    ${text}`);

console.log('\nReelencer email');
const provider = resolveProvider();
if (resendKey() && !resendKey().startsWith('re_')) note('Warning: RESEND_API_KEY doesn\'t start with "re_", so it is probably not a Resend secret key.');
if (!provider) {
  bad('Provider', 'none configured. Set RESEND_API_KEY.');
  process.exit();
}
(provider === 'resend' ? ok : bad)('Provider', provider === 'resend' ? 'Resend' : `${provider} (set RESEND_API_KEY to send through Resend)`);
const sender = resolveSender(provider, process.env, process.env.SMTP_USER || process.env.GMAIL_IMAP_USER || '');
(sender.problem ? bad : ok)('From', sender.problem ?? sender.from);
ok('Reply-To', process.env.MAIL_REPLY_TO || supportAddress());
if (process.env.MAIL_SMTP_FALLBACK === 'true') ok('Fallback', 'SMTP if Resend is unavailable');
(process.env.RESEND_WEBHOOK_SECRET ? ok : bad)('Bounce/complaint webhook', process.env.RESEND_WEBHOOK_SECRET ? 'signing secret set' : 'RESEND_WEBHOOK_SECRET missing (bounces and spam complaints won\'t be suppressed)');

if (provider === 'resend') {
  const domain = domainOf(sender.address) || mailDomain();
  const api = (path) => fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${resendKey()}` }, signal: AbortSignal.timeout(15000) });
  try {
    const list = await api('/domains');
    if (list.status === 401 || list.status === 403) {
      note(`Domain status: this API key can only send (it can't read domains). Check ${domain} under Resend → Domains.`);
    } else if (!list.ok) {
      const message = (await list.json().catch(() => ({}))).message ?? `HTTP ${list.status}`;
      bad('Resend API', message);
      if (/api key/i.test(message)) {
        note(/^[0-9a-f-]{36}$/i.test(resendKey())
          ? 'RESEND_API_KEY holds the key\'s ID (a UUID). Use the secret key itself: it starts with "re_" and is shown only once when you create it.'
          : 'Create a new key in Resend → API Keys and paste the full value (it starts with "re_").');
      }
    } else {
      const found = ((await list.json()).data ?? []).find((d) => d.name === domain);
      if (!found) {
        bad('Domain', `${domain} isn't added in Resend yet. Resend → Domains → Add domain → ${domain}`);
      } else {
        const detail = await (await api(`/domains/${found.id}`)).json();
        (detail.status === 'verified' ? ok : bad)('Domain', `${domain} is ${detail.status} (${detail.region ?? 'region n/a'})`);
        const pending = (detail.records ?? []).filter((r) => r.status !== 'verified');
        if (pending.length) {
          note('Add these DNS records at your domain registrar, then press Verify in Resend:');
          for (const r of pending) note(`  ${r.type.padEnd(5)} ${r.name.padEnd(28)} ${r.priority != null ? `(priority ${r.priority}) ` : ''}${r.value}   [${r.status}]`);
        }
        if (!(detail.records ?? []).some((r) => /_dmarc/i.test(r.name))) note(`Recommended: a DMARC record, e.g. TXT _dmarc.${domain} "v=DMARC1; p=none; rua=mailto:${supportAddress()}"`);
      }
    }
  } catch (error) {
    bad('Resend API', error instanceof Error ? error.message : 'unreachable');
  }
}

if (sendIndex >= 0) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo ?? '')) {
    bad('Test email', 'usage: npm run mail:check -- --send you@example.com');
  } else {
    const { sendEmail, emailBaseUrl } = await import('../lib/email/send.ts');
    const { renderBrandEmail } = await import('../lib/email/brandEmail.ts');
    const { html, text } = renderBrandEmail({
      siteUrl: emailBaseUrl(),
      eyebrow: 'Delivery check',
      tone: 'neutral',
      title: 'Email is set up',
      intro: `This test was sent through ${provider} from ${sender.address}. If it landed in your inbox (not spam), Reelencer emails are good to go.`,
      cta: { label: 'Open Reelencer', href: emailBaseUrl() },
    });
    try {
      const result = await sendEmail({ to: testTo, subject: 'Reelencer email delivery check', html, text, category: 'system' });
      ok('Test email', `sent via ${result.provider}${result.id ? ` (id ${result.id})` : ''}`);
    } catch (error) {
      bad('Test email', error instanceof Error ? error.message : 'failed');
    }
  }
}
console.log('');
