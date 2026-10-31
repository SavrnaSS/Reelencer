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
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/upi_required/);
  await db.query("select public.save_upi_config($1,'worker@bank','Weekly','Fri')",[worker]);
  assert.equal(await scalar<boolean>('select verified as value from public.upi_configs where worker_id=$1',[worker]),false);
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/upi_required/);
  await assert.rejects(db.query("select public.verify_upi_config($1,$1,'worker@bank',true)",[worker]),/forbidden/);
  await db.query("select public.verify_upi_config($1,$2,'worker@bank',true)",[admin,worker]);
  // The only credit is INR 1,200, over the KYC-free limit: nothing can be withdrawn until KYC is approved.
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/kyc_required/);
  assert.equal(await scalar<number>('select count(*)::int as value from public.payout_batches where worker_id=$1',[worker]),0);
  await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test','1990-01-01','123','Test','ID','123','test','test')",[worker]);
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
  // Manual withdrawals are limited to one every 7 days.
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/weekly_limit/);
  await db.query("update public.payout_batches set created_at=created_at-interval '8 days' where worker_id=$1",[worker]);
  await assert.rejects(db.query('select public.request_payout($1)',[worker]),/minimum_amount/);
  await db.query("select public.save_upi_config($1,'changed@bank','Weekly','Fri')",[worker]);
  assert.equal(await scalar<boolean>('select verified as value from public.upi_configs where worker_id=$1',[worker]),false);
});

test('without KYC payouts work until the wallet has received INR 1,000, then every payout waits for KYC', async () => {
  await db.exec('begin');
  try {
    const owner = '66666666-6666-4666-8666-666666666666';
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'nokyc@example.test',now())", [owner]);
    await db.query('select public.bootstrap_worker($1)', [owner]);
    await db.query("select public.save_upi_config($1,'nokyc@bank','Monthly','1')", [owner]);
    await db.query("select public.verify_upi_config($1,$2,'nokyc@bank',true)", [admin, owner]);
    const credit = (code: string, amount: number) => db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values($1,$2,'Credit',$3,'Approved')", [code, owner, amount]);
    const tryRequest = async (pattern: RegExp) => {
      await db.exec('savepoint attempt');
      await assert.rejects(db.query('select public.request_payout($1)', [owner]), pattern);
      await db.exec('rollback to savepoint attempt');
    };
    // Exactly INR 1,000 in total: no KYC needed, and the whole balance is withdrawn and paid.
    await credit('WI-NOKYC-1', 400);
    await credit('WI-NOKYC-2', 600);
    const first = await scalar<{ batchId: string; amount: number }>('select public.request_payout($1) as value', [owner]);
    assert.equal(Number(first.amount), 1000);
    await db.query("select public.transition_payout($1,$2,'approve')", [admin, first.batchId]);
    await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-NOKYC')", [admin, first.batchId]);
    // One more credit takes the lifetime total past INR 1,000: the new INR 500 is blocked, even though the balance is small.
    await credit('WI-NOKYC-3', 500);
    await db.query("update public.payout_batches set created_at=created_at-interval '8 days' where worker_id=$1", [owner]);
    await tryRequest(/kyc_required/);
    assert.equal(await scalar<boolean>('select public.payout_kyc_required($1) as value', [owner]), true);
    // The monthly auto-withdrawal is blocked the same way.
    await db.query("select public.set_auto_withdrawal($1,true,1)", [owner]);
    await db.query("update public.upi_configs set auto_withdraw_since=date_trunc('month',now())-interval '1 day' where worker_id=$1", [owner]);
    await scalar('select public.auto_request_payouts(1000) as value');
    assert.equal(await scalar<number>("select count(*)::int as value from public.payout_batches where worker_id=$1 and origin='auto'", [owner]), 0);
    // A rejected KYC doesn't count; an approved one releases every payout.
    await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'rejected','Test','1990-01-01','123','Test','ID','123','test','test')", [owner]);
    await tryRequest(/kyc_required/);
    await db.query("update public.worker_kyc set status='approved' where user_id=$1", [owner]);
    assert.equal(await scalar<boolean>('select public.payout_kyc_required($1) as value', [owner]), false);
    const released = await scalar<{ amount: number }>('select public.request_payout($1) as value', [owner]);
    assert.equal(Number(released.amount), 500);
  } finally {
    await db.exec('rollback');
  }
});

