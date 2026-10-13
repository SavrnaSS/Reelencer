import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { realtimeTestSchema } from './helpers/realtime';
import { matchesConditions, sanitizeConditions, EMPTY_CONDITIONS } from '../../lib/applicationAutomationRules';
import { buildAutomationUpdate, type TemplateDto } from '../../lib/api/applicationAutomation';

const DAY = 86_400_000;
const now = Date.parse('2026-10-06T12:00:00Z');
const base = { id: 'a1', gigId: 'gig-1', status: 'Accepted', appliedAt: new Date(now - 10 * DAY).toISOString(), proposal: {} as Record<string, unknown> };

test('rule conditions match status, gig, idle time, invite, group and proposal', () => {
  const c = { ...EMPTY_CONDITIONS, statuses: ['Accepted'], invite: 'missing' as const };
  assert.equal(matchesConditions(base, c, now), true);
  assert.equal(matchesConditions({ ...base, proposal: { whatsappLink: 'https://chat.whatsapp.com/x' } }, c, now), false);
  assert.equal(matchesConditions({ ...base, status: 'Pending' }, c, now), false);
  assert.equal(matchesConditions(base, { ...EMPTY_CONDITIONS, gigId: 'gig-2' }, now), false);
  // Idle time uses the latest activity, so a recent decision resets the clock.
  assert.equal(matchesConditions(base, { ...EMPTY_CONDITIONS, minAgeDays: 7 }, now), true);
  assert.equal(matchesConditions({ ...base, decidedAt: new Date(now - DAY).toISOString() }, { ...EMPTY_CONDITIONS, minAgeDays: 7 }, now), false);
  assert.equal(matchesConditions({ ...base, proposal: { groupJoinedConfirmed: true } }, { ...EMPTY_CONDITIONS, joined: 'no' }, now), false);
  assert.equal(matchesConditions({ ...base, proposal: { pitch: 'hi' } }, { ...EMPTY_CONDITIONS, proposal: 'without' }, now), false);
});

test('untrusted rule conditions are normalised, never trusted', () => {
  const c = sanitizeConditions({ gigId: '', statuses: ['Accepted', 'Hacked', 'Accepted'], minAgeDays: '-4', invite: 'drop table', joined: 'yes', extra: 1 });
  assert.deepEqual(c, { gigId: 'any', statuses: ['Accepted'], minAgeDays: 0, invite: 'any', joined: 'yes', proposal: 'any' });
  assert.deepEqual(sanitizeConditions(null), EMPTY_CONDITIONS);
  assert.equal(sanitizeConditions({ minAgeDays: 9999 }).minAgeDays, 365);
});

test('automation updates mirror recruiter actions and never wipe an issued invite link', () => {
  const app = { ...base, workerId: 'WKR-1', workerName: 'Asha', proposal: { whatsappLink: 'https://chat.whatsapp.com/keep', adminNote: 'old', pitch: 'p' } };
  const template: TemplateDto = { id: 't', name: 'T', adminNote: 'new note', adminExplanation: 'why', whatsappLink: '', onboardingSteps: 'steps', updatedAt: '' };

  const push = buildAutomationUpdate(app, 'push', template);
  assert.equal(push.status, 'Accepted', 'push keeps the current status');
  assert.equal(push.notificationMode, 'whatsapp_invite');
  assert.equal(push.proposal?.whatsappLink, 'https://chat.whatsapp.com/keep');
  assert.equal(push.proposal?.adminNote, 'new note');
  assert.equal(push.proposal?.pitch, 'p', 'worker proposal content is preserved');

  const reject = buildAutomationUpdate(app, 'Rejected', null);
  assert.equal(reject.status, 'Rejected');
  assert.equal(reject.proposal?.reviewStatus, 'Rejected');
  assert.equal(reject.proposal?.adminNote, 'old', 'no template keeps the existing message');
  assert.equal(reject.notificationMode, undefined);
  assert.equal(reject.workerName, 'Asha');
});

const db = new PGlite();
const admin = '33333333-3333-4333-8333-333333333333';
const worker = '11111111-1111-4111-8111-111111111111';

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(realtimeTestSchema);
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (file === '202610040007_admin_identity.sql') await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');
    try { await db.exec(await readFile('supabase/migrations/' + file, 'utf8')); }
    catch (error) { throw new Error('Migration failed: ' + file, { cause: error }); }
  }
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'operator@example.test',now()),($2,'worker@example.test',now())", [admin, worker]);
  await db.query("insert into public.gigs(id,title,company,workload,payout) values('gig-1','Gig','Co','Part time','₹100')");
});
after(async () => { await db.close(); });

test('automation tables are server-only', async () => {
  for (const table of ['application_message_templates', 'application_automation_rules', 'application_automation_handled', 'application_automation_runs']) {
    const r = await db.query<{ rls: boolean; anon: boolean; auth: boolean }>(
      "select c.relrowsecurity as rls, has_table_privilege('anon','public.'||$1,'select') as anon, has_table_privilege('authenticated','public.'||$1,'select') as auth from pg_class c where c.relname=$1", [table]);
    assert.deepEqual(r.rows[0], { rls: true, anon: false, auth: false }, table);
  }
});

test('the ledger lets only one runner claim an application per rule', async () => {
  const rule = (await db.query<{ id: string }>("insert into public.application_automation_rules(name,action,owner_id) values('R','push',$1) returning id", [admin])).rows[0].id;
  const app = (await db.query<{ id: string }>("insert into public.gig_applications(gig_id,worker_code) values('gig-1','WKR-1') returning id")).rows[0].id;
  const claim = () => db.query("insert into public.application_automation_handled(rule_id,application_id,outcome) values($1,$2,'claimed') on conflict do nothing returning application_id", [rule, app]);
  const [first, second] = [await claim(), await claim()];
  assert.equal(first.rows.length + second.rows.length, 1);
  await assert.rejects(db.query("update public.application_automation_handled set outcome='bogus' where rule_id=$1", [rule]));
});

test('templates used by a rule cannot be deleted and invite links must be https', async () => {
  const tpl = (await db.query<{ id: string }>("insert into public.application_message_templates(name,created_by) values('T',$1) returning id", [admin])).rows[0].id;
  await db.query("insert into public.application_automation_rules(name,action,owner_id,template_id) values('R2','push',$1,$2)", [admin, tpl]);
  await assert.rejects(db.query('delete from public.application_message_templates where id=$1', [tpl]));
  await assert.rejects(db.query("insert into public.application_message_templates(name,created_by,whatsapp_link) values('Bad',$1,'javascript:alert(1)')", [admin]));
  await assert.rejects(db.query("insert into public.application_automation_rules(name,action,owner_id) values('Bad','DeleteAll',$1)", [admin]));
});
