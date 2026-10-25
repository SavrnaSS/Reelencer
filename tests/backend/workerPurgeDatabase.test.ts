import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { realtimeTestSchema } from "./helpers/realtime";
import { purgeDeletedWorkers } from "../../lib/api/workerPurge";

const db = new PGlite();
const admin = "33333333-3333-4333-8333-333333333333";
async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> { return (await db.query<{ value: T }>(sql, params)).rows[0]?.value; }
async function user() {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.test`]);
  await db.query("select public.bootstrap_worker($1)", [id]);
  return id;
}
async function remove(id: string, age = "0 seconds") {
  const code = await scalar<string>("select worker_code as value from public.profiles where id=$1", [id]);
  await db.query("select public.moderate_worker($1,$2,'delete','Confirmed user deletion request',$3)", [admin, id, code]);
  if (age !== "0 seconds") await db.query("update public.worker_moderation set deleted_at=now()-$2::interval where user_id=$1", [id, age]);
  return code;
}
type Job = { id: string; user_id: string; lease_token: string; status: string; phase: string };
const claim = async () => (await db.query<Job>("select * from public.claim_worker_deletions(3)")).rows;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,version text,is_versioned boolean);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(realtimeTestSchema);
  for (const file of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort()) {
    if (file === "202610040007_admin_identity.sql") await db.exec("alter default privileges in schema public grant all on tables to anon,authenticated,service_role");
    try { await db.exec(await readFile("supabase/migrations/" + file, "utf8")); }
    catch (error) { throw new Error("Migration failed: " + file, { cause: error }); }
  }
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'operator@example.test',now())", [admin]);
  await db.query("select public.bootstrap_worker($1)", [admin]);
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Purge Admin',null)", [admin]);
});
after(async () => { await db.close(); });

test("seven full days are required, repeated deletion preserves its deadline, and restore cancels the job", async () => {
  const id = await user();
  const code = await remove(id);
  const initial = await scalar<string>("select purge_after::text as value from public.worker_deletion_jobs where user_id=$1", [id]);
  await db.query("select public.moderate_worker($1,$2,'delete','Same deletion request retried',$3)", [admin, id, code]);
  assert.equal(await scalar("select purge_after::text as value from public.worker_deletion_jobs where user_id=$1", [id]), initial);
  await db.query("update public.worker_moderation set deleted_at=now()-interval '168 hours'+interval '30 seconds' where user_id=$1", [id]);
  assert.equal((await claim()).length, 0);
  await assert.rejects(db.query("delete from auth.users where id=$1", [id]), /worker_purge_not_due/);
  await db.query("select public.moderate_worker($1,$2,'restore','Restoration requested before permanent deletion')", [admin, id]);
  assert.equal(await scalar("select count(*)::int as value from public.worker_deletion_jobs where user_id=$1", [id]), 0);
  assert.equal(await scalar("select active as value from public.profiles where id=$1", [id]), true);
  await remove(id);
  assert.ok(Date.parse(await scalar<string>("select purge_after::text as value from public.worker_deletion_jobs where user_id=$1", [id])) > Date.now() + 167 * 3_600_000);
});

test("exclusive claims recover expired workers, reject stale tokens and prevent restore once erasure starts", async () => {
  const id = await user();
  await remove(id, "8 days");
  const first = (await claim()).find(job => job.user_id === id)!;
  assert.ok(first?.lease_token);
  assert.equal((await claim()).some(job => job.user_id === id), false);
  await assert.rejects(db.query("select public.moderate_worker($1,$2,'restore','Restoration racing the permanent deletion')", [admin, id]), /worker_purge_started/);
  assert.equal(await scalar("select active as value from public.profiles where id=$1", [id]), false);
  await db.query("update public.worker_deletion_jobs set locked_until=now()-interval '1 second' where id=$1", [first.id]);
  const second = (await claim()).find(job => job.user_id === id)!;
  assert.notEqual(first.lease_token, second.lease_token);
  await assert.rejects(db.query("select * from public.worker_deletion_storage_batch($1,$2)", [first.id, first.lease_token]), /worker_purge_lease_lost/);
  assert.equal(await scalar("select public.retry_worker_deletion($1,$2,'auth_failed') as value", [first.id, first.lease_token]), false);
  const preview = await scalar<{ eligible: boolean; skipReason: string }[]>("select public.preview_workers_bulk($1,$2,'restore',null) as value", [admin, [id]]);
  assert.equal(preview[0].eligible, false);
  assert.match(preview[0].skipReason, /Permanent deletion/);
  await db.query("select public.prepare_worker_auth_deletion($1,$2)", [second.id, second.lease_token]);
  await db.query("delete from auth.users where id=$1", [id]);
  assert.equal(await scalar("select status as value from public.worker_deletion_jobs where id=$1", [second.id]), "completed");
});

test("storage inventory covers nested prefixes, exact legacy aliases, ownership and archived versions without matching peers", async () => {
  const id = await user();
  const peer = await user();
  const code = await remove(id, "8 days");
  const job = (await claim()).find(job => job.user_id === id)!;
  const files = [
    ["kyc", `kyc/${id}/id.pdf`, null, null, false],
    ["worker-profile-media", `presentation-video/${id}/thumbnails/nested/a.jpg`, null, null, false],
    ["arbitrary", "no-prefix/avatar.jpg", id, "v1", true],
    ["arbitrary", "no-prefix/avatar.jpg", id, "v2", true],
    ["legacy", `${code}/file.png`, null, null, false],
    ["kyc", `kyc/${peer}/id.pdf`, null, null, false],
    ["legacy", `${code}-OTHER/file.png`, null, null, false],
  ];
  for (const file of files) await db.query("insert into storage.objects(bucket_id,name,owner_id,version,is_versioned) values($1,$2,$3,$4,$5)", file);
  const inventory = await db.query("select * from public.worker_deletion_storage_batch($1,$2)", [job.id, job.lease_token]);
  assert.equal(inventory.rows.length, 5);
  await assert.rejects(db.query("select public.prepare_worker_auth_deletion($1,$2)", [job.id, job.lease_token]), /storage_remaining/);
  await db.query("select public.retry_worker_deletion($1,$2,'storage_failed')", [job.id, job.lease_token]);
});

test("browser roles cannot inspect or execute permanent deletion and administrators are protected", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select * from public.worker_deletion_jobs"), /permission denied/);
    await assert.rejects(claim(), /permission denied/);
  } finally { await db.exec("reset role"); }
  assert.equal((await claim()).some(job => job.user_id === admin), false);
});

test("the runner uses Storage APIs before Auth and its transaction erases owned app data while preserving another user", async () => {
  // Hold other fixture jobs so this run tests only its own account.
  await db.exec("update public.worker_deletion_jobs set next_attempt_at=now()+interval '1 day' where status<>'completed'");
  const id = await user(), peer = await user();
  const code = await scalar<string>("select worker_code as value from public.profiles where id=$1", [id]);
  const gig = randomUUID();
  await db.query("insert into public.gigs(id,title,company,workload,payout) values($1,'Purge fixture','Test','Reels','49')", [gig]);
  const application = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,worker_name) values($1,$2,'Private proposal') returning id as value", [gig, code]);
  const account = await scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle) values($1,$2,$3,'Instagram','privatecreator') returning id as value", [application, gig, code]);
  const post = await scalar<string>("insert into public.social_account_posts(account_id,url,views,status) values($1,'https://www.instagram.com/reel/ERASE/',100,'approved') returning id as value", [account]);
  const work = await scalar<string>("insert into public.work_items(public_id,worker_id,title,status,reward_inr) values($1,$2,'Private work','Approved',49) returning id as value", [randomUUID(), id]);
  const claimId = await scalar<string>("insert into public.view_payout_claims(account_id,worker_id,rate_inr,amount_inr,views,work_item_id) values($1,$2,49,4.9,100,$3) returning id as value", [account, id, work]);
  await db.query("insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at) values($1,$2,'reel',0,100,4.9,'profile',now())", [claimId, post]);
  await db.query("insert into public.social_account_snapshots(account_id,followers,source) values($1,42,'profile')", [account]);
  await db.query("insert into public.dashboard_feedback(user_id,worker_id,section,language_code,category,subject,message) values($1,$2,'accounts','en','other','Private feedback','Private message')", [id, code]);
  await db.query("insert into public.work_email_accounts(owner_user_id,email,local_part,domain,username) values($1,$2,'private','example.test','private')", [id, `inbox-${id}@example.test`]);
  await db.query("insert into storage.objects(bucket_id,name) values('worker-profile-media',$1)", [`presentation-video/${id}/clip.mp4`]);
  const operation = randomUUID();
  await db.query("insert into public.worker_bulk_operations(id,actor_id,request_hash,action,reason,result) values($1,$2,$3,'delete','Deletion batch fixture',$4)", [operation, admin, 'a'.repeat(64), JSON.stringify({ items: [{ userId: id, workerId: code, name: 'Private name', status: 'success' }, { userId: peer, workerId: peer, name: 'Peer', status: 'success' }], succeeded: 2, skipped: 0, failed: 0 })]);
  await remove(id, "8 days");
  let storageFailed = true;
  const calls: string[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    try {
      const query = `select * from public.${name}(${keys.map((key, index) => `${key}=>$${index + 1}`).join(',')})`;
      const rows = (await db.query<Record<string, unknown>>(query, Object.values(args))).rows;
      const data = ['prepare_worker_auth_deletion','retry_worker_deletion'].includes(name) ? rows[0]?.[name] : rows;
      return { data, error: null };
    } catch (error) { return { data: null, error: { code: 'P0001', message: (error as Error).message } }; }
  };
  const sb = {
    rpc,
    from: () => ({ upsert: async () => ({ error: null }), select: () => ({ eq: (_key: string, job: string) => ({ maybeSingle: async () => ({ data: (await db.query("select status from public.worker_deletion_jobs where id=$1", [job])).rows[0], error: null }) }) }) }),
    storage: { from: (bucket: string) => ({ remove: async (paths: (string | { path: string; versionId: string })[]) => {
      calls.push('storage');
      if (storageFailed) return { error: new Error('Temporary object-store outage') };
      for (const path of paths) await db.query("delete from storage.objects where bucket_id=$1 and name=$2", [bucket, typeof path === 'string' ? path : path.path]);
      return { error: null };
    } }) },
    auth: { admin: { deleteUser: async (target: string, soft: boolean) => {
      calls.push('auth'); assert.equal(soft, false);
      try { await db.query("delete from auth.users where id=$1", [target]); return { error: null }; }
      catch (error) { return { error }; }
    } } },
  };
  assert.equal((await purgeDeletedWorkers(sb as never)).retrying, 1);
  assert.deepEqual(calls, ['storage']);
  assert.equal(await scalar("select count(*)::int as value from public.gig_applications where id=$1", [application]), 1);
  await db.query("update public.worker_deletion_jobs set next_attempt_at=now() where user_id=$1", [id]);
  storageFailed = false;
  assert.equal((await purgeDeletedWorkers(sb as never)).completed, 1);
  assert.deepEqual(calls, ['storage','storage','auth']);
  for (const [table, column, key] of [
    ['profiles','id',id],['workers','user_id',id],['gig_applications','id',application],['linked_social_accounts','id',account],
    ['social_account_posts','id',post],['social_post_measurements','post_id',post],['social_account_snapshots','account_id',account],
    ['work_items','id',work],['view_payout_claims','id',claimId],['view_payout_claim_items','claim_id',claimId],
    ['dashboard_feedback','user_id',id],['work_email_accounts','owner_user_id',id],['worker_moderation','user_id',id],['worker_moderation_events','user_id',id],
  ]) assert.equal(await scalar(`select count(*)::int as value from public.${table} where ${column}=$1`, [key]), 0, table);
  assert.equal(await scalar("select count(*)::int as value from auth.users where id=$1", [id]), 0);
  assert.equal(await scalar("select count(*)::int as value from public.profiles where id=$1", [peer]), 1);
  const saved = await scalar<{ items: { userId: string }[] }>("select result as value from public.worker_bulk_operations where id=$1", [operation]);
  assert.deepEqual(saved.items.map(item => item.userId), [peer]);
  const finished = await db.query<{ user_id: string | null; aliases: string[]; status: string }>("select user_id,aliases,status from public.worker_deletion_jobs where status='completed' order by completed_at desc limit 1");
  assert.equal(finished.rows[0].user_id, null);
  assert.deepEqual(finished.rows[0].aliases, []);
});
