import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL before running migrations.');
const url = new URL(process.env.DATABASE_URL);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const caFile = process.env.DATABASE_SSL_CA_FILE || url.searchParams.get('sslrootcert');
const ca = process.env.DATABASE_SSL_CA || (caFile ? await readFile(caFile, 'utf8') : undefined);
const certFile = url.searchParams.get('sslcert');
const keyFile = url.searchParams.get('sslkey');
const cert = certFile ? await readFile(certFile, 'utf8') : undefined;
const key = keyFile ? await readFile(keyFile, 'utf8') : undefined;
// Prevent URL parameters from replacing the explicit, verified TLS options.
for (const name of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(name);
const client = new Client({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}), ...(cert ? { cert } : {}), ...(key ? { key } : {}) }, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
let connected = false;
try {
  await client.connect(); connected = true;
  await client.query("select pg_advisory_lock(hashtext('reelencer_migrations'))");
  await client.query('create schema if not exists reelencer_migrations');
  await client.query('create table if not exists reelencer_migrations.applied(name text primary key, checksum text not null, applied_at timestamptz not null default now())');
  // Install schema and permissions atomically, even when a later migration fails.
  await client.query('begin');
  for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile('supabase/migrations/' + name, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('select checksum from reelencer_migrations.applied where name=$1', [name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error('An applied migration was modified: ' + name);
      console.log('Already applied: ' + name); continue;
    }
    try {
      await client.query(sql);
      await client.query('insert into reelencer_migrations.applied(name,checksum) values($1,$2)', [name,checksum]);
      console.log('Prepared: ' + name);
    } catch (error) {
      await client.query('rollback');
      console.error('Migration rolled back: ' + name + ' (code ' + (error.code ?? 'unknown') + ')');
      throw new Error('Database schema needs review before deployment. No pending migrations were committed.');
    }
  }
  await client.query('commit');
  console.log('All pending migrations committed.');
} catch (error) {
  if (connected) await client.query('rollback').catch(() => {});
  console.error(error.message.startsWith('Database schema') || error.message.startsWith('An applied migration') ? error.message : 'Migration could not complete. Check database connectivity, TLS, privileges and the migration log.');
  process.exitCode = 1;
} finally {
  if (connected) await client.end();
}
