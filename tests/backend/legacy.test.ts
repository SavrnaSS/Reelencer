import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { realtimeTestSchema } from './helpers/realtime';

const worker = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const legacyWork = '44444444-4444-4444-8444-444444444444';
const legacyBatch = '55555555-5555-4555-8555-555555555555';
const legacyPayout = '66666666-6666-4666-8666-666666666666';
const legacyApplication = '77777777-7777-4777-8777-777777777777';

// A self-contained snapshot of the earlier schema, with synthetic values only.
// This intentionally retains the old types, aliases, required columns and keys.
const legacySchema = `
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
create schema auth; create schema storage;
${realtimeTestSchema}
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,auth to anon,authenticated,service_role;
grant usage on schema auth to supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;
create type role_type as enum ('Worker','Admin');
create type policy_tier as enum ('Standard','Strict');
create type account_health as enum ('Healthy','Warning');
create type task_type as enum ('Reel posting');
create type work_status as enum ('Open','In progress','Submitted','Needs fix','Approved','Hard rejected');
create type work_priority as enum ('P1','P2');
create type upi_schedule as enum ('Weekly','Monthly');
create type payout_batch_status as enum ('Draft','Processing','Paid','Failed');
create type payout_item_status as enum ('Included','Paid','Failed');
create table public.profiles (
  id uuid primary key references auth.users(id), role role_type not null default 'Worker',
  display_name text, worker_code text not null unique default '',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  constraint legacy_role_check check(role in ('Worker'::role_type,'Admin'::role_type))
);
alter table public.profiles enable row level security;
create policy legacy_admin_policy on public.profiles for select to authenticated using(role='Admin'::role_type);
create table public.workers (
  id text primary key,name text not null,email text not null unique,active boolean not null default true,
  auth_user_id uuid not null unique references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.accounts (
  id text primary key default gen_random_uuid()::text,handle text not null unique,
  niche text not null default '',owner_team text not null default '',
  policy_tier policy_tier not null default 'Standard',health account_health not null default 'Healthy',
  rules text[] not null default '{}',allowed_audios text[] not null default '{}',required_hashtags text[] not null default '{}',
  created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.assignments (
  workerid text not null references public.workers(id),accountid text not null references public.accounts(id),
  created_at timestamptz not null default now(),primary key(workerid,accountid)
);
create table public.worker_account_assignments (
  id uuid primary key default gen_random_uuid(),worker_id uuid not null,account_id text not null references public.accounts(id),
  assigned_by uuid,assigned_at timestamptz not null default now(),unique(worker_id,account_id)
);
create table public.worker_accounts(worker_id text not null,account_id text not null,primary key(worker_id,account_id));
create table public.work_items (
  id uuid primary key default gen_random_uuid(),public_id text unique,title text not null,type task_type not null,
  account_id text not null references public.accounts(id),worker_id uuid not null,created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),due_at timestamptz not null,status work_status not null default 'Open',
  priority work_priority not null default 'P1',reward_inr integer not null default 0,
  est_minutes integer not null default 10,sla_minutes integer not null default 180,
  started_at timestamptz,completed_at timestamptz,gates jsonb not null default '{}',submission jsonb,review jsonb,
  updated_at timestamptz not null default now()
);
create table public.work_item_audit (
  id uuid primary key default gen_random_uuid(),work_item_id uuid not null references public.work_items(id),
  at timestamptz not null default now(),by_profile uuid,by_label text not null default '',text text not null
);
create table public.gigs (
  id text primary key,title text not null,company text not null,verified boolean not null default false,
  platform text not null,location text not null default '',workload text not null,payout text not null,payout_type text not null,
  requirements text[] not null default '{}',status text not null default 'Open',
  posted_at timestamptz not null default now(),created_at timestamptz not null default now(),gig_type text default 'Email Creator'
);
create table public.gig_applications (
  id text primary key,gig_id text not null references public.gigs(id),worker_code text not null,worker_name text,
  status text not null default 'Pending',applied_at timestamptz not null default now(),decided_at timestamptz
);
create unique index gig_applications_unique on public.gig_applications(gig_id,worker_code);
create table public.gig_assignments (
  id uuid primary key default gen_random_uuid(),gig_id text not null references public.gigs(id),
  worker_code text not null,assigned_email text not null,status text not null default 'Assigned',
  submitted_at timestamptz,decided_at timestamptz,created_at timestamptz not null default now(),
  subject_filter text,assigned_emails text[]
);
create unique index gig_assignments_unique on public.gig_assignments(gig_id,worker_code);
create table public.worker_kyc (
  id uuid primary key default gen_random_uuid(),user_id uuid not null unique,status text not null default 'pending',
  legal_name text not null,dob text not null,phone text not null,address text not null,id_type text not null,id_number text not null,
  id_doc_path text,selfie_path text,submitted_at timestamptz not null default now(),reviewed_at timestamptz,
  reviewer_id uuid,rejection_reason text,worker_id text,admin_note text
);
create table public.worker_kyc_events (
  id uuid primary key default gen_random_uuid(),kyc_id uuid not null,status text not null,note text,
  actor_id uuid,created_at timestamptz not null default now()
);
create table public.upi_configs (
  worker_id uuid primary key,upi_id text not null default '',verified boolean not null default false,verified_at timestamptz,
  payout_schedule upi_schedule not null default 'Weekly',payout_day text not null default 'Fri',updated_at timestamptz not null default now()
);
create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),worker_id uuid not null,cycle_label text not null,
  period_start date not null,period_end date not null,status payout_batch_status not null default 'Draft',
  method text not null default 'UPI',notes jsonb not null default '[]',created_at timestamptz not null default now(),
  processed_at timestamptz,paid_at timestamptz
);
create table public.payout_items (
  id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.payout_batches(id),
  work_item_id uuid references public.work_items(id),worker_id uuid not null,handle text not null default '',
  amount_inr integer not null default 0,status payout_item_status not null default 'Included',reason text,
  created_at timestamptz not null default now()
);
create table public."UnrelatedApplication"(id text primary key,payload jsonb not null);
insert into public."UnrelatedApplication" values('keep','{"source":"unrelated"}');
`;

