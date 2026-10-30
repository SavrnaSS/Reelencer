import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const admin = "11111111-1111-4111-8111-111111111111";
const worker = "22222222-2222-4222-8222-222222222222";
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(),views integer,views_source text,views_captured_at timestamptz,
      views_pinned boolean default false,synced_views integer,synced_views_at timestamptz,updated_by uuid,updated_at timestamptz,removed_at timestamptz,status text default 'approved',reviewed_at timestamptz,
      likes integer,comments integer,posted_at timestamptz,caption text default '');
    create table public.audit_events(actor_id uuid,action text,resource_id text,details jsonb);
    create function public.app_is_admin(actor uuid) returns boolean language sql as $$select actor='${admin}'::uuid$$;
    insert into public.social_account_posts(views,views_source,synced_views,synced_views_at) values(921,'profile',2017,'2026-10-30T08:53:00Z'),(400,'manual',2017,'2026-10-30T08:53:00Z');`);
  await db.exec(await readFile("supabase/migrations/202610300006_runtime_safe_reel_metrics.sql", "utf8"));
});
after(async () => { await db.close(); });
const row = async (id: string) => (await db.query<{ views: number | null; views_source: string; views_pinned: boolean; synced_views: number; status: string; reviewed_at: Date | null; views_captured_at: Date | null }>("select * from public.social_account_posts where id=$1", [id])).rows[0];
const insert = async (views = 2017, pinned = false, synced = views) => (await db.query<{ id: string }>("insert into public.social_account_posts(views,views_source,views_pinned,synced_views,views_captured_at,synced_views_at,reviewed_at) values($1,$2,$3,$4,'2026-10-30T08:53:00Z','2026-10-30T08:53:00Z','2026-10-29T08:00:00Z') returning id", [views, pinned ? "manual" : "profile", pinned, synced])).rows[0].id;

test("migration repairs a proven stale automatic reading without changing manual values", async () => {
  const values = (await db.query<{ views: number; views_source: string }>("select views,views_source from public.social_account_posts order by views_source")).rows;
  assert.deepEqual(values, [{ views: 400, views_source: "manual" }, { views: 2017, views_source: "profile" }]);
});

test("an older worker cannot replace 2017 views with 921, clear the count or lower its public high-water mark", async () => {
  const id = await insert();
  const before = await row(id);
  await db.query("update public.social_account_posts set views=921,views_source='profile',views_captured_at=now(),updated_at=now() where id=$1", [id]);
  assert.equal((await row(id)).views, 2017);
  assert.deepEqual((await row(id)).views_captured_at, before.views_captured_at);
  await db.query("update public.social_account_posts set views=null,synced_views=921,views_source='api' where id=$1", [id]);
  const after = await row(id);
  assert.equal(after.views, 2017);
  assert.equal(after.synced_views, 2017);
  assert.equal(after.status, before.status);
  assert.deepEqual(after.reviewed_at, before.reviewed_at);
});

test("new higher direct readings advance views and the saved public high-water mark", async () => {
  const id = await insert();
  await db.query("update public.social_account_posts set views=2100,views_source='profile',views_captured_at=now() where id=$1", [id]);
  assert.equal((await row(id)).views, 2100);
  assert.equal((await row(id)).synced_views, 2100);
});

test("atomic sync returns the effective guarded value for account snapshots", async () => {
  const id = await insert(400, false, 2017);
  await db.query("update public.social_account_posts set views_source='manual' where id=$1", [id]);
  const result = await db.query<{ value: { views: number } }>("select public.apply_synced_post_metrics($1,1200,null,null,'profile',now()) as value", [id]);
  assert.equal(result.rows[0].value.views, 2017);
  assert.equal((await row(id)).views, 2017);
});

test("legacy writers cannot change pinned counts, while explicit manual edits and resume remain possible", async () => {
  const id = await insert(901, true, 1200);
  await db.query("update public.social_account_posts set views=2003,views_source='profile',views_pinned=false,views_captured_at=now() where id=$1", [id]);
  assert.equal((await row(id)).views, 901);
  assert.equal((await row(id)).views_pinned, true);
  assert.equal((await row(id)).synced_views, 2003);
  await db.query("update public.social_account_posts set views=400,views_source='manual' where id=$1", [id]);
  assert.equal((await row(id)).views, 400);
  await assert.rejects(db.query("select public.resume_social_post_live_views($1,$2)", [worker, id]), /forbidden/);
  await db.query("select public.resume_social_post_live_views($1,$2)", [admin, id]);
  assert.equal((await row(id)).views, 2003);
  assert.equal((await row(id)).views_pinned, false);
  await db.query("update public.social_account_posts set views=500,views_source='profile' where id=$1", [id]);
  assert.equal((await row(id)).views, 2003, "the explicit override is reset before the next write");
});

test("resuming explicitly can lower a team-pinned estimate to its verified public reading", async () => {
  const id = await insert(5000, true, 1200);
  await db.query("select public.resume_social_post_live_views($1,$2)", [admin, id]);
  assert.equal((await row(id)).views, 1200);
  assert.equal((await row(id)).views_pinned, false);
});
