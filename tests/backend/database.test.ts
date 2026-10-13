import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { realtimeTestSchema } from './helpers/realtime';

const db = new PGlite();
const worker = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
let batch: string;
let workId: string;

async function liveAccount(code: string, name: string) {
  await db.query("insert into public.gigs(id,title,company,workload,payout) values($1,'Live stats','Test','Reels','49')", [name]);
  const application = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values($1,$2,'Accepted') returning id as value", [name, code]);
  return scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle) values($1,$2,$3,'Instagram','livecreator') returning id as value", [application, name, code]);
}

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
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === '202610040007_admin_identity.sql') {
      // Hosted projects can grant new public tables to API roles by default.
      await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');
    }
    try { await db.exec(await readFile('supabase/migrations/' + file, 'utf8')); }
    catch (error) { throw new Error('Migration failed: ' + file, { cause: error }); }
  }
  for (const [id, email] of [[worker,'worker@example.test'],[other,'other@example.test'],[admin,'operator@example.test']]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
    await db.query('select public.bootstrap_worker($1)',[id]);
  }
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',null)",[admin]);
});
after(async () => { await db.close(); });

test('linked accounts and every snapshot or reel change emit private invalidations without row contents', async () => {
  await db.exec('truncate realtime.messages');
  const code = await scalar<string>('select worker_code as value from public.profiles where id=$1', [worker]);
  const account = await liveAccount(code, 'live-changes');
  const snapshot = await scalar<string>('insert into public.social_account_snapshots(account_id,followers) values($1,3735) returning id as value', [account]);
  await db.query('update public.social_account_snapshots set followers=4000 where id=$1', [snapshot]);
  await db.query('delete from public.social_account_snapshots where id=$1', [snapshot]);
  const post = await scalar<string>("insert into public.social_account_posts(account_id,url,status,views) values($1,'https://www.instagram.com/reel/LIVE/','submitted',100) returning id as value", [account]);
  await db.query("update public.social_account_posts set status='approved',views=200 where id=$1", [post]);
  await db.query('delete from public.social_account_posts where id=$1', [post]);
  await db.query("update public.linked_social_accounts set status='paused' where id=$1", [account]);
  await db.query('delete from public.linked_social_accounts where id=$1', [account]);
  // Creator topics only (admin consoles get their own statement-level signals).
  const messages = await db.query<{ topic: string; private: boolean; event: string; payload: Record<string, unknown> }>("select topic,private,event,payload from realtime.messages where topic not like 'admin:%'");
  assert.equal(messages.rows.length, 9);
  for (const message of messages.rows) {
    assert.equal(message.topic, `social-accounts:${worker}`);
    assert.equal(message.private, true);
    assert.equal(message.event, 'changed');
    assert.deepEqual(Object.keys(message.payload), ['changedAt']);
  }
});

test('live notifications resolve worker aliases and inform both owners on reassignment', async () => {
  const aliasUser = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'live-alias@example.test',now())", [aliasUser]);
  await db.query('select public.bootstrap_worker($1)', [aliasUser]);
  await db.query("update public.workers set id='LIVE-LEGACY-CODE' where user_id=$1", [aliasUser]);
  for (const [i, code] of [aliasUser, 'LIVE-LEGACY-CODE'].entries()) {
    await db.exec('truncate realtime.messages');
    const account = await liveAccount(code, `live-alias-${i}`);
    assert.equal(await scalar<string>("select topic as value from realtime.messages where topic not like 'admin:%'"), `social-accounts:${aliasUser}`);
    await db.query('update public.linked_social_accounts set worker_code=$2 where id=$1', [account, other]);
    const messages = await db.query<{ topic: string }>("select topic from realtime.messages where topic not like 'admin:%'");
    assert.deepEqual(messages.rows.map(row => row.topic).sort(), [`social-accounts:${aliasUser}`, `social-accounts:${aliasUser}`, `social-accounts:${other}`].sort());
  }
});

test('live updates respect transactions and skip inactive recipients', async () => {
  const account = await liveAccount(worker, 'live-transaction');
  await db.exec('truncate realtime.messages');
  await db.exec('begin');
  await db.query('insert into public.social_account_snapshots(account_id,followers) values($1,3735)', [account]);
  await db.exec('rollback');
  assert.equal(await scalar<number>("select count(*)::int as value from realtime.messages where topic not like 'admin:%'"), 0, 'rolled-back readings do not notify');
  await db.query('update public.profiles set active=false where id=$1', [worker]);
  try {
    await db.query('insert into public.social_account_snapshots(account_id,followers) values($1,4000)', [account]);
    // Social-account signals skip inactive recipients (the deactivation itself is a separate account signal).
    assert.equal(await scalar<number>("select count(*)::int as value from realtime.messages where topic like 'social-accounts:%'"), 0);
  } finally { await db.query('update public.profiles set active=true where id=$1', [worker]); }
  const send = await scalar<string>("select pg_get_functiondef('realtime.send(jsonb,text,text,boolean)'::regprocedure) as value");
  await db.exec("create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$begin raise exception 'broadcast_unavailable'; end$$");
  try {
    await db.query('insert into public.social_account_snapshots(account_id,followers) values($1,4200)', [account]);
    assert.equal(await scalar<number>('select max(followers)::int as value from public.social_account_snapshots where account_id=$1', [account]), 4200, 'notification failures must never lose saved followers');
  } finally { await db.exec(send); }
});