// The deployed predecessor installs these routines and triggers. They must be
// migrated too: table reconciliation alone leaves Auth signup calling old names.
const legacyHooks = `
create sequence public.worker_code_seq start 67;
create function public.next_worker_code() returns text language sql as $$
  select 'WKR-'||lpad(nextval('public.worker_code_seq')::text,3,'0')
$$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='public' as $$
begin
  insert into public.profiles(id,role,display_name)
    values(new.id,'Worker',coalesce(new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name',new.email))
    on conflict(id) do nothing;
  return new;
end $$;
create function public.profiles_set_worker_code() returns trigger language plpgsql as $$
begin
  if new.role='Worker' and (new.worker_code is null or new.worker_code='') then
    new.worker_code:=public.next_worker_code();
  end if;
  return new;
end $$;
create function public.profiles_block_worker_code_change() returns trigger language plpgsql as $$
begin
  if old.worker_code is distinct from new.worker_code then raise exception 'worker_code is immutable'; end if;
  return new;
end $$;
create function public.sync_worker_from_profile() returns trigger language plpgsql security definer set search_path='public' as $$
declare u_email text; u_name text;
begin
  if new.role<>'Worker' or new.worker_code is null or new.worker_code='' then return new; end if;
  select lower(u.email),coalesce(new.display_name,u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',u.email)
    into u_email,u_name from auth.users u where u.id=new.id;
  if u_email is null or u_email='' then return new; end if;
  insert into public.workers(id,name,email,active,auth_user_id)
    values(new.worker_code,u_name,u_email,true,new.id)
    on conflict(auth_user_id) do update set id=excluded.id,name=excluded.name,email=excluded.email,
      active=excluded.active,updated_at=now();
  return new;
end $$;
create function public.ensure_profile() returns public.profiles language plpgsql security definer set search_path='public' as $$
declare u_id uuid:=auth.uid(); dn text; p public.profiles;
begin
  if u_id is null then raise exception 'Not authenticated'; end if;
  select coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',u.email) into dn from auth.users u where u.id=u_id;
  select * into p from public.profiles where id=u_id;
  if found then return p; end if;
  insert into public.profiles(id,role,display_name) values(u_id,'Worker',dn) returning * into p;
  return p;
end $$;
create function public.is_admin() returns boolean language sql stable as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='Admin')
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create trigger trg_profiles_set_worker_code before insert on public.profiles for each row execute function public.profiles_set_worker_code();
create trigger trg_profiles_block_worker_code_change before update on public.profiles for each row execute function public.profiles_block_worker_code_change();
create trigger trg_profiles_sync_worker after insert or update on public.profiles for each row execute function public.sync_worker_from_profile();
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_workers_updated_at before update on public.workers for each row execute function public.set_updated_at();
create trigger trg_accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger trg_work_items_updated_at before update on public.work_items for each row execute function public.set_updated_at();
create trigger trg_upi_configs_updated_at before update on public.upi_configs for each row execute function public.set_updated_at();
`;

