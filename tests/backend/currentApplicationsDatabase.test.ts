import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { encodeWorkerName } from "../../lib/api/gigApplications";
import { realtimeTestSchema } from "./helpers/realtime";

const db = new PGlite();
const admin = "33333333-3333-4333-8333-333333333333";
const owner = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
let code = "", peerCode = "";
const visible = async () => (await db.query<{ worker_code: string }>("select worker_code from public.current_gig_applications order by worker_code")).rows.map(row => row.worker_code);

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
  for (const file of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort()) await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  for (const [id, email] of [[owner, "owner@example.test"], [peer, "peer@example.test"], [admin, "operator@example.test"]]) {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, email]);
    await db.query("select public.bootstrap_worker($1)", [id]);
  }
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Test Admin',null)", [admin]);
  code = (await db.query<{ worker_code: string }>("select worker_code from public.profiles where id=$1", [owner])).rows[0].worker_code;
  peerCode = (await db.query<{ worker_code: string }>("select worker_code from public.profiles where id=$1", [peer])).rows[0].worker_code;
  await db.exec("insert into public.gigs(id,title,company,workload,payout) values('gig-current','Current applications','Test','Reels','49')");
  const aliases = [code, owner, "OWNER@example.test", "legacy-uri", "legacy-base64"];
  for (const alias of aliases) {
    const name = alias === "legacy-base64" ? "__REELENCER_PROPOSAL__:" + Buffer.from(JSON.stringify({ workerName: "Owner", workerUserId: owner })).toString("base64") : encodeWorkerName("Owner नमस्ते", { pitch: "Retained proposal" }, { workerUserId: owner });
    await db.query("insert into public.gig_applications(gig_id,worker_code,worker_name) values('gig-current',$1,$2)", [alias, name]);
  }
  await db.query("insert into public.gig_applications(gig_id,worker_code,worker_name) values('gig-current',$1,$2)", [peerCode, encodeWorkerName("Peer", {}, { workerUserId: owner })]);
  await db.exec("insert into public.gig_applications(gig_id,worker_code,worker_name) values('gig-current','unowned-orphan','Malformed legacy record')");
});
after(async () => { await db.close(); });

test("current applications resolve canonical and legacy identities but keep unowned historical rows outside the queue", async () => {
  assert.equal((await visible()).length, 6);
  assert.ok(!(await visible()).includes("unowned-orphan"));
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.gig_applications")).rows[0].count, 7);
});

test("weekly quota counts legacy application owners once per gig without trusting spoofed payloads", async () => {
  const quota = async (user: string) => (await db.query<{ value: { used: number; remaining: number; gigs: { gigId: string }[] } }>("select public.gig_application_quota($1) as value", [user])).rows[0].value;
  assert.equal((await quota(owner)).used, 1, "five aliases for the same gig use one slot");
  assert.equal((await quota(peer)).used, 1, "canonical peer ownership overrides the encoded owner");
  await db.query("update public.workers set id='QUOTA-LEGACY' where user_id=$1", [owner]);
  await db.exec("insert into public.gigs(id,title,company,workload,payout,gig_type) values('quota-legacy','Legacy quota','Test','Reels','49','Content Creator'),('quota-third','Third gig','Test','Reels','49','Content Creator')");
  await db.exec("insert into public.gig_applications(gig_id,worker_code) values('quota-legacy','QUOTA-LEGACY')");
  assert.equal((await quota(owner)).used, 2);
  assert.equal((await quota(owner)).remaining, 0);
  await assert.rejects(db.query("select public.submit_gig_application($1,$1,'quota-third','Owner')", [owner]), /weekly_application_limit/);
  assert.equal((await quota(peer)).used, 1);
  // Keep this fixture scoped so later visibility tests retain their original row counts.
  await db.exec("delete from public.gig_applications where gig_id='quota-legacy'");
  await db.query("update public.workers set id=$2 where user_id=$1", [owner, code]);
});