test('notification RLS prevents cross-user reads and client spoofing even alongside broad policies', async () => {
  await db.exec(`truncate realtime.messages;
    grant usage on schema realtime to anon;
    grant select,insert on realtime.messages to anon,authenticated;
    create policy test_other_feature_read on realtime.messages for select to anon,authenticated using(true);
    create policy test_other_feature_write on realtime.messages for insert to anon,authenticated with check(true);`);
  for (const id of [worker, other]) await db.query("select realtime.send('{\"changedAt\":\"2026-10-09\"}', 'changed', $1, true)", [`social-accounts:${id}`]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [worker]);
  await db.exec('set role authenticated');
  try {
    const messages = await db.query<{ topic: string }>('select topic from realtime.messages');
    assert.deepEqual(messages.rows.map(row => row.topic), [`social-accounts:${worker}`]);
    await assert.rejects(db.query("insert into realtime.messages(topic,payload) values($1,'{}')", [`social-accounts:${worker}`]), /row-level security/);
    await assert.rejects(db.query("insert into realtime.messages(topic,payload) values($1,'{}')", [`social-accounts:${other}`]), /row-level security/);
    for (const table of ['linked_social_accounts', 'social_account_snapshots', 'social_account_posts']) await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  } finally { await db.exec('reset role'); }
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec('set role anon');
  try { assert.equal((await db.query('select topic from realtime.messages')).rows.length, 0); }
  finally {
    await db.exec('reset role; drop policy test_other_feature_read on realtime.messages; drop policy test_other_feature_write on realtime.messages; revoke select,insert on realtime.messages from anon; revoke insert on realtime.messages from authenticated');
  }
});

async function scalar<T>(query: string, params: unknown[] = []) {
  const result = await db.query<{ value: T }>(query,params);
  return result.rows[0]?.value;
}

test('migrations create protected tables and private storage', async () => {
  assert.equal(await scalar<number>('select public.reelencer_backend_version() as value'),3);
  assert.equal(await scalar<boolean>("select bool_and(relrowsecurity) as value from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"),true);
  assert.equal(await scalar<boolean>("select public from storage.buckets where id='kyc'"),undefined);
  const storage = await db.query<{ public: boolean }>("select public from storage.buckets where id='kyc'");
  assert.equal(storage.rows[0].public,false);
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.request_payout(uuid)','execute') as value"),false);
  assert.equal(await scalar<boolean>("select has_table_privilege('anon','public.gig_account_credentials','select') as value"),false);
  assert.equal(await scalar<boolean>("select has_column_privilege('authenticated','public.profiles','role','update') as value"),false);
  for (const table of ['linked_social_accounts', 'social_account_snapshots', 'social_account_posts']) {
    assert.equal(await scalar<boolean>(`select has_table_privilege('authenticated','public.${table}','select') as value`), false, 'live updates must not expose social rows');
  }
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.notify_creator_social_updates()','execute') as value"), false);
});

test('bootstrap is idempotent and ignores role spoofing in metadata', async () => {
  await db.query("update auth.users set raw_user_meta_data='{" + '"role":"Admin"' + "}' where id=$1",[worker]);
  await Promise.all([db.query('select public.bootstrap_worker($1)',[worker]),db.query('select public.bootstrap_worker($1)',[worker])]);
  assert.equal(await scalar<string>('select role as value from public.profiles where id=$1',[worker]),'Worker');
  assert.equal(await scalar<number>('select count(*)::int as value from public.workers where user_id=$1',[worker]),1);
});

test('work rejects foreign ownership and invalid state transitions', async () => {
  workId = await scalar<string>("insert into public.work_items(public_id,worker_id,title,reward_inr) values('WI-TEST',$1,'Test work',1200) returning id as value",[worker]);
  await assert.rejects(db.query("select public.transition_work_item($1,'WI-TEST','start','{}')",[other]),/not_found/);
  await db.query("select public.transition_work_item($1,'WI-TEST','start','{}')",[worker]);
  await db.query("select public.transition_work_item($1,'WI-TEST','submit',$2)",[worker,JSON.stringify({reelUrl:'https://example.test/reel',screenshotUrl:'https://example.test/proof'})]);
  await assert.rejects(db.query("select public.transition_work_item($1,'WI-TEST','review','{\"status\":\"Approved\"}')",[worker]),/forbidden/);
  await db.query("select public.transition_work_item($1,'WI-TEST','review','{\"status\":\"Approved\"}')",[admin]);
  await assert.rejects(db.query("select public.transition_work_item($1,'WI-TEST','submit','{}')",[worker]),/invalid_transition/);
});

test('payout requires KYC and server verification; concurrent retries reserve earnings once', async () => {
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/kyc_required/);
  await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test','1990-01-01','123','Test','ID','123','test','test')",[worker]);
  await db.query("select public.save_upi_config($1,'worker@bank','Weekly','Fri')",[worker]);
  assert.equal(await scalar<boolean>('select verified as value from public.upi_configs where worker_id=$1',[worker]),false);
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/upi_required/);
  await assert.rejects(db.query("select public.verify_upi_config($1,$1,'worker@bank',true)",[worker]),/forbidden/);
  await db.query("select public.verify_upi_config($1,$2,'worker@bank',true)",[admin,worker]);
  const results = await Promise.all([scalar<{batchId:string}>('select public.request_payout($1) as value',[worker]),scalar<{batchId:string}>('select public.request_payout($1) as value',[worker])]);
  batch=results[0].batchId;
  assert.equal(results[1].batchId,batch);
  assert.equal(await scalar<number>('select count(*)::int as value from public.payout_items where work_item_id=$1',[workId]),1);
  await assert.rejects(db.query("select public.save_upi_config($1,'changed@bank','Weekly','Fri')",[worker]),/active_batch/);
});

