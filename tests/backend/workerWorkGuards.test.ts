import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { realtimeTestSchema } from "./helpers/realtime";

const db = new PGlite();
const worker = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const schedule = { times: ["08:00"], days: [0, 1, 2, 3, 4, 5, 6], deadlineMin: 180, timezone: "Asia/Kolkata" };

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
  for (const file of (await readdir("supabase/migrations")).filter(file => file.endsWith(".sql")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  for (const [id, email] of [[worker, "worker@example.test"], [other, "other@example.test"], [admin, "operator@example.test"]]) {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, email]);
    await db.query("select public.bootstrap_worker($1)", [id]);
  }
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',null)", [admin]);
  await db.exec("insert into public.accounts(id,handle) values('account-suspended','suspended'),('account-active','active'); insert into public.gigs(id,title,company,workload,payout) values('gig-guard','Test','Test','Reels','49')");
  await db.query("insert into public.assignments(worker_id,account_id,schedule) values($1,'account-suspended',$3),($2,'account-active',$3)", [worker, other, schedule]);
  await db.query("select public.moderate_worker($1,$2,'suspend','Repeated policy violations')", [admin, worker]);
});
after(async () => { await db.close(); });

test("new work and account or gig assignments reject suspended workers while financial history remains writable", async () => {
  for (const table of ["assignments", "worker_account_assignments", "worker_accounts"]) {
    await assert.rejects(db.query(`insert into public.${table}(worker_id,account_id) values($1,'account-active')`, [worker]), /worker_inactive/);
  }
  await assert.rejects(db.query("insert into public.work_items(public_id,worker_id,title) values('WI-GUARD',$1,'Blocked planned work')", [worker]), /worker_inactive/);
  await assert.rejects(db.query("insert into public.gig_assignments(gig_id,worker_code,assigned_email) values('gig-guard',$1,'guard@example.test')", [worker]), /worker_inactive/);
  await db.query("insert into public.work_items(public_id,worker_id,title,status,reward_inr) values('WI-GUARD-CREDIT',$1,'Historical credit','Approved',250)", [worker]);
  const history = await db.query<{ status: string }>("select status from public.work_items where public_id='WI-GUARD-CREDIT'");
  assert.equal(history.rows[0].status, "Approved");
});

test("scheduled refresh skips retained suspended assignments and still schedules active creators", async () => {
  const result = await db.query<{ value: { created: number } }>("select public.schedule_all_work($1) as value", [admin]);
  assert.equal(result.rows[0].value.created, 2);
  const rows = await db.query<{ worker_id: string; count: number }>("select worker_id,count(*)::int as count from public.work_items where public_id like 'SCH-%' group by worker_id");
  assert.deepEqual(rows.rows, [{ worker_id: other, count: 2 }]);
  const kept = await db.query<{ count: number }>("select count(*)::int as count from public.assignments where worker_id=$1", [worker]);
  assert.equal(kept.rows[0].count, 1);
});

test("restoring access allows new work without modifying historical rewards", async () => {
  await db.query("select public.moderate_worker($1,$2,'restore','Appeal reviewed and approved')", [admin, worker]);
  await db.query("insert into public.work_items(public_id,worker_id,title) values('WI-GUARD-RESTORED',$1,'New work after appeal')", [worker]);
  const credits = await db.query<{ reward_inr: string }>("select reward_inr from public.work_items where public_id='WI-GUARD-CREDIT'");
  assert.equal(Number(credits.rows[0].reward_inr), 250);
});
