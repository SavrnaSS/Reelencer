import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

// Applies supabase/migrations in order, once each, recorded with checksums in reelencer_migrations.applied.
//   npm run db:migrate                              apply every pending migration in one transaction
//   npm run db:migrate -- --status                  list applied and pending migrations; changes nothing
//   npm run db:migrate -- --baseline-through <name> record migrations up to <name> as applied without running
//                                                   them, for a database that was migrated by hand
//   npm run db:migrate -- --only <name>[,<name>]    apply just these pending migrations (in file order)

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a migration name.`);
  return value;
};
function fail(message) {
  console.error(message);
  process.exit(1);
}

// The first Postgres address among the usual names; SUPABASE_URL counts only when it holds one (the app itself
// reads NEXT_PUBLIC_SUPABASE_URL for the https:// API address).
const SOURCES = ['DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_URL', 'SUPABASE_URL'];
const isPostgres = (value) => /^postgres(ql)?:\/\//i.test(value ?? '');
const source = SOURCES.find((name) => isPostgres(process.env[name]?.trim().replace(/^["']|["']$/g, '')));
if (!source) fail(`No database address found. Set DATABASE_URL to the Postgres connection string (Supabase → Connect → Session pooler or Direct connection); checked ${SOURCES.join(', ')}.`);
const url = new URL(process.env[source].trim().replace(/^["']|["']$/g, ''));
console.log(`Database: ${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname} (from ${source})`);

const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const caFile = process.env.DATABASE_SSL_CA_FILE || url.searchParams.get('sslrootcert');
const ca = process.env.DATABASE_SSL_CA || (caFile ? await readFile(caFile, 'utf8') : undefined);
const certFile = url.searchParams.get('sslcert');
const keyFile = url.searchParams.get('sslkey');
const cert = certFile ? await readFile(certFile, 'utf8') : undefined;
const key = keyFile ? await readFile(keyFile, 'utf8') : undefined;
// Prevent URL parameters from replacing the explicit, verified TLS options.
for (const name of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(name);

const files = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
const resolve = (name) => {
  const match = files.find((file) => file === name || file === `${name}.sql` || file.startsWith(`${name}_`));
  if (!match) fail(`No migration named ${name} in supabase/migrations.`);
  return match;
};
const status = flag('--status');
const baseline = option('--baseline-through');
const only = option('--only')?.split(',').map((name) => resolve(name.trim()));
if ([status, !!baseline, !!only].filter(Boolean).length > 1) fail('Use one of --status, --baseline-through or --only at a time.');

const client = new Client({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}), ...(cert ? { cert } : {}), ...(key ? { key } : {}) }, connectionTimeoutMillis: 10000, statement_timeout: 120000 });

// What to try when connecting fails, by error code.
const HINTS = {
  ENOTFOUND: 'The host name did not resolve. Check the address.',
  ENETUNREACH: "The direct db.<ref>.supabase.co host is IPv6-only; on an IPv4-only network use the Session pooler address from Supabase → Connect.",
  EHOSTUNREACH: 'The host is unreachable from this network. Try the Session pooler address from Supabase → Connect.',
  ECONNREFUSED: 'The connection was refused. Check the port (5432 direct or session pooler).',
  ETIMEDOUT: 'The connection timed out. Check the network, or use the Session pooler address.',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS could not be verified. Set DATABASE_SSL_CA_FILE=supabase/certs/prod-ca-2021.crt.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS could not be verified. Set DATABASE_SSL_CA_FILE=supabase/certs/prod-ca-2021.crt.',
  '28P01': 'The database password was rejected. Copy a fresh connection string from Supabase → Connect.',
  '3D000': 'That database does not exist. The path should be /postgres.',
};
const explain = (error) => `${error.code ?? 'error'}: ${String(error.message ?? '').slice(0, 300)}`;

let connected = false;
try {
  try {
    await client.connect();
  } catch (error) {
    fail(`Could not connect (${explain(error)}).${HINTS[error.code] ? '\n' + HINTS[error.code] : ''}`);
  }
  connected = true;
  await client.query("select pg_advisory_lock(hashtext('reelencer_migrations'))");
  await client.query('create schema if not exists reelencer_migrations');
  await client.query('create table if not exists reelencer_migrations.applied(name text primary key, checksum text not null, applied_at timestamptz not null default now())');
  const applied = new Map((await client.query('select name, checksum from reelencer_migrations.applied')).rows.map((row) => [row.name, row.checksum]));
  const migrations = await Promise.all(files.map(async (name) => {
    const sql = await readFile('supabase/migrations/' + name, 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  const modified = migrations.filter((m) => applied.has(m.name) && applied.get(m.name) !== m.checksum);
  const pending = migrations.filter((m) => !applied.has(m.name));

  if (status) {
    for (const m of migrations) console.log(`${!applied.has(m.name) ? 'pending ' : applied.get(m.name) !== m.checksum ? 'MODIFIED' : 'applied '}  ${m.name}`);
    console.log(`\n${migrations.length - pending.length} applied, ${pending.length} pending${modified.length ? `, ${modified.length} modified after applying` : ''}.`);
    if (pending.length && pending.length === migrations.length) console.log('Nothing is recorded yet. If this database was migrated by hand, record what it already has with --baseline-through <last applied migration>.');
  } else if (modified.length) {
    throw new Error('An applied migration was modified: ' + modified.map((m) => m.name).join(', ') + '. Add a new migration instead.');
  } else if (baseline) {
    const through = resolve(baseline);
    const marked = pending.filter((m) => m.name <= through);
    await client.query('begin');
    for (const m of marked) await client.query('insert into reelencer_migrations.applied(name,checksum) values($1,$2)', [m.name, m.checksum]);
    await client.query('commit');
    console.log(marked.length ? `Recorded ${marked.length} migrations through ${through} as already applied (not run).` : `Nothing to record: everything through ${through} is already recorded.`);
  } else {
    const run = only ? pending.filter((m) => only.includes(m.name)) : pending;
    if (only) for (const name of only) if (applied.has(name)) console.log('Already applied: ' + name);
    if (!run.length) {
      console.log('No pending migrations.');
    } else {
      // Install schema and permissions atomically, even when a later migration fails.
      await client.query('begin');
      for (const m of run) {
        try {
          await client.query(m.sql);
          await client.query('insert into reelencer_migrations.applied(name,checksum) values($1,$2)', [m.name, m.checksum]);
          console.log('Prepared: ' + m.name);
        } catch (error) {
          await client.query('rollback');
          console.error(`Migration failed: ${m.name} (${explain(error)})`);
          if (!only && applied.size === 0) console.error('Nothing was recorded as applied yet, so every migration ran from the start. If this database was migrated by hand, run with --status, then --baseline-through <last applied migration>.');
          throw new Error('Database schema needs review before deployment. No pending migrations were committed.');
        }
      }
      await client.query('commit');
      console.log(`Committed ${run.length} ${run.length === 1 ? 'migration' : 'migrations'}.`);
    }
  }
} catch (error) {
  if (connected) await client.query('rollback').catch(() => {});
  console.error(error.message.startsWith('Database schema') || error.message.startsWith('An applied migration') ? error.message : `Migration could not complete (${explain(error)}).`);
  process.exitCode = 1;
} finally {
  if (connected) await client.end();
}