test('payout transitions require admin, approval and a payment reference; paid is irreversible', async () => {
  await assert.rejects(db.query("select public.transition_payout($1,$2,'approve')",[worker,batch]),/forbidden/);
  await assert.rejects(db.query("select public.transition_payout($1,$2,'mark-paid','UTR-TEST-001')",[admin,batch]),/invalid_transition/);
  await db.query("select public.transition_payout($1,$2,'approve')",[admin,batch]);
  await assert.rejects(db.query("select public.transition_payout($1,$2,'mark-paid')",[admin,batch]),/invalid_transition/);
  // KYC revoked between approval and payment: money must not be marked as sent.
  await db.query("update public.worker_kyc set status='rejected' where user_id=$1",[worker]);
  await assert.rejects(db.query("select public.transition_payout($1,$2,'mark-paid','UTR-TEST-001')",[admin,batch]),/kyc_required/);
  assert.equal(await scalar<string>('select status as value from public.payout_batches where id=$1',[batch]),'Processing');
  await db.query("update public.worker_kyc set status='approved' where user_id=$1",[worker]);
  await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-TEST-001')",[admin,batch]);
  await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-TEST-001')",[admin,batch]);
  assert.equal(await scalar<string>('select status as value from public.payout_items where batch_id=$1',[batch]),'Paid');
  await assert.rejects(db.query("select public.transition_payout($1,$2,'reject','test')",[admin,batch]),/invalid_transition/);
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/minimum_amount/);
  await db.query("select public.save_upi_config($1,'changed@bank','Weekly','Fri')",[worker]);
  assert.equal(await scalar<boolean>('select verified as value from public.upi_configs where worker_id=$1',[worker]),false);
});

test('payout, wallet, UPI and KYC changes signal only the owner, without row contents', async () => {
  await db.exec('truncate realtime.messages');
  await db.query("update public.worker_kyc set status='pending' where user_id=$1",[worker]);
  await db.query("update public.worker_kyc set status='approved' where user_id=$1",[worker]);
  await db.query("update public.upi_configs set payout_day='Mon' where worker_id=$1",[worker]);
  await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-LIVE',$1,'Live',10,'Approved')",[worker]);
  // Edits that don't touch status or reward don't signal.
  await db.query("update public.work_items set title='Live (renamed)' where public_id='WI-LIVE'");
  const messages = await db.query<{ topic: string; private: boolean; payload: Record<string, unknown> }>("select topic,private,payload from realtime.messages where topic like 'payouts:%'");
  assert.equal(messages.rows.length, 4);
  for (const message of messages.rows) {
    assert.equal(message.topic, `payouts:${worker}`);
    assert.equal(message.private, true);
    assert.deepEqual(Object.keys(message.payload).sort(), ['changedAt', 'kind']);
  }
  await db.query("delete from public.work_items where public_id='WI-LIVE'");
});

test('admin consoles get one content-free signal per change on the private admin topic', async () => {
  await db.exec('truncate realtime.messages');
  await db.query("update public.upi_configs set payout_day='Tue' where worker_id=$1",[worker]);
  await db.query("update public.worker_kyc set status='approved' where user_id=$1",[worker]);
  const rows = await db.query<{ private: boolean; payload: Record<string, unknown> }>("select private,payload from realtime.messages where topic='admin:live' order by payload->>'changedAt'");
  assert.deepEqual(rows.rows.map((r) => r.payload.kind), ['upi_configs', 'worker_kyc']);
  for (const row of rows.rows) {
    assert.equal(row.private, true);
    assert.deepEqual(Object.keys(row.payload).sort(), ['changedAt', 'kind', 'op']);
  }
  // Browsers can ask "am I an admin?" for themselves only, and never call the underlying check directly.
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.realtime_is_admin()','execute') as value"), true);
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.app_is_admin(uuid)','execute') as value"), false);
});

test('profile and assignment changes signal only the owner on the account topic', async () => {
  await db.exec("insert into public.accounts(id,handle) values('acct-live','@acctlive') on conflict do nothing");
  await db.exec('truncate realtime.messages');
  await db.query("update public.profiles set headline='Food reels', bio='Hi' where id=$1",[worker]);
  // Columns the account card doesn't show stay quiet.
  await db.query("update public.profiles set email=email where id=$1",[worker]);
  await db.query("insert into public.assignments(worker_id,account_id) values($1,'acct-live')",[worker]);
  await db.query("delete from public.assignments where worker_id=$1 and account_id='acct-live'",[worker]);
  await db.exec("delete from public.accounts where id='acct-live'");
  const rows = await db.query<{ topic: string; private: boolean; payload: Record<string, unknown> }>("select topic,private,payload from realtime.messages where topic like 'account:%'");
  assert.deepEqual(rows.rows.map((r) => r.payload.kind), ['profiles', 'assignments', 'assignments']);
  for (const row of rows.rows) {
    assert.equal(row.topic, `account:${worker}`);
    assert.equal(row.private, true);
    assert.deepEqual(Object.keys(row.payload).sort(), ['changedAt', 'kind']);
  }
});