async function createLegacyDatabase() {
  const connection = new PGlite();
  await connection.exec(legacySchema);
  await connection.query(`insert into auth.users(id,email,email_confirmed_at) values
    ($1,'worker@example.test',now()),($2,'other@example.test',now()),($3,'operator@example.test',now())`,[worker,other,admin]);
  await connection.query(`insert into public.profiles(id,worker_code,display_name) values
    ($1,'WKR-65','Legacy Worker'),($2,'WKR-64','Other Worker'),($3,'WKR-66','Operator')`,[worker,other,admin]);
  await connection.query(`insert into public.workers(id,name,email,auth_user_id) values
    ('WKR-0065','Legacy Worker','worker@example.test',$1),('WKR-0064','Other Worker','other@example.test',$2)`,[worker,other]);
  await connection.exec(`insert into public.accounts(id,handle,rules,allowed_audios,required_hashtags)
    values('legacy-account','@legacy',array['preserve caption','no restricted content'],array['audio-one'],array['#legacy','#work']);
    insert into public.assignments(workerid,accountid) values('WKR-0065','legacy-account');
    insert into public.worker_accounts(worker_id,account_id) values('WKR-65','legacy-account');
    insert into public.gigs(id,title,company,platform,workload,payout,payout_type,requirements)
    values('legacy-gig','Existing gig','Company','General','5','1000','Fixed',array['five verified accounts']);
    insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails)
    values('legacy-gig','WKR-65','legacy-main@example.test',array['legacy-second@example.test','legacy-third@example.test']);`);
  await connection.query(`insert into public.worker_account_assignments(worker_id,account_id,assigned_by,assigned_at)
    values($1,'legacy-account',$2,'2026-09-01T08:30:00Z')`,[worker,admin]);
  await connection.query(`insert into public.work_items(id,public_id,title,type,account_id,worker_id,created_by,due_at,reward_inr)
    values($1,'LEGACY-WORK','Existing work','Reel posting','legacy-account',$2,$3,'2026-09-30T12:00:00Z',1250)`,[legacyWork,worker,admin]);
  await connection.query(`insert into public.work_item_audit(work_item_id,at,by_profile,by_label,text)
    values($1,'2026-09-01T09:00:00Z',$2,'Legacy operator','Assigned before upgrade')`,[legacyWork,admin]);
  await connection.query(`insert into public.gig_applications(id,gig_id,worker_code,status)
    values($1,'legacy-gig','WKR-65','Applied')`,[legacyApplication]);
  await connection.query(`insert into public.worker_kyc(user_id,worker_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path)
    values($1,'WKR-65','approved','Legacy Worker','1990-01-02','1234567890','Legacy address','ID','TEST-123','legacy/id.pdf','legacy/selfie.png')`,[worker]);
  await connection.query(`insert into public.upi_configs(worker_id,upi_id,verified,verified_at)
    values($1,'legacy@bank',true,'2026-09-01T10:00:00Z')`,[worker]);
  await connection.query(`insert into public.payout_batches(id,worker_id,cycle_label,period_start,period_end,status)
    values($1,$2,'Historic manual payout','2026-08-01','2026-08-31','Failed')`,[legacyBatch,worker]);
  await connection.query(`insert into public.payout_items(id,batch_id,work_item_id,worker_id,amount_inr,status,reason)
    values($1,$2,null,$3,500,'Failed','Historic manual item')`,[legacyPayout,legacyBatch,worker]);
  await connection.exec(legacyHooks);
  return connection;
}