test("bio evidence updates preserve decision dates, stale-update protection and application ownership", async () => {
  type ApplicationRow = { id: string; status: string; worker_name: string; decided_at: string | null };
  const load = async () => (await db.query<{ row: ApplicationRow }>("select to_jsonb(a) as row from public.gig_applications a where worker_code=$1", [code])).rows[0].row;
  const update = async (actor: string, expected: ApplicationRow, name: string, status: string) => (await db.query<{ row: ApplicationRow }>("select public.update_gig_application($1,$2,$3,$4,$5) as row", [actor, expected.id, expected, name, status])).rows[0].row;
  const original = await load();
  try {
    const pending = await update(admin, original, "New bio evidence", "Pending");
    assert.equal(pending.decided_at, null, "An evidence refresh is not a review decision");
    const approved = await update(admin, pending, "Approved account", "Accepted");
    assert.ok(approved.decided_at, "A status transition still records a decision");
    await db.query("update public.gig_applications set decided_at='2026-01-01T12:00:00Z' where id=$1", [original.id]);
    const beforeRefresh = await load();
    const refreshed = await update(admin, beforeRefresh, "Refreshed biography", "Accepted");
    assert.equal(refreshed.status, "Accepted");
    assert.equal(refreshed.decided_at, beforeRefresh.decided_at, "The original approval date must survive bio rechecks");
    await assert.rejects(update(admin, beforeRefresh, "Stale evidence", "Accepted"), /invalid_transition/);
    await assert.rejects(update(peer, refreshed, "Other worker", "Accepted"), /not_found/);
    await assert.rejects(update(owner, refreshed, "Reopen review", "Pending"), /forbidden/);
  } finally {
    await db.query("update public.gig_applications set worker_name=$2,status=$3,decided_at=$4 where id=$1", [original.id, original.worker_name, original.status, original.decided_at]);
  }
});

test("deletion hides every application alias immediately without removing retained records or another user's application", async () => {
  await db.query("select public.moderate_worker($1,$2,'delete','User requested account deletion',$3)", [admin, owner, code]);
  assert.deepEqual(await visible(), [peerCode], "An existing canonical owner wins over stale or spoofed encoded metadata");
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.gig_applications")).rows[0].count, 7);
  const due = (await db.query<{ hours: number }>("select extract(epoch from(purge_after-requested_at))/3600 as hours from public.worker_deletion_jobs where user_id=$1", [owner])).rows[0];
  assert.equal(Number(due.hours), 168, "Visibility changes never shorten the restore window");
});

test("stale application updates and new submissions for deleted owners are rejected atomically", async () => {
  const row = (await db.query<{ id: string; expected: object }>("select id,to_jsonb(a) as expected from public.gig_applications a where worker_code=$1", [code])).rows[0];
  await assert.rejects(db.query("select public.update_gig_application($1,$2,$3,'Stale recruiter note','Rejected')", [admin, row.id, row.expected]), /worker_deleted/);
  await assert.rejects(db.query("insert into public.gig_applications(gig_id,worker_code,worker_name) values('gig-current','new-legacy',$1)", [encodeWorkerName("Owner", {}, { workerUserId: owner })]), /worker_deleted/);
  assert.equal((await db.query<{ status: string }>("select status from public.gig_applications where id=$1", [row.id])).rows[0].status, "Pending");
});

test("restoration reveals the original applications and suspension does not count as deletion", async () => {
  await db.query("select public.moderate_worker($1,$2,'restore','Account restored before cleanup')", [admin, owner]);
  assert.equal((await visible()).length, 6);
  await db.query("select public.moderate_worker($1,$2,'suspend','Account temporarily under review')", [admin, owner]);
  assert.equal((await visible()).length, 6);
});

test("the filtered view and identity resolver remain service-only", async () => {
  const result = await db.query<{ role: string; can_read: boolean; can_resolve: boolean }>("select r as role,has_table_privilege(r,'public.current_gig_applications','SELECT') as can_read,has_function_privilege(r,'public.application_worker_identity(text,text)','EXECUTE') as can_resolve from unnest(array['anon','authenticated','service_role']) r");
  assert.deepEqual(result.rows, [{ role: "anon", can_read: false, can_resolve: false }, { role: "authenticated", can_read: false, can_resolve: false }, { role: "service_role", can_read: true, can_resolve: true }]);
});
