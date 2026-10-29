import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The silent-removal migration against a stand-in for the creator live-update function, which records each ping.
const db = new PGlite();
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(), account_id uuid, status text default 'submitted', views integer, updated_at timestamptz default now());
    create table public.pings(post_id uuid);
    create function public.notify_creator_social_updates() returns trigger language plpgsql as $$
      begin insert into public.pings values(coalesce(new.id, old.id)); return null; end $$;
    create trigger creator_social_post_live_update after insert or update or delete on public.social_account_posts
      for each row execute function public.notify_creator_social_updates();
    alter table public.social_account_posts add column removed_at timestamptz, add column removed_by uuid, add column removal_reason text not null default '';`);
  await db.exec(await readFile("supabase/migrations/202610290003_silent_reel_removal.sql", "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate public.social_account_posts, public.pings"); });

const reel = async () => (await db.query<{ id: string }>("insert into public.social_account_posts(views) values(100) returning id")).rows[0].id;
const pings = async (id: string) => (await db.query<{ n: number }>("select count(*)::int as n from public.pings where post_id=$1", [id])).rows[0].n;
const remove = (id: string, silent: boolean) => db.query("update public.social_account_posts set status='rejected', removed_at=now(), removal_silent=$2 where id=$1", [id, silent]);

test("a silent removal doesn't ping the creator, an announced one does", async () => {
  const quiet = await reel();
  const told = await reel();
  await db.exec("truncate public.pings");
  await remove(quiet, true);
  await remove(told, false);
  assert.equal(await pings(quiet), 0);
  assert.equal(await pings(told), 1);
});

test("changes to a removed reel never ping, and restoring it does", async () => {
  const id = await reel();
  await remove(id, false);
  await db.exec("truncate public.pings");
  await db.query("update public.social_account_posts set views=900, removal_reason='Duplicate' where id=$1", [id]);
  assert.equal(await pings(id), 0);
  await db.query("update public.social_account_posts set removed_at=null, removal_silent=false, status='submitted' where id=$1", [id]);
  assert.equal(await pings(id), 1);
});

test("new reels, ordinary edits and deletes still ping", async () => {
  const id = await reel();
  await db.query("update public.social_account_posts set views=200 where id=$1", [id]);
  await db.query("delete from public.social_account_posts where id=$1", [id]);
  assert.equal(await pings(id), 3);
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from pg_trigger where tgname='creator_social_post_live_update'")).rows[0].n), 0);
});
