import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real migrations (view claims, tracking window, admin overview, removal) against a minimal schema.
const db = new PGlite();
const creator = "11111111-1111-4111-8111-111111111111";
const now = "2026-11-02T12:00:00Z";
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users(id) values('${creator}');
    create table public.profiles(id uuid primary key, worker_code text, active boolean default true, display_name text default 'Creator', email text, role text default 'Worker', created_at timestamptz default '2026-10-01');
    create table public.worker_moderation(user_id uuid, status text);
    create table public.worker_kyc(user_id uuid, status text default 'approved');
    create table public.gig_applications(id uuid default gen_random_uuid(), worker_code text, status text default 'Accepted', applied_at timestamptz);
    create table public.payout_batches(id uuid default gen_random_uuid(), worker_id uuid, status text default 'Paid', created_at timestamptz);
    create table public.gigs(id text primary key, payout text, payout_type text);
    create table public.work_items(id uuid primary key default gen_random_uuid());
    create table public.audit_events(actor_id uuid, action text, resource_id text, details jsonb);
    create function public.app_is_admin(p uuid) returns boolean language sql as $$ select false $$;
    create table public.linked_social_accounts(id uuid primary key default gen_random_uuid(), gig_id text default 'gig', worker_code text default 'WKR-1', status text default 'active', profile_health jsonb default '{}', linked_at timestamptz not null default '2026-10-29T07:52:00Z');
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(), account_id uuid references public.linked_social_accounts(id), url text, posted_at timestamptz, views integer, status text default 'submitted', source text default 'api', submitted_by_worker boolean default true, review_note text default '', reviewed_at timestamptz, created_at timestamptz default '2026-11-01T10:00:00Z', updated_at timestamptz default now());
    insert into public.profiles(id,worker_code) values('${creator}','WKR-1');
    insert into public.gigs values('gig','₹50','per 1k views');
    grant select on all tables in schema public to service_role;`);
  for (const file of ["202610080007_view_payout_claims.sql", "202610080008_reel_view_freshness.sql", "202610270002_admin_activity_overview.sql", "202610290001_reel_tracking_window.sql", "202610290002_reel_removal.sql"]) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate public.view_payout_claim_items, public.view_payout_claims, public.social_account_posts, public.linked_social_accounts cascade"); });

const account = async () => (await db.query<{ id: string }>("insert into public.linked_social_accounts default values returning id")).rows[0].id;
const reel = async (accountId: string, status = "approved", views = 2000) =>
  (await db.query<{ id: string }>("insert into public.social_account_posts(account_id,url,posted_at,status,views) values($1,$2,'2026-10-30',$3,$4) returning id", [accountId, `https://www.instagram.com/reel/${Math.random()}/`, status, views])).rows[0].id;
const remove = (id: string) => db.query("update public.social_account_posts set status='rejected', removed_at=now(), removed_by=$2, removal_reason='Duplicate' where id=$1", [id, creator]);

test("a removed reel can't be approved or queued again until it's restored", async () => {
  const id = await reel(await account(), "submitted");
  await remove(id);
  await assert.rejects(db.query("update public.social_account_posts set status='approved' where id=$1", [id]), /reel_removed/);
  await assert.rejects(db.query("update public.social_account_posts set status='submitted' where id=$1", [id]), /reel_removed/);
  await db.query("update public.social_account_posts set removed_at=null, removed_by=null, removal_reason='', status='submitted' where id=$1", [id]);
  await db.query("update public.social_account_posts set status='approved' where id=$1", [id]);
});

test("removed reels are left out of view payout quotes and claims", async () => {
  const id = await account();
  await reel(id, "approved", 2000);
  await remove(await reel(id, "approved", 90_000));
  const quote = (await db.query<{ q: { claimableViews: number } }>("select public.view_payout_quote($1,$2) as q", [creator, id])).rows[0].q;
  assert.equal(Number(quote.claimableViews), 2000);
  const claim = (await db.query<{ c: { views: number } }>("select public.submit_view_payout_claim($1,$2) as c", [creator, id])).rows[0].c;
  assert.equal(Number(claim.views), 2000);
});

test("the admin overview doesn't count removed reels as activity or waiting for review", async () => {
  const id = await account();
  await reel(id, "submitted");
  await remove(await reel(id, "submitted"));
  const data = (await db.query<{ d: { queues: { reels: number }; summary: { reels: number } } }>("select public.admin_activity_overview(7,$1) as d", [now])).rows[0].d;
  assert.equal(Number(data.queues.reels), 1);
  assert.equal(Number(data.summary.reels), 1);
});
