import { createClient } from '@supabase/supabase-js';
import { lookup } from 'node:dns/promises';
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) });

async function checkSupabaseDns() {
  let hostname;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^db\.[^.]+\.supabase\.(co|in)$/.test(url.hostname)) throw new Error('Invalid API URL');
    hostname = url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    add('supabase_url', false, 'NEXT_PUBLIC_SUPABASE_URL must be the HTTP API URL. Keep the PostgreSQL connection string in DATABASE_URL.');
    return false;
  }
  try {
    await lookup(hostname);
    add('supabase_dns', true);
    return true;
  } catch (error) {
    add('supabase_dns', false, error.code === 'ENOTFOUND'
      ? 'DNS cannot resolve the configured Supabase hostname. Check the project in the Supabase dashboard: resume it if paused, or copy the correct project URL and matching keys. If the project is healthy, contact Supabase support. Check .env.local for overrides and restart/rebuild after changing public variables.'
      : 'DNS lookup failed. Check the network and DNS resolver, then retry.');
    return false;
  }
}

add('node', Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22 or newer is required.');
for (const name of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']) add(name, Boolean(process.env[name]));
add('DATABASE_URL', Boolean(process.env.DATABASE_URL), 'Provide the database session URL to apply and verify migration history.');
for (const name of ['WORK_EMAIL_CRYPTO_SECRET','GIG_INBOX_INGEST_SECRET','CRON_SECRET']) add(name, (process.env[name] ?? '').length >= 32, 'Use an independent secret of at least 32 characters.');
add('email_transport', Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM) || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM), 'Configure and verify a transactional email sender.');
add('production_demo_disabled', process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE !== 'true' && process.env.ENABLE_DEV_ADMIN_BYPASS !== 'true');
const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
add('ADMIN_EMAIL', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail), 'Configure the server-only administrator email and run admin:sync.');
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && await checkSupabaseDns()) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { retry: false, timeout: 10000 }, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
    const version = await sb.rpc('reelencer_backend_version');
    add('database_migrations', !version.error && version.data === 3, version.error ? 'Database unreachable or migrations not applied.' : undefined);
    if (version.error || version.data !== 3) throw new Error('Restore database connectivity and apply migrations before probing dependent schemas.');
    const owner = await sb.rpc('admin_configuration_ready', { p_email: adminEmail });
    add('admin_identity', !owner.error && owner.data === true, 'The server environment must match the registered, active administrator.');
    const buckets = await sb.storage.listBuckets();
    for (const id of ['kyc','worker-profile-media','gig-brief-media']) {
      const bucket = buckets.data?.find(row => row.id === id);
      add('storage_' + id, Boolean(bucket) && bucket.public === (id === 'gig-brief-media'));
    }
    for (const [table,column] of [['profiles','worker_code'],['workers','user_id'],['assignments','worker_id'],['work_items','reward_inr'],['payout_batches','payment_reference'],['upi_configs','verified_by'],['gig_assignments','assigned_emails'],['gig_account_credentials','password'],['dashboard_feedback','user_id'],['work_email_accounts','social_password'],['inbox_recipients','email']]) {
      const probe = await sb.from(table).select(column).limit(0);
      add('schema_' + table, !probe.error, probe.error ? 'Required schema is missing or unavailable.' : undefined);
    }
  } catch { add('database_connection', false, 'Check the Supabase project URL and service key.'); }
}
console.log(JSON.stringify({ ready: checks.every(check => check.ok), checks }, null, 2));
if (checks.some(check => !check.ok)) process.exitCode = 1;