test('a payout opened before the wallet passed INR 1,000 cannot be approved or paid until KYC is approved', async () => {
  await db.exec('begin');
  try {
    const owner = '77777777-7777-4777-8777-777777777777';
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'limit@example.test',now())", [owner]);
    await db.query('select public.bootstrap_worker($1)', [owner]);
    await db.query("select public.save_upi_config($1,'limit@bank','Monthly','1')", [owner]);
    await db.query("select public.verify_upi_config($1,$2,'limit@bank',true)", [admin, owner]);
    await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-LIMIT-1',$1,'Credit',300,'Approved'),('WI-LIMIT-2',$1,'Credit',300,'Approved')", [owner]);
    const open = await scalar<{ batchId: string; amount: number }>('select public.request_payout($1) as value', [owner]);
    assert.equal(Number(open.amount), 600);
    await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-LIMIT-3',$1,'Credit',500,'Approved')", [owner]);
    await db.exec('savepoint approve');
    await assert.rejects(db.query("select public.transition_payout($1,$2,'approve')", [admin, open.batchId]), /kyc_required/);
    await db.exec('rollback to savepoint approve');
    // The team can still reject it; approving KYC lets it through.
    await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test','1990-01-01','123','Test','ID','123','test','test')", [owner]);
    await db.query("select public.transition_payout($1,$2,'approve')", [admin, open.batchId]);
    // KYC revoked between approval and payment: the money isn't sent.
    await db.query("update public.worker_kyc set status='rejected' where user_id=$1", [owner]);
    await db.exec('savepoint pay');
    await assert.rejects(db.query("select public.transition_payout($1,$2,'mark-paid','UTR-LIMIT')", [admin, open.batchId]), /kyc_required/);
    await db.exec('rollback to savepoint pay');
    await db.query("update public.worker_kyc set status='approved' where user_id=$1", [owner]);
    await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-LIMIT')", [admin, open.batchId]);
    assert.equal(await scalar<string>('select status as value from public.payout_batches where id=$1', [open.batchId]), 'Paid');
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.payout_kyc_required(uuid)','execute') as value"), false);
  } finally {
    await db.exec('rollback');
  }
});

