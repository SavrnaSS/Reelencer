import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Runs the real view payout migrations, then the tracking window, against a minimal schema.
const db = new PGlite();
const creator = "11111111-1111-4111-8111-111111111111";
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users(id) values('${creator}');
    create table public.profiles(id uuid primary key, worker_code text, active boolean default true, role text default 'worker');
    create table public.gigs(id text primary key, payout text, payout_type text);
    create table public.work_items(id uuid primary key default gen_random_uuid());
    create table public.audit_events(actor_id uuid, action text, resource_id text, details jsonb);
    create function public.app_is_admin(p uuid) returns boolean language sql as $$ select false $$;
    create table public.linked_social_accounts(id uuid primary key default gen_random_uuid(), gig_id text default 'gig', worker_code text default 'WKR-1', status text default 'active', linked_at timestamptz not null);
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(), account_id uuid references public.linked_social_accounts(id), url text default 'https://www.instagram.com/reel/x/', posted_at timestamptz, views integer, status text default 'submitted', source text default 'api', review_note text default '', reviewed_at timestamptz, updated_at timestamptz default now());
    insert into public.profiles(id,worker_code) values('${creator}','WKR-1');
    insert into public.gigs values('gig','₹50','per 1k views');`);
  for (const file of ["202610080007_view_payout_claims.sql", "202610080008_reel_view_freshness.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("drop trigger if exists social_account_posts_tracking_window on public.social_account_posts; truncate public.view_payout_claim_items, public.view_payout_claims, public.social_account_posts, public.linked_social_accounts cascade");
});

// Linked 29 Oct 2026, 13:22 India time: the window opens at 28 Oct 18:30 UTC.
const account = async () => (await db.query<{ id: string }>("insert into public.linked_social_accounts(linked_at) values('2026-10-29T07:52:00Z') returning id")).rows[0].id;
const post = async (accountId: string, postedAt: string | null, status = "submitted", views = 1000) =>
  (await db.query<{ id: string }>("insert into public.social_account_posts(account_id,posted_at,status,views,url) values($1,$2,$3,$4,$5) returning id", [accountId, postedAt, status, views, `https://www.instagram.com/reel/${Math.random()}/`])).rows[0].id;
const migrate = async () => db.exec(await readFile("supabase/migrations/202610290001_reel_tracking_window.sql", "utf8"));

test("the migration closes pending reels from before the linking day and keeps the rest", async () => {
  const id = await account();
  const old = await post(id, "2026-10-28T18:29:00Z");
  const sameDay = await post(id, "2026-10-29T03:00:00Z");
  const undated = await post(id, null);
  await migrate();
  const rows = new Map((await db.query<{ id: string; status: string; review_note: string }>("select id,status,review_note from public.social_account_posts")).rows.map((row) => [row.id, row]));
  assert.equal(rows.get(old)?.status, "rejected");
  assert.match(rows.get(old)!.review_note, /before this account was linked/);
  assert.equal(rows.get(sameDay)?.status, "submitted");
  assert.equal(rows.get(undated)?.status, "submitted");
});

test("reels from before linking can't be approved, in-window reels can", async () => {
  const id = await account();
  await migrate();
  const old = await post(id, "2026-10-20T00:00:00Z");
  const fresh = await post(id, "2026-10-30T00:00:00Z");
  await assert.rejects(db.query("update public.social_account_posts set status='approved' where id=$1", [old]), /reel_before_link/);
  await assert.rejects(post(id, "2026-10-01T00:00:00Z", "approved"), /reel_before_link/);
  await db.query("update public.social_account_posts set status='approved' where id=$1", [fresh]);
  await assert.rejects(db.query("update public.social_account_posts set posted_at='2026-10-01' where id=$1", [fresh]), /reel_before_link/, "moving an approved reel's date back is checked too");
});

test("view payout quotes and claims leave out reels from before linking", async () => {
  const id = await account();
  await post(id, "2026-10-30T00:00:00Z", "approved", 2000);
  await post(id, null, "approved", 1000);
  await post(id, "2026-10-01T00:00:00Z", "approved", 50000); // approved before this rule existed
  await migrate();
  const quote = (await db.query<{ q: { claimableViews: number; claimableINR: number } }>("select public.view_payout_quote($1,$2) as q", [creator, id])).rows[0].q;
  assert.equal(Number(quote.claimableViews), 3000);
  assert.equal(Number(quote.claimableINR), 150);
  const claim = (await db.query<{ c: { id: string; views: number } }>("select public.submit_view_payout_claim($1,$2) as c", [creator, id])).rows[0].c;
  assert.equal(Number(claim.views), 3000);
  assert.equal((await db.query("select 1 from public.view_payout_claim_items where claim_id=$1", [claim.id])).rows.length, 2);
});