test('email creator gigs start without approval or KYC; other gig types still require both', async () => {
  const emails = (prefix: string) => JSON.stringify([1, 2, 3, 4, 5].map((n) => `${prefix}${n}@fasterdrop.site`));
  await db.exec('truncate realtime.messages');
  await db.query("insert into public.gigs(id,title,company,workload,payout,gig_type,status) values('ec-open','Create accounts','Test','5','100','Email Creator','Open'),('proj-gated','Project','Test','1','100','Project','Open')");
  // "other" has no application and no KYC.
  assert.equal(await scalar<string>("select status as value from public.worker_kyc where user_id=$1", [other]), undefined);
  const started = await scalar<{ id: string; gig_id: string }>('select public.create_gig_assignment($1,$1,$2,$3::jsonb) as value', [other, 'ec-open', emails('ec')]);
  assert.equal(started.gig_id, 'ec-open');
  const code = await scalar<string>('select worker_code as value from public.profiles where id=$1', [other]);
  assert.equal(await scalar<string>("select status as value from public.gig_applications where gig_id='ec-open' and worker_code=$1", [code]), 'Accepted', 'starting records an accepted application');
  // The admin consoles hear about the new application and assignment right away.
  const kinds = await db.query<{ kind: string }>("select payload->>'kind' as kind from realtime.messages where topic='admin:live'");
  assert.ok(kinds.rows.some((r) => r.kind === 'gig_applications') && kinds.rows.some((r) => r.kind === 'gig_assignments'), 'admin live signals for gig work');
  // Retrying returns the same assignment.
  const again = await scalar<{ id: string }>('select public.create_gig_assignment($1,$1,$2,$3::jsonb) as value', [other, 'ec-open', emails('ecb')]);
  assert.equal(again.id, started.id);
  // Other gig types keep the approval gate.
  await assert.rejects(db.query('select public.create_gig_assignment($1,$1,$2,$3::jsonb)', [other, 'proj-gated', emails('pg')]), /forbidden/);
  // Someone else can never start work on another creator's behalf.
  await assert.rejects(db.query('select public.create_gig_assignment($1,$2,$3,$4::jsonb)', [worker, other, 'ec-open', emails('x')]), /forbidden/);
});

test('invalid credentials never delete the previously saved set', async () => {
  const code=await scalar<string>('select worker_code as value from public.profiles where id=$1',[worker]);
  await db.exec("insert into public.gigs(id,title,company,workload,payout) values('test','Test','Test','5','1000')");
  const emails=Array.from({length:5},(_,i)=>'account'+i+'@example.test');
  const assignment=await scalar<string>("insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails) values('test',$1,$2,$3) returning id as value",[code,emails[0],JSON.stringify(emails)]);
  const accounts=emails.map(email=>({email,handle:'test',password:'enc:v1:test'}));
  await db.query('select public.submit_gig_credentials($1,$2,$3)',[worker,assignment,JSON.stringify(accounts)]);
  await assert.rejects(db.query('select public.submit_gig_credentials($1,$2,$3)',[other,assignment,JSON.stringify(accounts)]),/not_found/);
  await assert.rejects(db.query('select public.submit_gig_credentials($1,$2,$3)',[worker,assignment,JSON.stringify(accounts.slice(0,4))]),/invalid_accounts/);
  assert.equal(await scalar<number>('select count(*)::int as value from public.gig_account_credentials where assignment_id=$1',[assignment]),5);
});

test('shared rate limit expires and code quotas cannot oversubscribe', async () => {
  assert.equal(await scalar<boolean>("select public.consume_api_rate_limit('test',1,60) as value"),true);
  assert.equal(await scalar<boolean>("select public.consume_api_rate_limit('test',1,60) as value"),false);
  await db.exec("update public.api_rate_limits set expires_at=now()-interval '1 second'");
  assert.equal(await scalar<boolean>("select public.consume_api_rate_limit('test',1,60) as value"),true);
  await db.exec("insert into public.work_email_secret_codes(code_hash,code_hint,max_uses) values('hash','hint',1)");
  const account={email:'quota@example.test',local_part:'quota',domain:'example.test',username:'quota',social_password:'enc:v1:test',platform:'test'};
  await db.query("select public.create_work_email_account($1,'hash',$2)",[worker,JSON.stringify(account)]);
  await assert.rejects(db.query("select public.create_work_email_account($1,'hash',$2)",[worker,JSON.stringify({...account,email:'quota2@example.test'})]),/invalid_code/);
  assert.equal(await scalar<number>("select use_count as value from public.work_email_secret_codes where code_hash='hash'"),1);
});

test('credential approval credits exactly once and cannot retract released earnings', async () => {
  const id = await scalar<string>("select id as value from public.gig_assignments where gig_id='test'");
  await db.query("select public.review_gig_assignment($1,$2,'Accepted',false)",[admin,id]);
  const creditId = await scalar<string>("select public_id as value from public.work_items where review->>'source'='gig_assignment_approval'");
  await assert.rejects(db.query("select public.transition_work_item($1,$2,'review','{\"status\":\"Approved\"}')",[admin,creditId]),/invalid_transition/);
  await db.query("select public.review_gig_assignment($1,$2,'Accepted',true)",[admin,id]);
  await db.query("select public.review_gig_assignment($1,$2,'Accepted',true)",[admin,id]);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where review->>'source'='gig_assignment_approval'"),1);
  assert.equal(Number(await scalar<string>("select reward_inr as value from public.work_items where review->>'source'='gig_assignment_approval'")),1000);
  await assert.rejects(db.query("select public.review_gig_assignment($1,$2,'Rejected',false)",[admin,id]),/invalid_transition/);
  const metrics = await scalar<{money:{earnings:number}}>('select public.worker_metrics($1) as value',[worker]);
  assert.equal(metrics.money.earnings,2200);
});

test('scheduling is repeatable, keeps all assignment tables consistent and preserves completed work', async () => {
  await db.exec("insert into public.accounts(id,handle) values('scheduled','@scheduled')");
  const schedule=JSON.stringify({times:['08:00','18:00'],days:[0,1,2,3,4,5,6],deadlineMin:180,timezone:'Asia/Kolkata'});
  await db.query("select public.schedule_account_work($1,$2,'scheduled',$3,false,true)",[admin,worker,schedule]);
  await db.query("select public.schedule_account_work($1,$2,'scheduled',$3,false,true)",[admin,worker,schedule]);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where account_id='scheduled'"),2);
  for(const table of ['assignments','worker_account_assignments','worker_accounts']) {
    assert.equal(await scalar<number>('select count(*)::int as value from public.'+table+" where account_id='scheduled' and worker_id=$1",[worker]),1);
  }
  await db.exec("update public.work_items set status='Approved' where account_id='scheduled'");
  await db.query("select public.schedule_account_work($1,$2,'scheduled',$3,true,true)",[admin,other,schedule]);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where account_id='scheduled' and status='Approved' and worker_id=$1",[worker]),2);
  await db.query('select public.refresh_scheduled_work()');
});