async function migrate(connection: PGlite) {
  const files = (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort();
  await connection.exec('begin');
  try {
    for (const file of files) await connection.exec(await readFile('supabase/migrations/'+file,'utf8'));
    await connection.exec('commit');
  } catch (error) {
    await connection.exec('rollback');
    throw error;
  }
}

async function scalar<T>(connection: PGlite, query: string, params: unknown[] = []) {
  return (await connection.query<{value:T}>(query,params)).rows[0]?.value;
}

let db: PGlite;
before(async () => { db=await createLegacyDatabase(); await migrate(db); });
after(async () => { await db?.close(); });

test('legacy worker aliases map to exact Auth identities without replacing worker history', async () => {
  assert.equal(await scalar<string>(db,'select worker_id::text as value from public.assignments'),worker);
  assert.equal(await scalar<string>(db,'select worker_id::text as value from public.worker_accounts'),worker);
  assert.equal(await scalar<string>(db,"select user_id::text as value from public.workers where id='WKR-0065'"),worker);
  assert.equal(await scalar<boolean>(db,"select created_at='2026-09-01T08:30:00Z'::timestamptz as value from public.worker_account_assignments"),true);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.workers'),2);
  assert.equal(await scalar<number>(db,"select count(*)::int as value from pg_constraint where conrelid='public.assignments'::regclass and contype='p'"),1);
  assert.equal(await scalar<number>(db,"select count(*)::int as value from pg_indexes where tablename='gig_applications' and indexname='gig_applications_unique'"),1);
});

test('legacy SQL arrays become JSON arrays while dates, enum labels and audit history survive', async () => {
  const account=(await db.query<{rules:string[];allowed_audios:string[];required_hashtags:string[]}>('select rules,allowed_audios,required_hashtags from public.accounts')).rows[0];
  assert.deepEqual(account.rules,['preserve caption','no restricted content']);
  assert.deepEqual(account.allowed_audios,['audio-one']);
  assert.deepEqual(account.required_hashtags,['#legacy','#work']);
  assert.deepEqual(await scalar<string[]>(db,'select assigned_emails as value from public.gig_assignments'),['legacy-second@example.test','legacy-third@example.test']);
  assert.deepEqual(await scalar<string[]>(db,'select requirements as value from public.gigs'),['five verified accounts']);
  assert.equal(await scalar<string>(db,'select dob::text as value from public.worker_kyc'),'1990-01-02');
  assert.equal(await scalar<string>(db,'select id::text as value from public.gig_applications'),legacyApplication);
  assert.equal(await scalar<string>(db,'select status as value from public.gig_applications'),'Applied');
  assert.equal(await scalar<string>(db,"select udt_name as value from information_schema.columns where table_name='profiles' and column_name='role'"),'text');
  assert.equal(await scalar<string>(db,"select udt_name as value from information_schema.columns where table_name='upi_configs' and column_name='payout_schedule'"),'text');
  assert.equal(await scalar<string>(db,'select created_by as value from public.work_items'),admin);
  const audit=(await db.query<{actor_id:string;created_at:Date;details:Record<string,string>}>('select actor_id,created_at,details from public.work_item_audit')).rows[0];
  assert.equal(audit.actor_id,admin);
  assert.equal(new Date(audit.created_at).toISOString(),'2026-09-01T09:00:00.000Z');
  assert.deepEqual(audit.details,{legacyText:'Assigned before upgrade',legacyActorLabel:'Legacy operator'});
  assert.deepEqual(await scalar<Record<string,string>>(db,'select payload as value from public."UnrelatedApplication"'),{source:'unrelated'});
  await assert.rejects(db.query("update public.profiles set role='Owner' where id=$1",[worker]),/legacy_role_check/);
});

test('historic failed payout with no work item is preserved exactly', async () => {
  const row=(await db.query<{id:string;batch_id:string;work_item_id:null;worker_id:string;amount_inr:string;status:string;reason:string}>(
    'select id,batch_id,work_item_id,worker_id,amount_inr,status,reason from public.payout_items where id=$1',[legacyPayout])).rows[0];
  assert.deepEqual(row,{id:legacyPayout,batch_id:legacyBatch,work_item_id:null,worker_id:worker,amount_inr:'500.00',status:'Failed',reason:'Historic manual item'});
  assert.equal(await scalar<string>(db,'select status as value from public.payout_batches where id=$1',[legacyBatch]),'Failed');
});

test('bootstrap, admin enrollment, work review and payout transactions work on upgraded legacy tables', async () => {
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',null)",[admin]);
  await db.query('select public.bootstrap_worker($1)',[worker]);
  await db.query('select public.bootstrap_worker($1)',[worker]);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.workers where user_id=$1',[worker]),1);
  assert.equal(await scalar<string>(db,'select worker_code as value from public.profiles where id=$1',[worker]),'WKR-65');
  assert.equal(await scalar<boolean>(db,'select public.app_is_admin($1) as value',[admin]),true);
  await db.query("select public.transition_work_item($1,'LEGACY-WORK','start','{}')",[worker]);
  await db.query("select public.transition_work_item($1,'LEGACY-WORK','submit',$2)",[worker,JSON.stringify({reelUrl:'https://example.test/reel',screenshotUrl:'https://example.test/proof'})]);
  await assert.rejects(db.query("select public.transition_work_item($1,'LEGACY-WORK','review','{\"status\":\"Approved\"}')",[worker]),/forbidden/);
  await db.query("select public.transition_work_item($1,'LEGACY-WORK','review','{\"status\":\"Approved\"}')",[admin]);
  const payout=await scalar<{batchId:string;itemCount:number}>(db,'select public.request_payout($1) as value',[worker]);
  assert.ok(payout);
  assert.equal(payout.itemCount,1);
  assert.equal(await scalar<string>(db,'select work_item_id::text as value from public.payout_items where batch_id=$1',[payout.batchId]),legacyWork);
  await db.query("select public.transition_payout($1,$2,'approve')",[admin,payout.batchId]);
  await db.query("select public.transition_payout($1,$2,'mark-paid','LEGACY-UPGRADE-UTR')",[admin,payout.batchId]);
  assert.equal(await scalar<string>(db,'select status as value from public.payout_batches where id=$1',[payout.batchId]),'Paid');
  assert.equal(await scalar<string>(db,'select status as value from public.payout_items where id=$1',[legacyPayout]),'Failed');
  assert.equal(await scalar<number>(db,'select public.reelencer_backend_version() as value'),3);
});

test('scheduling retries keep the original composite assignment keys usable', async () => {
  const schedule=JSON.stringify({times:['08:00','18:00'],days:[0,1,2,3,4,5,6],deadlineMin:180,timezone:'Asia/Kolkata'});
  await db.query("select public.schedule_account_work($1,$2,'legacy-account',$3,false,true)",[admin,worker,schedule]);
  await db.query("select public.schedule_account_work($1,$2,'legacy-account',$3,false,true)",[admin,worker,schedule]);
  for (const table of ['assignments','worker_account_assignments','worker_accounts']) {
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.'+table+" where worker_id=$1 and account_id='legacy-account'",[worker]),1);
  }
  assert.equal(await scalar<number>(db,"select count(*)::int as value from public.work_items where public_id like 'SCH-%'"),2);
  assert.equal(await scalar<string>(db,'select status as value from public.work_items where id=$1',[legacyWork]),'Approved');
});

test('upgraded Auth hooks support verified signups and explicit worker provisioning without granting metadata roles', async () => {
  const newcomer='88888888-8888-4888-8888-888888888888';
  await db.exec('set role supabase_auth_admin');
  try {
    await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
      values($1,'new-hook@example.test',now(),'{"name":"New Worker","role":"Admin"}')`,[newcomer]);
  } finally { await db.exec('reset role'); }
  assert.equal(await scalar<string>(db,'select role as value from public.profiles where id=$1',[newcomer]),'Worker');
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.workers where user_id=$1',[newcomer]),1);
  const code=await scalar<string>(db,'select worker_code as value from public.profiles where id=$1',[newcomer]);
  assert.ok(code && /^WKR-\d+$/.test(code));
  assert.ok(Number(code.slice(4))>=1001);
  await db.query("select public.provision_worker($1,$2,'HOOK-NEW','Provisioned Worker','new-hook@example.test',true)",[admin,newcomer]);
  assert.equal(await scalar<string>(db,'select worker_code as value from public.profiles where id=$1',[newcomer]),'HOOK-NEW');
  assert.equal(await scalar<string>(db,'select id as value from public.workers where user_id=$1',[newcomer]),'HOOK-NEW');
  assert.equal(await scalar<boolean>(db,'select public.app_is_admin($1) as value',[newcomer]),false);
  await db.query("update public.profiles set role='Admin' where id=$1",[newcomer]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[newcomer]);
  assert.equal(await scalar<boolean>(db,'select public.is_admin() as value'),false);
  await db.query("update public.profiles set role='Worker' where id=$1",[newcomer]);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query("update public.profiles set worker_code='SELF-PROMOTED' where id=$1",[newcomer]),/permission denied|immutable|forbidden/);
    assert.equal(await scalar<boolean>(db,'select public.is_admin() as value'),false);
  } finally { await db.exec('reset role'); }
  // Exercise the trigger itself even if an older installation accidentally
  // restores broad browser grants. The rejected write also rolls them back.
  await db.exec('begin');
  try {
    await db.exec(`grant update(worker_code) on public.profiles to authenticated;
      create policy legacy_guard_probe on public.profiles for update to authenticated
        using(id=auth.uid()) with check(id=auth.uid());
      set local role authenticated;`);
    await assert.rejects(db.query("update public.profiles set worker_code='SELF-PROMOTED' where id=$1",[newcomer]),/worker_code is immutable|forbidden/);
  } finally { await db.exec('rollback'); }
  assert.equal(await scalar<string>(db,'select worker_code as value from public.profiles where id=$1',[newcomer]),'HOOK-NEW');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  assert.equal(await scalar<boolean>(db,'select public.is_admin() as value'),true);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
});

test('upgraded legacy profile entry point requires a confirmed nonanonymous caller', async () => {
  const unconfirmed='99999999-9999-4999-8999-999999999999';
  const anonymous='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query(`insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    ($1,'unconfirmed@example.test',null,false),($2,'anonymous@example.test',now(),true)`,[unconfirmed,anonymous]);
  for (const id of [unconfirmed,anonymous]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await assert.rejects(db.query('select public.ensure_profile()'),/forbidden|authenticated/i);
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[worker]);
  await db.exec('set role authenticated');
  try {
    assert.equal(await scalar<string>(db,'select (public.ensure_profile()).id::text as value'),worker);
  } finally { await db.exec('reset role'); }
  await db.query("select set_config('request.jwt.claim.sub','',false)");
});

test('upgraded profile sync preserves inactive worker status and historic work', async () => {
  await db.query('update public.workers set active=false where user_id=$1',[other]);
  await db.query("update public.profiles set display_name='Edited while inactive' where id=$1",[other]);
  assert.equal(await scalar<boolean>(db,'select active as value from public.workers where user_id=$1',[other]),false);
  assert.equal(await scalar<string>(db,'select status as value from public.work_items where id=$1',[legacyWork]),'Approved');
  assert.equal(await scalar<string>(db,'select reason as value from public.payout_items where id=$1',[legacyPayout]),'Historic manual item');
});

test('legacy zero timing defaults allow adjusted view approval after migration and credit the wallet once', async () => {
  const connection = await createLegacyDatabase();
  try {
    // The hosted predecessor used zero defaults even though the upgraded
    // timing constraint requires positive values for every wallet ledger row.
    await connection.exec(`alter table public.work_items alter column est_minutes set default 0;
      alter table public.work_items alter column sla_minutes set default 0;`);
    await migrate(connection);
    await connection.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',null)", [admin]);
    await connection.exec(`insert into public.gigs(id,title,company,platform,workload,payout,payout_type)
      values('legacy-view-gig','View earnings','Company','Instagram','Reels','₹49','Per 1k Views');`);
    const application = await scalar<string>(connection, `insert into public.gig_applications(gig_id,worker_code,status)
      values('legacy-view-gig','WKR-65','Accepted') returning id as value`);
    const account = await scalar<string>(connection, `insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle)
      values($1,'legacy-view-gig','WKR-65','Instagram','legacyviewcreator') returning id as value`, [application]);
    const post = await scalar<string>(connection, `insert into public.social_account_posts(account_id,url,status,views,source)
      values($1,'https://www.instagram.com/reel/LEGACYVIEW/','approved',1012,'profile') returning id as value`, [account]);
    const claim = await scalar<{ id: string; amount_inr: number }>(connection, 'select public.submit_view_payout_claim($1,$2) as value', [worker, account]);
    assert.equal(claim.amount_inr, 49.59);
    const item = await scalar<string>(connection, 'select id as value from public.view_payout_claim_items where claim_id=$1', [claim.id]);
    const adjustments = [{ itemId: item, excludedViews: 100, reason: 'Review found artificial activity in the claimed views' }];
    const approve = () => scalar<{ status: string; work_item_id: string; approved_amount_inr: number; approved_views: number; deducted_views: number }>(connection,
      "select public.review_view_payout_claim_authenticity($1,$2,'Approved','Reviewed view history and excluded artificial traffic','mixed',$3) as value", [admin, claim.id, adjustments]);
    const credit = await approve();
    assert.equal(credit.status, 'Approved');
    assert.equal(credit.approved_amount_inr, 44.69);
    assert.equal(credit.approved_views, 912);
    assert.equal(credit.deducted_views, 100);
    assert.equal((await approve()).work_item_id, credit.work_item_id);
    const ledger = (await connection.query<{ reward_inr: string; est_minutes: number; sla_minutes: number }>(
      'select reward_inr,est_minutes,sla_minutes from public.work_items where id=$1', [credit.work_item_id])).rows[0];
    assert.deepEqual(ledger, { reward_inr: '44.69', est_minutes: 10, sla_minutes: 180 });
    assert.equal(await scalar<number>(connection, "select count(*)::int as value from public.work_items where review->>'claimId'=$1", [claim.id]), 1);
    assert.equal(await scalar<number>(connection, 'select views as value from public.social_account_posts where id=$1', [post]), 1012);
    const quote = await scalar<{ claimableViews: number }>(connection, 'select public.view_payout_quote($1,$2) as value', [worker, account]);
    assert.equal(quote.claimableViews, 0);
    assert.equal(await scalar<number>(connection, 'select reward_inr::int as value from public.work_items where id=$1', [legacyWork]), 1250, 'existing earnings are preserved');
    await assert.rejects(connection.query(`insert into public.work_items(public_id,worker_id,title,est_minutes,sla_minutes)
      values('INVALID-TIMING',$1,'Invalid timing',0,0)`, [worker]), /timing_check/);
  } finally { await connection.close(); }
});

test('orphan legacy account links remain in a private archive and never receive invented ownership', async () => {
  const connection=await createLegacyDatabase();
  try {
    await connection.exec(`alter table public.worker_accounts add column legacy_note text;
      update public.worker_accounts set legacy_note='Original valid alias';
      insert into public.worker_accounts(worker_id,account_id,legacy_note) values
        ('unknown-worker','legacy-account','Unknown owner'),
        ('WKR-65','missing-account','Missing account'),
        ('WKR-0065','legacy-account','Duplicate known identity');
      grant all on public.worker_accounts to anon,authenticated,service_role;`);
    const original=(await connection.query('select * from public.worker_accounts order by worker_id,account_id')).rows;
    await migrate(connection);
    assert.deepEqual((await connection.query('select * from public.legacy_worker_accounts order by worker_id,account_id')).rows,original);
    assert.deepEqual((await connection.query('select worker_id::text as worker_id,account_id from public.worker_accounts')).rows,
      [{worker_id:worker,account_id:'legacy-account'}]);
    assert.equal(await scalar<number>(connection,'select count(*)::int as value from public.profiles'),3);
    assert.equal(await scalar<number>(connection,'select count(*)::int as value from public.accounts'),1);
    assert.equal(await scalar<boolean>(connection,"select relrowsecurity as value from pg_class where oid='public.legacy_worker_accounts'::regclass"),true);
    for (const role of ['anon','authenticated']) {
      assert.equal(await scalar<boolean>(connection,'select has_table_privilege($1,\'public.legacy_worker_accounts\',\'select\') as value',[role]),false);
      assert.equal(await scalar<boolean>(connection,'select has_table_privilege($1,\'public.legacy_worker_accounts\',\'insert\') as value',[role]),false);
    }
    assert.equal(await scalar<boolean>(connection,"select has_table_privilege('service_role','public.legacy_worker_accounts','select') as value"),true);
    assert.equal(await scalar<boolean>(connection,"select has_table_privilege('service_role','public.legacy_worker_accounts','update') as value"),false);
  } finally { await connection.close(); }
});

test('historic KYC audit events keep deleted parents and actors while foreign keys reject new orphan events', async () => {
  const connection=await createLegacyDatabase();
  const deletedKyc='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const deletedActor='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  try {
    await connection.query(`insert into public.worker_kyc_events(kyc_id,status,note,actor_id,created_at)
      values($1,'rejected','Review before KYC cleanup',$2,'2026-08-01T09:00:00Z')`,[deletedKyc,deletedActor]);
    const original=(await connection.query('select * from public.worker_kyc_events')).rows;
    await migrate(connection);
    assert.deepEqual((await connection.query('select * from public.worker_kyc_events')).rows,original);
    assert.equal(await scalar<number>(connection,`select count(*)::int as value from pg_constraint
      where conrelid='public.worker_kyc_events'::regclass and contype='f' and not convalidated`),2);
    const existingKyc=await scalar<string>(connection,'select id::text as value from public.worker_kyc');
    await assert.rejects(connection.query(`insert into public.worker_kyc_events(kyc_id,status,actor_id)
      values($1,'approved',$2)`,[deletedKyc,admin]),/foreign key/);
    await assert.rejects(connection.query(`insert into public.worker_kyc_events(kyc_id,status,actor_id)
      values($1,'approved',$2)`,[existingKyc,deletedActor]),/foreign key/);
    await connection.query(`insert into public.worker_kyc_events(kyc_id,status,actor_id)
      values($1,'approved',$2)`,[existingKyc,admin]);
    assert.equal(await scalar<number>(connection,'select count(*)::int as value from public.worker_kyc_events'),2);
    assert.equal(await scalar<number>(connection,'select count(*)::int as value from public.worker_kyc'),1);
    assert.equal(await scalar<number>(connection,'select count(*)::int as value from auth.users'),3);
    assert.equal(await scalar<boolean>(connection,"select relrowsecurity as value from pg_class where oid='public.worker_kyc_events'::regclass"),true);
    assert.equal(await scalar<boolean>(connection,"select has_table_privilege('authenticated','public.worker_kyc_events','insert') as value"),false);
  } finally { await connection.close(); }
});

for (const ambiguity of [false,true]) {
  test(`legacy migration rejects ${ambiguity?'ambiguous':'unmapped'} assignment owners and rolls back every schema/data change`, async () => {
    const connection=await createLegacyDatabase();
    try {
      if (ambiguity) {
        // One legacy worker ID collides with another worker's profile code.
        await connection.query("update public.workers set id='WKR-65' where auth_user_id=$1",[other]);
        await connection.exec("update public.assignments set workerid='WKR-65'");
      } else {
        await connection.exec(`alter table public.assignments drop constraint assignments_workerid_fkey;
          update public.assignments set workerid='unknown-worker'`);
      }
      const original=(await connection.query<{worker_id:string}>('select worker_id from public.worker_accounts')).rows[0];
      const originalAssignment=await scalar<string>(connection,'select workerid as value from public.assignments');
      await assert.rejects(migrate(connection),/alias is missing or ambiguous/);
      assert.deepEqual((await connection.query('select worker_id from public.worker_accounts')).rows[0],original);
      assert.equal(await scalar<string>(connection,"select udt_name as value from information_schema.columns where table_name='profiles' and column_name='role'"),'role_type');
      assert.equal(await scalar<string>(connection,"select udt_name as value from information_schema.columns where table_name='gig_assignments' and column_name='assigned_emails'"),'_text');
      assert.equal(await scalar<string>(connection,'select workerid as value from public.assignments'),originalAssignment);
      assert.equal(await scalar<string>(connection,'select id::text as value from public.payout_items where work_item_id is null'),legacyPayout);
      assert.equal(await scalar<number>(connection,'select count(*)::int as value from public.profiles'),3);
      assert.equal(await scalar<number>(connection,"select count(*)::int as value from pg_policies where tablename='profiles' and policyname='legacy_admin_policy'"),1);
      assert.equal(await scalar<string|null>(connection,"select to_regclass('public.admin_owner')::text as value"),null);
    } finally { await connection.close(); }
  });
}