test('monthly auto-withdrawals open one cycle per creator per month and leave manual withdrawals to their own weekly limit', async () => {
  await db.exec('begin');
  try {
    // The run may also open cycles for other fixtures' creators; everything is rolled back afterwards.
    const creators: string[] = [];
    const setup = async (id: string, label: string, day: string, credits: number[]) => {
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${label}@example.test`]);
      await db.query('select public.bootstrap_worker($1)', [id]);
      await db.query("select public.save_upi_config($1,$2,'Monthly',$3)", [id, `${label}@bank`, day]);
      await db.query("select public.verify_upi_config($1,$2,$3,true)", [admin, id, `${label}@bank`]);
      // Switched on before this month began, so this month's date counts.
      await db.query("select public.set_auto_withdrawal($1,true,$2)", [id, Number(day)]);
      await db.query("update public.upi_configs set auto_withdraw_since=date_trunc('month',now())-interval '1 day' where worker_id=$1", [id]);
      for (const [index, amount] of credits.entries()) {
        await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values($1,$2,'Credit',$3,'Approved')", [`WI-AUTO-${label}-${index}`, id, amount]);
      }
      creators.push(id);
    };
    const due = '88888888-8888-4888-8888-888888888881', small = '88888888-8888-4888-8888-888888888882', later = '88888888-8888-4888-8888-888888888883';
    const todayIst = await scalar<number>("select extract(day from (now() at time zone 'Asia/Kolkata'))::int as value");
    await setup(due, 'autodue', '1', [600, 300]);
    await setup(small, 'autosmall', '1', [200]);
    await setup(later, 'autolater', '28', [700]);
    // Switched off: never withdrawn automatically. Switched on today for the 1st: waits for next month's 1st.
    const off = '88888888-8888-4888-8888-888888888884', fresh = '88888888-8888-4888-8888-888888888885';
    await setup(off, 'autooff', '1', [800]);
    await db.query("select public.set_auto_withdrawal($1,false,1)", [off]);
    assert.equal(await scalar<string | null>("select auto_withdraw_since::text as value from public.upi_configs where worker_id=$1", [off]), null);
    await setup(fresh, 'autofresh', '1', [800]);
    await db.query("update public.upi_configs set auto_withdraw_since=now() where worker_id=$1", [fresh]);
    const auto = (id: string) => db.query<{ origin: string; total: string }>(
      "select b.origin, sum(i.amount_inr)::text as total from public.payout_batches b join public.payout_items i on i.batch_id=b.id where b.worker_id=$1 group by b.id, b.origin", [id]);
    await scalar('select public.auto_request_payouts(1000) as value');
    assert.deepEqual((await auto(due)).rows, [{ origin: 'auto', total: '900.00' }]);
    assert.match(await scalar<string>("select cycle_label as value from public.payout_batches where worker_id=$1", [due]), /^Monthly auto-withdrawal/);
    assert.deepEqual((await auto(small)).rows, [], 'below the minimum, nothing is sent');
    assert.equal((await auto(later)).rows.length, todayIst >= 28 ? 1 : 0, 'the chosen day decides when the month\'s run happens');
    assert.deepEqual((await auto(off)).rows, [], 'switched off');
    assert.equal((await auto(fresh)).rows.length, todayIst === 1 ? 1 : 0, 'a date before it was switched on is skipped');
    await db.exec('savepoint bad_day');
    await assert.rejects(db.query("select public.set_auto_withdrawal($1,true,29)", [due]), /invalid_input/);
    await db.exec('rollback to savepoint bad_day');
    // Running again in the same month creates nothing new, even after the cycle is paid and new credits arrive.
    const cycle = await scalar<string>("select id::text as value from public.payout_batches where worker_id=$1", [due]);
    await db.query("select public.transition_payout($1,$2,'approve')", [admin, cycle]);
    await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-AUTO')", [admin, cycle]);
    await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-AUTO-NEW',$1,'Credit',550,'Approved')", [due]);
    await scalar('select public.auto_request_payouts(1000) as value');
    assert.equal((await auto(due)).rows.length, 1);
    // The automatic cycle doesn't use up the creator's manual withdrawal for the week. (The new credit takes the
    // creator past INR 1,000 in total, so KYC is approved first.)
    await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test','1990-01-01','123','Test','ID','123','test','test')", [due]);
    const manual = await scalar<{ amount: number; origin: string }>('select public.request_payout($1) as value', [due]);
    assert.equal(Number(manual.amount), 550);
    assert.equal(manual.origin, 'manual');
    assert.equal(await scalar<boolean>("select has_function_privilege('service_role','public.create_payout_batch(uuid,text)','execute') as value"), false);
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.set_auto_withdrawal(uuid,boolean,integer)','execute') as value"), false);
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.auto_request_payouts(integer)','execute') as value"), false);
  } finally {
    await db.exec('rollback');
  }
});

test('creators can be paid to a verified bank account; changes need verification again and payouts snapshot the account', async () => {
  await db.exec('begin');
  try {
    const owner = '99999999-9999-4999-8999-999999999991';
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'bank@example.test',now())", [owner]);
    await db.query('select public.bootstrap_worker($1)', [owner]);
    const save = (method: string, upi: string | null, holder: string | null, account: string | null, ifsc: string | null) =>
      scalar<Record<string, unknown>>('select public.save_payout_method($1,$2,$3,$4,$5,$6) as value', [owner, method, upi, holder, account, ifsc]);
    const rejects = async (args: [string, string | null, string | null, string | null, string | null], pattern: RegExp) => {
      await db.exec('savepoint bad');
      await assert.rejects(db.query('select public.save_payout_method($1,$2,$3,$4,$5,$6)', [owner, ...args]), pattern);
      await db.exec('rollback to savepoint bad');
    };
    for (const args of [
      ['Bank', null, 'A', '123456789012', 'HDFC0001234'], ['Bank', null, 'Asha Rao', '12345678', 'HDFC0001234'],
      ['Bank', null, 'Asha Rao', '123456789012', 'HDFC1001234'], ['Bank', null, 'Asha 2 Rao', '123456789012', 'HDFC0001234'],
      ['UPI', 'not-a-upi', null, null, null], ['Cheque', null, null, null, null],
    ] as Array<[string, string | null, string | null, string | null, string | null]>) await rejects(args, /invalid_payout_method/);
    const saved = await save('Bank', null, '  Asha   Rao ', '1234 5678 9012', 'hdfc0001234');
    assert.equal(saved.upi_id, 'bank:HDFC0001234:123456789012');
    assert.equal(saved.bank_holder_name, 'Asha Rao');
    assert.equal(saved.method, 'Bank');
    assert.equal(saved.verified, false);
    // Not verified yet: no payouts.
    await db.query("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-BANK-1',$1,'Credit',600,'Approved')", [owner]);
    await db.exec('savepoint unverified');
    await assert.rejects(db.query('select public.request_payout($1)', [owner]), /upi_required/);
    await db.exec('rollback to savepoint unverified');
    // The team verifies the exact account they reviewed.
    await db.exec('savepoint stale');
    await assert.rejects(db.query("select public.verify_upi_config($1,$2,'bank:HDFC0001234:999999999999',true)", [admin, owner]), /not_found|invalid/);
    await db.exec('rollback to savepoint stale');
    await db.query("select public.verify_upi_config($1,$2,'bank:HDFC0001234:123456789012',true)", [admin, owner]);
    // Saving the same details again keeps the verification.
    assert.equal((await save('Bank', null, 'Asha Rao', '123456789012', 'HDFC0001234')).verified, true);
    const payout = await scalar<{ batchId: string; method: string }>('select public.request_payout($1) as value', [owner]);
    assert.equal(payout.method, 'Bank');
    const batch = await db.query<{ method: string; upi_id_snapshot: string; payee_name_snapshot: string }>('select method,upi_id_snapshot,payee_name_snapshot from public.payout_batches where id=$1', [payout.batchId]);
    assert.deepEqual(batch.rows[0], { method: 'Bank', upi_id_snapshot: 'bank:HDFC0001234:123456789012', payee_name_snapshot: 'Asha Rao' });
    // Locked while the payout is open, even for a different account holder name.
    await rejects(['Bank', null, 'Asha R', '123456789012', 'HDFC0001234'], /active_batch/);
    await rejects(['UPI', 'asha@okhdfcbank', null, null, null], /active_batch/);
    await db.query("select public.transition_payout($1,$2,'approve')", [admin, payout.batchId]);
    await db.query("select public.transition_payout($1,$2,'mark-paid','UTR-BANK')", [admin, payout.batchId]);
    // Switching to UPI clears the bank details and needs verification again.
    const upi = await save('UPI', 'asha@okhdfcbank', null, null, null);
    assert.deepEqual([upi.method, upi.upi_id, upi.bank_account_number, upi.verified], ['UPI', 'asha@okhdfcbank', null, false]);
    assert.equal(await scalar<number>("select count(*)::int as value from public.audit_events where actor_id=$1 and action='payout_method_saved'", [owner]), 2);
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.save_payout_method(uuid,text,text,text,text,text)','execute') as value"), false);
  } finally {
    await db.exec('rollback');
  }
});

test('legacy weekday-only payout days are converted so switching on monthly auto-withdrawal works', async () => {
  const fix = await readFile('supabase/migrations/202610310006_payout_day_accepts_monthly.sql', 'utf8');
  await db.exec('begin');
  try {
    // Recreate an older database: payout_day as a weekday enum, plus a schedule rule that only knows "Weekly".
    await db.exec(`alter table public.upi_configs drop constraint upi_configs_payout_schedule_day_check;
      update public.upi_configs set payout_schedule='Weekly', payout_day='Fri';
      create type public.legacy_weekday as enum ('Mon','Tue','Wed','Thu','Fri','Sat','Sun');
      alter table public.upi_configs alter column payout_day drop default;
      alter table public.upi_configs alter column payout_day type public.legacy_weekday using payout_day::public.legacy_weekday;
      alter table public.upi_configs add constraint legacy_schedule_check check (payout_schedule in ('Weekly'));`);
    await db.exec('savepoint before_fix');
    await assert.rejects(db.query('select public.set_auto_withdrawal($1,true,1)', [worker]));
    await db.exec('rollback to savepoint before_fix');
    await db.exec(fix);
    assert.equal(await scalar<string>("select data_type as value from information_schema.columns where table_name='upi_configs' and column_name='payout_day'"), 'text');
    assert.equal(await scalar<number>("select count(*)::int as value from pg_constraint where conname='legacy_schedule_check'"), 0);
    const saved = await scalar<{ payout_schedule: string; payout_day: string; auto_withdraw: boolean }>('select public.set_auto_withdrawal($1,true,1) as value', [worker]);
    assert.deepEqual([saved.payout_schedule, saved.payout_day, saved.auto_withdraw], ['Monthly', '1', true]);
    // Odd legacy values are corrected, so later updates (like the team verifying) keep passing the new rule.
    await db.exec('alter table public.upi_configs drop constraint upi_configs_payout_schedule_day_check');
    await db.query("update public.upi_configs set payout_schedule='weekly', payout_day='FRIDAY' where worker_id=$1", [worker]);
    await db.exec(fix);
    assert.deepEqual((await db.query('select payout_schedule,payout_day from public.upi_configs where worker_id=$1', [worker])).rows[0], { payout_schedule: 'Weekly', payout_day: 'Fri' });
    await db.exec('alter table public.upi_configs drop constraint upi_configs_payout_schedule_day_check');
    await db.query("update public.upi_configs set payout_schedule='Monthly', payout_day='05' where worker_id=$1", [worker]);
    await db.exec(fix);
    assert.equal(await scalar<string>('select payout_day as value from public.upi_configs where worker_id=$1', [worker]), '5');
    await db.exec('savepoint bad_day');
    await assert.rejects(db.query("update public.upi_configs set payout_day='31' where worker_id=$1", [worker]), /check constraint/);
    await db.exec('rollback to savepoint bad_day');
  } finally {
    await db.exec('rollback');
  }
});

test('gigs follow the team feed order: new gigs join at the bottom and reorder_gigs saves the whole order', async () => {
  await db.exec('begin');
  try {
    const add = (id: string) => db.query("insert into public.gigs(id,title,company,workload,payout) values($1,$1,'Co','Part time','₹100')", [id]);
    for (const id of ['feed-a', 'feed-b', 'feed-c']) await add(id);
    const order = async () => (await db.query<{ id: string }>("select id from public.gigs where id like 'feed-%' order by feed_position nulls last, created_at desc")).rows.map(row => row.id);
    assert.deepEqual(await order(), ['feed-a', 'feed-b', 'feed-c']);
    await db.query("select public.reorder_gigs(array['feed-c','feed-a'])");
    // Gigs left out keep their place after the listed ones; unknown ids are ignored.
    assert.deepEqual(await order(), ['feed-c', 'feed-a', 'feed-b']);
    await db.query("select public.reorder_gigs(array['feed-b','missing'])");
    assert.deepEqual(await order(), ['feed-b', 'feed-c', 'feed-a']);
    await add('feed-new');
    assert.deepEqual(await order(), ['feed-b', 'feed-c', 'feed-a', 'feed-new']);
    await db.query("select public.reorder_gigs(array['feed-b','feed-c','feed-a','feed-new'])");
    assert.equal(await scalar<number>("select public.reorder_gigs(array['feed-b','feed-c','feed-a','feed-new']) as value"), 0);
    await db.exec('savepoint duplicate');
    await assert.rejects(db.query("select public.reorder_gigs(array['feed-a','feed-a'])"), /invalid_gig_order/);
    await db.exec('rollback to savepoint duplicate');
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated', 'public.reorder_gigs(text[])', 'execute') as value"), false);
  } finally {
    await db.exec('rollback');
  }
});

test('withdrawals reject INR 499.99 and reserve INR 500 exactly once', async () => {
  // Roll back the fixture so unrelated wallet and directory assertions keep their data.
  await db.exec('begin');
  try {
    const owner = '55555555-5555-4555-8555-555555555555';
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'minimum@example.test',now())", [owner]);
    await db.query('select public.bootstrap_worker($1)', [owner]);
    await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test','1990-01-01','123','Test','ID','123','test','test')", [owner]);
    await db.query("select public.save_upi_config($1,'minimum@bank','Weekly','Fri')", [owner]);
    await db.query("select public.verify_upi_config($1,$2,'minimum@bank',true)", [admin, owner]);
    const credit = await scalar<string>("insert into public.work_items(public_id,worker_id,title,reward_inr,status) values('WI-MINIMUM',$1,'Approved credit',499.99,'Approved') returning id as value", [owner]);
    await db.exec('savepoint below_minimum');
    await assert.rejects(db.query('select public.request_payout($1)', [owner]), /minimum_amount/);
    await db.exec('rollback to savepoint below_minimum');
    assert.equal(await scalar<number>('select count(*)::int as value from public.payout_batches where worker_id=$1', [owner]), 0);
    await db.query('update public.work_items set reward_inr=500 where id=$1', [credit]);
    const requests = await Promise.all([1, 2].map(() => scalar<{ batchId: string }>('select public.request_payout($1) as value', [owner])));
    assert.equal(requests[0].batchId, requests[1].batchId);
    assert.equal(await scalar<number>('select count(*)::int as value from public.payout_items where batch_id=$1', [requests[0].batchId]), 1);
    assert.equal(Number(await scalar<string>('select sum(amount_inr) as value from public.payout_items where batch_id=$1', [requests[0].batchId])), 500);
    assert.equal(await scalar<string>('select upi_id_snapshot as value from public.payout_batches where id=$1', [requests[0].batchId]), 'minimum@bank');
  } finally {
    await db.exec('rollback');
  }
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
  // Earlier tests' applications would otherwise fill this week's two application slots.
  await db.exec("update public.gig_applications set applied_at=now()-interval '8 days'");
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

test('creators can apply to at most two gigs in any rolling seven days', async () => {
  await db.exec("update public.gig_applications set applied_at=now()-interval '8 days'");
  await db.exec("insert into public.gigs(id,title,company,workload,payout,gig_type) values('weekly-a','A','Team','1','1000','Content Creator'),('weekly-b','B','Team','1','1000','Content Creator'),('weekly-c','C','Team','1','1000','Content Creator')");
  const quota=async()=>scalar<{used:number;remaining:number;nextSlotAt:string|null;gigs:{gigId:string}[]}>('select public.gig_application_quota($1) as value',[other]);
  assert.equal((await quota()).remaining,2);
  await db.query("select public.submit_gig_application($1,$1,'weekly-a','a')",[other]);
  await db.query("select public.submit_gig_application($1,$1,'weekly-b','b')",[other]);
  const full=await quota();
  assert.equal(full.used,2);
  assert.equal(full.remaining,0);
  assert.ok(full.nextSlotAt && Date.parse(full.nextSlotAt)>Date.now()+6*86_400_000);
  assert.deepEqual(full.gigs.map(g=>g.gigId).sort(),['weekly-a','weekly-b']);
  await assert.rejects(db.query("select public.submit_gig_application($1,$1,'weekly-c','c')",[other]),/weekly_application_limit/);
  // Withdrawing doesn't free the slot, re-submitting a counted gig is allowed, and the team isn't limited.
  await db.query("update public.gig_applications set status='Withdrawn' where gig_id='weekly-a'");
  await assert.rejects(db.query("select public.submit_gig_application($1,$1,'weekly-c','c')",[other]),/weekly_application_limit/);
  await db.query("select public.submit_gig_application($1,$1,'weekly-a','again')",[other]);
  await db.query("select public.submit_gig_application($1,$2,'weekly-c','by team')",[admin,other]);
  // A slot opens once the oldest counted application is more than seven days old.
  await db.exec("update public.gig_applications set applied_at=now()-interval '8 days' where gig_id in('weekly-a','weekly-c')");
  assert.equal((await quota()).remaining,1);
  await db.query("select public.submit_gig_application($1,$1,'weekly-c','c')",[other]);
  assert.equal((await quota()).remaining,0);
});

test('held gigs open to new creators only after another project or 20 days; the team is never held', async () => {
  const fresh = '44444444-4444-4444-8444-444444444444';
  const emails = (prefix: string) => JSON.stringify([1, 2, 3, 4, 5].map((n) => `${prefix}${n}@fasterdrop.site`));
  await db.exec('begin');
  try {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'fresh@example.test',now())", [fresh]);
    await db.query('select public.bootstrap_worker($1)', [fresh]);
    await db.exec(`insert into public.gigs(id,title,company,workload,payout,gig_type,new_creator_hold) values
      ('held-a','Held','Team','1','100','Content Creator',true),('held-ec','Held EC','Team','5','100','Email Creator',true),
      ('open-a','Open','Team','1','100','Content Creator',false)`);
    const until = await scalar<string>("select public.new_creator_hold_until($1,'held-a') as value", [fresh]);
    assert.ok(Date.parse(until) > Date.now() + 19 * 86_400_000);
    await db.exec('savepoint held');
    await assert.rejects(db.query("select public.submit_gig_application($1,$1,'held-a','x')", [fresh]), /new_creator_hold/);
    await db.exec('rollback to savepoint held');
    await assert.rejects(db.query('select public.create_gig_assignment($1,$1,$2,$3::jsonb)', [fresh, 'held-ec', emails('held')]), /new_creator_hold/);
    await db.exec('rollback to savepoint held');
    // Unheld gigs are open, and the team can still apply on a new creator's behalf.
    await db.query("select public.submit_gig_application($1,$1,'open-a','x')", [fresh]);
    await db.query("select public.submit_gig_application($1,$2,'held-a','by team')", [admin, fresh]);
    await db.exec("delete from public.gig_applications where gig_id='held-a'");
    // Being assigned another project lifts the hold.
    await db.exec("update public.gig_applications set status='Accepted' where gig_id='open-a'");
    assert.equal(await scalar<string | null>("select public.new_creator_hold_until($1,'held-a') as value", [fresh]), null);
    await db.query("select public.submit_gig_application($1,$1,'held-a','x')", [fresh]);
    // So does an account that is 20 days old.
    await db.exec("update public.gig_applications set status='Pending' where gig_id='open-a'");
    assert.ok(await scalar<string | null>("select public.new_creator_hold_until($1,'held-ec') as value", [fresh]));
    await db.query("update public.profiles set created_at=now()-interval '20 days' where id=$1", [fresh]);
    assert.equal(await scalar<string | null>("select public.new_creator_hold_until($1,'held-ec') as value", [fresh]), null);
    await db.query('select public.create_gig_assignment($1,$1,$2,$3::jsonb)', [fresh, 'held-ec', emails('heldok')]);
  } finally {
    await db.exec('rollback');
  }
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
  await db.query("update public.payout_batches set created_at=created_at-interval '8 days' where worker_id=$1", [worker]);
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

test('worker moderation archives access atomically, protects administrators, and retains financial and audit records', async () => {
  const subject='aaaa1111-1111-4111-8111-111111111111';
  const peer='bbbb2222-2222-4222-8222-222222222222';
  for (const [id,email] of [[subject,'moderation@example.test'],[peer,'moderation-peer@example.test']]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
    await db.query('select public.bootstrap_worker($1)',[id]);
  }
  const code=await scalar<string>('select worker_code as value from public.profiles where id=$1',[subject]);
  const historical=await scalar<string>("insert into public.work_items(public_id,worker_id,title,status,reward_inr) values('moderation-financial-history',$1,'Approved prior work','Approved',75) returning id as value",[subject]);
  const act=(action:string,reason='Documented policy violation',confirmation:string|null=null,ip:string|null=null,actorIp:string|null='1.1.1.1',actor=admin)=>scalar<{status:string;changed:boolean}>('select public.moderate_worker($1,$2,$3,$4,$5,$6,$7) as value',[actor,subject,action,reason,confirmation,ip,actorIp]);
  const status=()=>scalar<string>('select status as value from public.worker_moderation where user_id=$1',[subject]);
  const count=()=>scalar<number>('select count(*)::int as value from public.worker_moderation_events where user_id=$1',[subject]);
  await assert.rejects(act('suspend','Documented policy violation',null,null,null,peer),/forbidden/);
  await assert.rejects(db.query("select public.moderate_worker($1,$1,'suspend','Self moderation must be blocked')",[admin]),/forbidden/);
  await assert.rejects(act('suspend','bad'),/moderation_reason_required/);
  await assert.rejects(act('unknown'),/invalid_moderation_action/);
  await db.query("select public.record_worker_access($1,'8.8.8.8')",[subject]);
  await db.query("select public.record_worker_access($1,'9.9.9.9')",[subject]);
  const firstSeen=await scalar<string>("select last_seen_at::text as value from public.worker_access_ips where user_id=$1 and ip='8.8.8.8'",[subject]);
  await db.query("select public.record_worker_access($1,'8.8.8.8')",[subject]);
  assert.equal(await scalar<string>("select last_seen_at::text as value from public.worker_access_ips where user_id=$1 and ip='8.8.8.8'",[subject]),firstSeen,'frequent requests do not rewrite IP telemetry');
  await assert.rejects(act('suspend_ip','Observed address should be required',null,'4.2.2.2'),/worker_ip_not_observed/);
  await assert.rejects(act('suspend_ip','Administrator connection must be known',null,'8.8.8.8',null),/actor_ip_required/);
  await assert.rejects(act('suspend_ip','Shared administrator address is protected',null,'8.8.8.8','8.8.8.8'),/admin_ip_protected/);
  await db.query("select public.record_worker_access($1,'9.9.9.9')",[admin]);
  await assert.rejects(act('suspend_ip','Historical administrator address is protected',null,'9.9.9.9'),/admin_ip_protected/);
  assert.equal(await count(),0,'failed actions leave no audit events or changed access');
  assert.deepEqual(await act('suspend_ip','Verified repeated abuse from captured address',null,'8.8.8.8'),{status:'suspended',changed:true});
  assert.equal(await status(),'suspended');
  assert.equal(await scalar<boolean>('select active as value from public.profiles where id=$1',[subject]),false);
  assert.equal(await scalar<boolean>('select active as value from public.workers where user_id=$1',[subject]),false);
  assert.equal(await count(),1);
  assert.equal((await act('suspend_ip','Retrying the same moderation action',null,'8.8.8.8')).changed,false);
  assert.equal(await count(),1,'retrying a completed action does not duplicate audit evidence');
  await assert.rejects(db.query("select public.record_worker_access($1,'8.8.8.8')",[peer]),/ip_blocked/);
  await assert.rejects(db.query("select public.record_worker_access($1,'4.2.2.2')",[subject]),/account_inactive/);
  assert.equal((await act('unblock_ip','Shared network review completed',null,'8.8.8.8')).status,'suspended');
  assert.equal(await status(),'suspended','removing an address block does not restore the account');
  await db.query("select public.record_worker_access($1,'8.8.8.8')",[peer]);
  await assert.rejects(act('delete','Archival confirmation must match','WRONG-ID'),/moderation_confirmation_required/);
  assert.equal((await act('delete','Account removed after completed review',code)).status,'deleted');
  assert.equal(await scalar<boolean>('select deleted_at is not null as value from public.worker_moderation where user_id=$1',[subject]),true);
  assert.equal(await scalar<number>('select count(*)::int as value from auth.users where id=$1',[subject]),1);
  assert.equal(await scalar<string>('select reward_inr::text as value from public.work_items where id=$1',[historical]),'75.00');
  await assert.rejects(act('suspend'),/invalid_transition/);
  assert.equal((await act('restore','Appeal accepted and access restored')).status,'active');
  assert.equal(await scalar<boolean>('select active as value from public.profiles where id=$1',[subject]),true);
  assert.equal(await scalar<boolean>('select deleted_at is null and suspended_at is null as value from public.worker_moderation where user_id=$1',[subject]),true);
  await act('suspend_ip','Recurrent confirmed policy abuse',null,'8.8.8.8');
  await act('restore','Second appeal accepted by administrator');
  assert.equal(await scalar<number>('select count(*)::int as value from public.worker_ip_blocks where user_id=$1',[subject]),0,'restore removes blocks owned by this worker');
  await db.query("select public.record_worker_access($1,'8.8.8.8')",[subject]);
  const latest=await scalar<{actor:string;reason:string}>('select jsonb_build_object(\'actor\',actor_label,\'reason\',reason) as value from public.worker_moderation_events where user_id=$1 order by created_at desc limit 1',[subject]);
  assert.equal(latest.actor,'Test Admin');
  assert.equal(latest.reason,'Second appeal accepted by administrator');
  for (const table of ['worker_moderation','worker_access_ips','worker_ip_blocks','worker_moderation_events']) {
    assert.equal(await scalar<boolean>(`select has_table_privilege('authenticated','public.${table}','select') as value`),false);
    assert.equal(await scalar<boolean>(`select has_table_privilege('anon','public.${table}','select') as value`),false);
    assert.equal(await scalar<boolean>(`select has_table_privilege('service_role','public.${table}','select') as value`),true);
    assert.equal(await scalar<boolean>(`select has_table_privilege('service_role','public.${table}','update') as value`),false);
  }
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.moderate_worker(uuid,uuid,text,text,text,inet,inet)','execute') as value"),false);
  for (const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','192.0.2.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','2001:db8::1','8.8.8.0/24']) {
    await assert.rejects(db.query('select public.record_worker_access($1,$2)',[subject,ip]),/invalid_worker_ip/);
  }
  await db.query("select public.record_worker_access($1,'2606:4700:4700::1111')",[subject]);
});

test('trusted-IP enforcement allows first verified login before profile bootstrap while retaining network restrictions', async () => {
  const fresh='cccc3333-3333-4333-8333-333333333333';
  const unconfirmed='dddd4444-4444-4444-8444-444444444444';
  const blockedUser='eeee5555-5555-4555-8555-555555555555';
  for (const [id,email] of [[fresh,'fresh-moderation@example.test'],[blockedUser,'blocked-fresh@example.test']]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
  }
  await db.query("insert into auth.users(id,email) values($1,'unconfirmed-moderation@example.test')",[unconfirmed]);
  await db.query('select public.bootstrap_worker($1)',[blockedUser]);
  await db.query("select public.record_worker_access($1,'8.8.4.4')",[blockedUser]);
  await db.query("select public.moderate_worker($1,$2,'suspend_ip','Confirmed repeated policy abuse',null,'8.8.4.4','1.1.1.1')",[admin,blockedUser]);
  await assert.rejects(db.query("select public.record_worker_access($1,'8.8.4.4')",[fresh]),/ip_blocked/);
  assert.equal(await scalar<boolean>("select public.record_worker_access($1,'4.2.2.2') as value",[fresh]),true);
  assert.equal(await scalar<number>('select count(*)::int as value from public.worker_access_ips where user_id=$1',[fresh]),0);
  await db.query('select public.bootstrap_worker($1)',[fresh]);
  await db.query("select public.record_worker_access($1,'4.2.2.2')",[fresh]);
  assert.equal(await scalar<number>('select count(*)::int as value from public.worker_access_ips where user_id=$1',[fresh]),1);
  await assert.rejects(db.query("select public.record_worker_access($1,'4.2.2.2')",[unconfirmed]),/account_inactive/);
  await assert.rejects(db.query("select public.record_worker_access('ffffffff-ffff-4fff-8fff-ffffffffffff','4.2.2.2')"),/account_inactive/);
});

test('a team-pinned view count survives sync, records the public count beside it, and resumes live in one step', async () => {
  const code = await scalar<string>('select worker_code as value from public.profiles where id=$1', [worker]);
  const account = await liveAccount(code, 'pinned-views');
  const url = 'https://www.instagram.com/reel/PINNED1/';
  const save = (input: Record<string, unknown>) => scalar<{ post: { id: string; views: number; views_pinned: boolean; views_source: string } }>('select public.save_social_post_with_wallet($1,$2) as value', [admin, { account_id: account, url, ...input }]);
  const sync = (id: string, views: number) => db.query("select public.apply_synced_post_metrics($1,$2,null,null,'profile',now())", [id, views]);
  const row = (id: string) => db.query<{ views: number; views_pinned: boolean; views_source: string; synced_views: number }>('select views,views_pinned,views_source,synced_views from public.social_account_posts where id=$1', [id]).then(r => r.rows[0]);

  const { post } = await save({ views: 901, views_pinned: true });
  assert.equal(post.views_pinned, true);
  await sync(post.id, 1200);
  assert.deepEqual(await row(post.id), { views: 901, views_pinned: true, views_source: 'manual', synced_views: 1200 }, 'a higher public count never replaces a pinned one');
  await sync(post.id, 400);
  assert.equal((await row(post.id)).views, 901, 'nor does a lower one');
  assert.equal((await row(post.id)).synced_views, 1200, 'a stale reader cannot lower the verified public high-water mark');

  // Saving again without views_pinned keeps the pin; an invalid pin value is rejected.
  await save({ views: 901, caption: 'Fixed caption' });
  assert.equal((await row(post.id)).views_pinned, true);
  await assert.rejects(save({ views: 901, views_pinned: 'yes' }), /invalid_input/);

  await assert.rejects(db.query('select public.resume_social_post_live_views($1,$2)', [worker, post.id]), /forbidden/);
  await db.query('select public.resume_social_post_live_views($1,$2)', [admin, post.id]);
  assert.deepEqual(await row(post.id), { views: 1200, views_pinned: false, views_source: 'profile', synced_views: 1200 }, 'resuming takes the highest verified public reading');
  await sync(post.id, 1300);
  assert.equal((await row(post.id)).views, 1300, 'live tracking continues after resuming');
  assert.equal(await scalar<number>("select count(*)::int as value from public.audit_events where action='social_post_views_resumed' and resource_id=$1", [post.id]), 1);
  assert.equal(await scalar<boolean>("select has_function_privilege('authenticated','public.resume_social_post_live_views(uuid,uuid)','execute') as value"), false);
});