test('database roles cannot bypass row ownership or call money functions', async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[worker]);
  await db.exec('set role authenticated');
  try {
    const profiles=await db.query<{id:string}>('select id from public.profiles');
    assert.deepEqual(profiles.rows.map(row=>row.id),[worker]);
    await assert.rejects(db.query('select * from public.gig_account_credentials'),/permission denied/);
    await assert.rejects(db.query('select public.request_payout($1)',[worker]),/permission denied/);
  } finally { await db.exec('reset role'); }
});

test('unassign is atomic across assignment tables and account deletion preserves history', async () => {
  await assert.rejects(db.query("select public.delete_unused_account($1,'scheduled')",[admin]),/history_exists/);
  assert.equal(await scalar<number>("select count(*)::int as value from public.assignments where account_id='scheduled'"),1);
  await db.query("select public.unassign_account($1,$2,'scheduled')",[admin,other]);
  for (const table of ['assignments','worker_account_assignments','worker_accounts']) {
    assert.equal(await scalar<number>('select count(*)::int as value from public.'+table+" where account_id='scheduled'"),0);
  }
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where account_id='scheduled' and status='Approved'"),2);
  await db.exec("insert into public.accounts(id,handle) values('unused','@unused')");
  await db.query("select public.delete_unused_account($1,'unused')",[admin]);
  assert.equal(await scalar<number>("select count(*)::int as value from public.accounts where id='unused'"),0);
});

test('worker provisioning checks the owner and rolls back conflicting worker codes', async () => {
  const id='55555555-5555-4555-8555-555555555555';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'new@example.test',now())",[id]);
  await assert.rejects(db.query("select public.provision_worker($1,$2,'NEW-WORKER','New','new@example.test',true)",[worker,id]),/forbidden/);
  await db.query("select public.provision_worker($1,$2,'NEW-WORKER','New','new@example.test',true)",[admin,id]);
  assert.equal(await scalar<string>('select worker_code as value from public.profiles where id=$1',[id]),'NEW-WORKER');
  const duplicate='66666666-6666-4666-8666-666666666666';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'duplicate@example.test',now())",[duplicate]);
  await assert.rejects(db.query("select public.provision_worker($1,$2,'NEW-WORKER','Duplicate','duplicate@example.test',true)",[admin,duplicate]),/unique/);
  assert.equal(await scalar<number>('select count(*)::int as value from public.profiles where id=$1',[duplicate]),0);
});

test('application updates detect stale decisions and assignment retries preserve reviewed state', async () => {
  await db.exec("insert into public.gigs(id,title,company,workload,payout,gig_type) values('proposal','Role','Team','1','1000','Content Creator')");
  const application=await scalar<{id:string;status:string;worker_name:string}>("select public.submit_gig_application($1,$1,'proposal','name') as value",[worker]);
  assert.equal(application.status,'Pending');
  await db.query("select public.update_gig_application($1,$2,$3,'reviewed','Accepted')",[admin,application.id,JSON.stringify(application)]);
  await assert.rejects(db.query("select public.update_gig_application($1,$2,$3,'stale','Pending')",[worker,application.id,JSON.stringify(application)]),/invalid_transition/);
  await assert.rejects(db.query("select public.submit_gig_application($1,$1,'proposal','overwrite')",[worker]),/invalid_transition/);
  const emails=Array.from({length:5},(_,i)=>`proposal${i}@example.test`);
  const assignment=await scalar<{id:string}>("select public.create_gig_assignment($1,$1,'proposal',$2) as value",[worker,JSON.stringify(emails)]);
  await db.query("update public.gig_assignments set status='Submitted',submitted_at=now() where id=$1",[assignment.id]);
  const retried=await scalar<{id:string;status:string}>("select public.create_gig_assignment($1,$1,'proposal',$2) as value",[worker,JSON.stringify(emails)]);
  assert.equal(retried.id,assignment.id);
  assert.equal(retried.status,'Submitted');
});

test('inbox addresses cannot be claimed across workers or reused after deletion', async () => {
  const code=await scalar<string>('select worker_code as value from public.profiles where id=$1',[other]);
  await db.exec("insert into public.gigs(id,title,company,workload,payout) values('collision','Collision','Team','5','1000')");
  await assert.rejects(db.query("insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails) values('collision',$1,'unique@example.test','[\"proposal1@example.test\"]')",[code]),/reserved/);
  await assert.rejects(db.query("insert into public.work_email_accounts(owner_user_id,email,local_part,domain,username) values($1,'proposal2@example.test','proposal2','example.test','test')",[other]),/reserved/);
  const account=await scalar<string>("insert into public.work_email_accounts(owner_user_id,email,local_part,domain,username) values($1,'tombstone@example.test','tombstone','example.test','test') returning id as value",[worker]);
  await db.query('delete from public.work_email_accounts where id=$1',[account]);
  await assert.rejects(db.query("insert into public.work_email_accounts(owner_user_id,email,local_part,domain,username) values($1,'tombstone@example.test','tombstone','example.test','test')",[other]),/reserved/);
});

test('KYC requires existing private uploads and rejects stale reviews and approved resubmission', async () => {
  const details={ legal_name:'Other',dob:'1990-01-01',phone:'1234567890',address:'Test address',id_type:'ID',id_number:'123',id_doc_path:`kyc/${other}/id_doc-test.pdf`,selfie_path:`kyc/${other}/selfie-test.png` };
  await assert.rejects(db.query('select public.submit_worker_kyc($1,$2)',[other,JSON.stringify(details)]),/documents_required/);
  for(const name of [details.id_doc_path,details.selfie_path]) await db.query("insert into storage.objects(bucket_id,name) values('kyc',$1)",[name]);
  const kyc=await scalar<{id:string;submitted_at:string}>('select public.submit_worker_kyc($1,$2) as value',[other,JSON.stringify(details)]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.worker_kyc_events where kyc_id=$1',[kyc.id]),1);
  await assert.rejects(db.query("select public.review_worker_kyc($1,$2,'2000-01-01','approved')",[admin,kyc.id]),/invalid_transition/);
  await db.query("select public.review_worker_kyc($1,$2,$3,'approved')",[admin,kyc.id,kyc.submitted_at]);
  await assert.rejects(db.query('select public.submit_worker_kyc($1,$2)',[other,JSON.stringify(details)]),/invalid_transition/);
  assert.equal(await scalar<string>('select status as value from public.worker_kyc where id=$1',[kyc.id]),'approved');
});

test('cleanup only prunes excess future scheduled work and never manually created or completed work', async () => {
  for(let n=0;n<3;n++) await db.query("insert into public.work_items(public_id,worker_id,account_id,title,due_at) values($1,$2,'scheduled','Auto',now()+interval '1 day')",['SCH-EXTRA-'+n,worker]);
  await db.query("insert into public.work_items(public_id,worker_id,account_id,title,due_at) values('MANUAL-SAFE',$1,'scheduled','Manual',now()+interval '1 day')",[worker]);
  const result=await scalar<{deleted:number}>('select public.cleanup_scheduled_work($1) as value',[admin]);
  assert.equal(result.deleted,1);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where account_id='scheduled' and status='Approved'"),2);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where public_id='MANUAL-SAFE'"),1);
  await assert.rejects(db.query('select public.prepare_worker_deletion($1,$2)',[admin,worker]),/worker_history_exists/);
  assert.equal(await scalar<boolean>('select active as value from public.profiles where id=$1',[worker]),true);
  const unused='55555555-5555-4555-8555-555555555555';
  await db.query('select public.prepare_worker_deletion($1,$2)',[admin,unused]);
  await db.query('delete from auth.users where id=$1',[unused]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.workers where user_id=$1',[unused]),0);
});

test('admin ownership requires explicit enrollment and rotates without retaining former privileges', async () => {
  const replacement='88888888-8888-4888-8888-888888888888';
  const unconfirmed='99999999-9999-4999-8999-999999999999';
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'next-operator@example.test',now(),'{\"role\":\"Admin\"}')",[replacement]);
  await db.query('select public.bootstrap_worker($1)',[replacement]);
  assert.equal(await scalar<boolean>('select public.app_is_admin($1) as value',[replacement]),false);
  await db.query("insert into auth.users(id,email) values($1,'unconfirmed@example.test')",[unconfirmed]);
  await assert.rejects(db.query("select public.configure_admin_owner($1,'unconfirmed@example.test','Admin',$2)",[unconfirmed,admin]),/forbidden/);
  assert.equal(await scalar<boolean>('select public.app_is_admin($1) as value',[admin]),true);
  assert.equal(await scalar<boolean>("select has_table_privilege('authenticated','public.admin_owner','select') as value"),false);
  assert.equal(await scalar<boolean>("select has_table_privilege('service_role','public.admin_owner','select') as value"),true);
  for (const privilege of ['insert','update','delete','truncate']) {
    assert.equal(await scalar<boolean>("select has_table_privilege('service_role','public.admin_owner',$1) as value",[privilege]),false);
  }
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.configure_admin_owner(uuid,text,text,uuid)','execute') as value"),false);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query("select public.configure_admin_owner($1,'next-operator@example.test','Owner',$2)",[replacement,admin]),/permission denied/);
  } finally { await db.exec('reset role'); }
  await db.query("select public.configure_admin_owner($1,'  Next-Operator@Example.test  ','New Owner',$2)",[replacement,admin]);
  assert.equal(await scalar<boolean>('select public.app_is_admin($1) as value',[replacement]),true);
  assert.equal(await scalar<boolean>('select public.app_is_admin($1) as value',[admin]),false);
  assert.equal(await scalar<string>('select role as value from public.profiles where id=$1',[admin]),'Worker');
  await assert.rejects(db.query("select public.configure_admin_owner($1,'operator@example.test','Stale owner',$1)",[admin]),/configuration_changed/);
  await db.query("select public.configure_admin_owner($1,'next-operator@example.test','New Owner',$1)",[replacement]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.admin_owner'),1);
  await db.query("update auth.users set email='changed@example.test' where id=$1",[replacement]);
  assert.equal(await scalar<boolean>('select public.app_is_admin($1) as value',[replacement]),false);
  assert.equal(await scalar<boolean>("select public.admin_configuration_ready('next-operator@example.test') as value"),false);
});

test('view claims freeze evidence, reserve growth once, support review decisions and credit the withdrawal ledger', async () => {
  const currentOwner = await scalar<string>('select user_id as value from public.admin_owner');
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',$2)", [admin, currentOwner]);
  await db.exec("insert into public.gigs(id,title,company,workload,payout,payout_type) values('views-gig','Views','Test','Reels','₹100','Per 1k Views')");
  const code = await scalar<string>('select worker_code as value from public.profiles where id=$1', [worker]);
  const application = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values('views-gig',$1,'Accepted') returning id as value", [code]);
  const account = await scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle) values($1,'views-gig',$2,'Instagram','viewcreator') returning id as value", [application, code]);
  const post = await scalar<string>("insert into public.social_account_posts(account_id,url,status,views,source) values($1,'https://www.instagram.com/reel/VIEW1/','approved',1500,'profile') returning id as value", [account]);
  await db.query("insert into public.social_account_posts(account_id,url,status,views) values($1,'https://www.instagram.com/reel/MISSING/','approved',null),($1,'https://www.instagram.com/reel/PENDING/','submitted',9000),($1,'https://www.instagram.com/reel/REJECTED/','rejected',25000)", [account]);
  const quote = () => scalar<{ claimableINR: number; claimableViews: number; missingCounts: number }>('select public.view_payout_quote($1,$2) as value', [worker, account]);
  const submit = () => scalar<{ id: string; amount_inr: number }>('select public.submit_view_payout_claim($1,$2) as value', [worker, account]);
  const review = (id: string, decision: string, note = '') => scalar<{ work_item_id: string }>('select public.review_view_payout_claim_authenticity($1,$2,$3,$4,$5,$6) as value', [admin, id, decision, decision === 'Approved' ? note || 'Reviewed frozen evidence' : note, decision === 'Approved' ? 'organic' : 'insufficient', []]);
  assert.equal((await quote()).claimableINR, 150);
  assert.equal((await quote()).missingCounts, 1);
  await assert.rejects(db.query('select public.submit_view_payout_claim($1,$2)', [other, account]), /not_found/);
  await assert.rejects(db.query('select public.submit_view_payout_claim($1,$2)', [admin, account]), /not_found/);
  await db.query("update public.social_account_posts set views_captured_at='2026-10-08T05:00:00Z', views_source='screenshot',updated_at='2026-10-08T06:00:00Z' where id=$1",[post]);
  const [first, duplicate] = await Promise.all([submit(), submit()]);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.amount_inr, 150);
  assert.equal(await scalar<string>('select source as value from public.view_payout_claim_items where claim_id=$1',[first.id]),'screenshot');
  assert.equal(await scalar<string>("select to_char(captured_at at time zone 'UTC','YYYY-MM-DD HH24:MI') as value from public.view_payout_claim_items where claim_id=$1",[first.id]),'2026-10-08 05:00');
  assert.equal((await quote()).claimableINR, 0);
  await db.query("update public.gigs set payout='₹200' where id='views-gig'");
  await db.query('update public.social_account_posts set views=1800 where id=$1', [post]);
  await assert.rejects(db.query("select public.review_view_payout_claim($1,$2,'Approved','')", [worker, first.id]), /forbidden/);
  const credit = await review(first.id, 'Approved');
  await review(first.id, 'Approved');
  assert.equal(Number(await scalar<string>('select reward_inr as value from public.work_items where id=$1', [credit.work_item_id])), 150);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where review->>'claimId'=$1", [first.id]), 1);
  assert.equal((await quote()).claimableINR, 60);
  const soft = await submit();
  await assert.rejects(review(soft.id, 'Rejected'), /claim_review_reason_required/);
  await review(soft.id, 'Rejected', 'Correct the evidence');
  assert.equal((await quote()).claimableINR, 60);
  const hard = await submit();
  await review(hard.id, 'Hard rejected', 'This view growth is ineligible');
  assert.equal((await quote()).claimableINR, 0);
  await assert.rejects(review(hard.id, 'Approved'), /invalid_transition/);
  await db.query('update public.social_account_posts set views=2000 where id=$1', [post]);
  assert.equal((await quote()).claimableINR, 40);
  const growth = await submit();
  await db.query('update public.social_account_posts set views=1999 where id=$1', [post]);
  await assert.rejects(review(growth.id, 'Approved'), /claim_evidence_changed/);
  await db.query('update public.social_account_posts set views=2000 where id=$1', [post]);
  await review(growth.id, 'Approved');
  await db.query('update public.social_account_posts set views=10000 where id=$1', [post]);
  const final = await submit();
  assert.equal(final.amount_inr, 1600);
  await review(final.id, 'Approved');
  await db.query("select public.verify_upi_config($1,$2,'changed@bank',true)", [admin, worker]);
  const activeBatches = await db.query<{ id: string }>("select id from public.payout_batches where worker_id=$1 and status in ('Draft','Processing')", [worker]);
  for (const row of activeBatches.rows) await db.query("select public.transition_payout($1,$2,'reject','Finish prior test fixture')", [admin, row.id]);
  const withdrawal = await scalar<{ batchId: string }>('select public.request_payout($1) as value', [worker]);
  assert.equal(Number(await scalar<string>("select sum(i.amount_inr) as value from public.payout_items i join public.work_items w on w.id=i.work_item_id where i.batch_id=$1 and w.review->>'source'='view_payout_claim'", [withdrawal.batchId])), 1790);
  assert.equal(await scalar<number>("select count(*)::int as value from public.payout_items i join public.work_items w on w.id=i.work_item_id where i.batch_id=$1 and w.review->>'source'='view_payout_claim'", [withdrawal.batchId]), 3);
  await assert.rejects(db.query('select public.submit_view_payout_claim($1,$2)', [worker, account]), /no_claimable_views/);
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.submit_view_payout_claim(uuid,uuid)','execute') as value"), false);
  assert.equal(await scalar<boolean>("select has_table_privilege('authenticated','public.view_payout_claims','select') as value"), false);
});

test('authenticity deductions are bounded, audited, immutable and permanently excluded from future claims', async () => {
  await db.exec("insert into public.gigs(id,title,company,workload,payout,payout_type) values('authenticity-gig','Authenticity','Test','Reels','₹49','Per 1k Views')");
  const code=await scalar<string>('select worker_code as value from public.profiles where id=$1',[worker]);
  const application=await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values('authenticity-gig',$1,'Accepted') returning id as value",[code]);
  const account=await scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle) values($1,'authenticity-gig',$2,'Instagram','authenticcreator') returning id as value",[application,code]);
  const a=await scalar<string>("insert into public.social_account_posts(account_id,url,status,views,source,views_captured_at) values($1,'https://www.instagram.com/reel/AUTH1/','approved',1500,'profile','2026-10-08T08:00:00Z') returning id as value",[account]);
  const b=await scalar<string>("insert into public.social_account_posts(account_id,url,status,views,source) values($1,'https://www.instagram.com/reel/AUTH2/','approved',750,'profile') returning id as value",[account]);
  const submit=()=>scalar<{id:string;amount_inr:number}>('select public.submit_view_payout_claim($1,$2) as value',[worker,account]);
  const q=()=>scalar<{claimableViews:number;claimableINR:number}>('select public.view_payout_quote($1,$2) as value',[worker,account]);
  const c=await submit();
  assert.equal(c.amount_inr,110.25);
  const items=await db.query<{id:string;post_id:string}>('select id,post_id from public.view_payout_claim_items where claim_id=$1',[c.id]);
  const ia=items.rows.find(p=>p.post_id===a)!.id, ib=items.rows.find(p=>p.post_id===b)!.id;
  const review=(adjustments:unknown[],assessment='mixed',decision='Approved',actor=admin,note='Reviewed account insights and excluded artificial traffic')=>scalar<{id:string;approved_amount_inr:number;approved_views:number;deducted_views:number;work_item_id:string}>('select public.review_view_payout_claim_authenticity($1,$2,$3,$4,$5,$6) as value',[actor,c.id,decision,note,assessment,adjustments]);
  const change={itemId:ia,excludedViews:500,reason:'Creator insights show repeated artificial traffic',evidenceUrl:'https://example.test/review-evidence'};
  await assert.rejects(review([change],'mixed','Approved',worker),/forbidden/);
  await assert.rejects(db.query("select public.review_view_payout_claim($1,$2,'Approved','Legacy bypass')",[admin,c.id]),/claim_authenticity_required/);
  await assert.rejects(review([change,change]),/invalid_view_adjustment/);
  await assert.rejects(review([{...change,itemId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]),/invalid_view_adjustment/);
  for(const excludedViews of [-1,0.5,1501]) await assert.rejects(review([{...change,excludedViews}]),/invalid_view_adjustment/);
  await assert.rejects(review([{...change,reason:''}]),/claim_deduction_reason_required/);
  await assert.rejects(review([{...change,evidenceUrl:'javascript:alert(1)'}]),/invalid_view_adjustment/);
  await assert.rejects(review([change],'organic'),/claim_authenticity_required/);
  await assert.rejects(review([], 'mixed'),/claim_authenticity_required/);
  await assert.rejects(review([change],'mixed','Approved',admin,''),/claim_review_reason_required/);
  await assert.rejects(review([{...change,excludedViews:1500},{itemId:ib,excludedViews:750,reason:'Entire range is artificial'}]),/claim_no_eligible_views/);
  assert.equal(Number(await scalar<string>('select sum(excluded_views) as value from public.view_payout_claim_items where claim_id=$1',[c.id])),0,'failed reviews roll back all adjustments');
  const state=await scalar<string>('select status as value from public.view_payout_claims where id=$1',[c.id]);
  assert.equal(state,'Pending');
  await db.exec("update public.gigs set payout='₹99' where id='authenticity-gig'");
  const adjustments=[{...change,approvedAmount:0.01},{itemId:ib,excludedViews:50,reason:'Supporting insights identify artificial views'}];
  const [credit,retry]=await Promise.all([review(adjustments),review(adjustments)]);
  assert.equal(credit.work_item_id,retry.work_item_id);
  assert.equal(credit.approved_amount_inr,83.3);
  assert.equal(credit.approved_views,1700);
  assert.equal(credit.deducted_views,550);
  assert.equal(Number(await scalar<string>('select reward_inr as value from public.work_items where id=$1',[credit.work_item_id])),83.3);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items where review->>'claimId'=$1",[c.id]),1);
  assert.equal(await scalar<number>('select views as value from public.social_account_posts where id=$1',[a]),1500,'raw Instagram views stay intact');
  assert.equal((await q()).claimableViews,0,'excluded views cannot be reclaimed');
  const audit=await scalar<{approvedINR:number;excludedViews:number;evidence:{reason:string}[]}>('select details as value from public.audit_events where resource_id=$1 and action=$2',[c.id,'view_claim_authenticity_reviewed']);
  assert.equal(audit.approvedINR,83.3);assert.equal(audit.excludedViews,550);assert.equal(audit.evidence.length,2);
  await assert.rejects(review([], 'insufficient', 'Rejected'),/invalid_transition/);
  assert.equal((await review([{...change,excludedViews:700}])).approved_amount_inr,83.3,'retry never changes a decided credit');
  assert.equal(await scalar<number>('select count(*)::int as value from public.social_post_measurements where post_id=$1',[a]),1);
  await db.query('update public.social_account_posts set likes=25,updated_at=now() where id=$1',[a]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.social_post_measurements where post_id=$1',[a]),1,'likes updates do not create fresh view history');
  await db.query('update public.social_account_posts set views=1600 where id=$1',[a]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.social_post_measurements where post_id=$1',[a]),2);
  assert.equal((await q()).claimableViews,100);assert.equal((await q()).claimableINR,9.9);
  const hard=await submit();
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Hard rejected','Covered growth is artificial','suspected','[]'::jsonb)",[admin,hard.id]);
  assert.equal(Number(await scalar<string>('select deducted_views as value from public.view_payout_claims where id=$1',[hard.id])),100);
  assert.equal((await q()).claimableViews,0);
  for(const resource of ['social_post_measurements','view_payout_claim_items']) assert.equal(await scalar<boolean>(`select has_table_privilege('authenticated','public.${resource}','select') as value`),false);
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.review_view_payout_claim_authenticity(uuid,uuid,text,text,text,jsonb)','execute') as value"),false);
});
