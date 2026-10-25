import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.linked_social_accounts(id uuid primary key default gen_random_uuid(), platform text not null, handle text default 'creator', status text default 'active', sync_status text default 'pending', last_synced_at timestamptz, linked_at timestamptz default now());
    create table public.social_account_snapshots(account_id uuid, captured_at timestamptz, source text);
    create table public.social_account_posts(id uuid);
    create function public.notify_admin_live() returns trigger language plpgsql as $$begin return null; end;$$;`);
  await db.exec(await readFile("supabase/migrations/202610250001_background_social_sync.sql", "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate public.linked_social_accounts"); });

async function insert(platform = "Instagram", status = "active", deadline = "2000-01-01T00:00:00Z") {
  return (await db.query<{ id: string }>("insert into public.linked_social_accounts(platform,status,next_sync_at) values($1,$2,$3) returning id", [platform, status, deadline])).rows[0].id;
}
const claim = async (id: string | null = null, force = false, youtube = false, limit = 2) => (await db.query<{ id: string; sync_lock_token: string }>("select * from public.claim_social_sync_accounts($1,$2,$3,$4)", [limit, id, force, youtube])).rows;

test("leases exclude duplicate claims, recover expired workers and fence late completions", async () => {
  const id = await insert();
  const [first] = await claim(id);
  assert.equal((await claim(id, true)).length, 0, "manual refresh cannot steal an active lease");
  await db.query("update public.linked_social_accounts set sync_locked_until=now()-interval '1 second' where id=$1", [id]);
  const [second] = await claim(id);
  assert.notEqual(first.sync_lock_token, second.sync_lock_token);
  assert.equal((await db.query("update public.linked_social_accounts set sync_status='ok' where id=$1 and sync_lock_token=$2 returning id", [id, first.sync_lock_token])).rows.length, 0);
  assert.equal((await db.query("update public.linked_social_accounts set sync_status='ok' where id=$1 and sync_lock_token=$2 returning id", [id, second.sync_lock_token])).rows.length, 1);
});

test("global deadline ordering reaches old accounts beyond page limits and excludes paused or unsupported platforms", async () => {
  await db.exec("insert into public.linked_social_accounts(platform,next_sync_at) select 'Instagram', '2100-01-01'::timestamptz from generate_series(1,550)");
  const newer = await insert("IG Reels", "active", "2001-01-01");
  const oldest = await insert("Instagram", "active", "2000-01-01");
  const paused = await insert("Instagram", "paused");
  await insert("Instagram", "unlinked");
  await insert("TikTok");
  const yt = await insert("YouTube Shorts");
  assert.deepEqual((await claim()).map(row => row.id), [oldest, newer]);
  assert.equal((await claim(paused, true)).length, 0);
  assert.equal((await claim(yt, false, false)).length, 0);
  assert.equal((await claim(yt, false, true))[0].id, yt);
});

test("future deadlines are respected, manual checks are scoped and browser roles cannot claim jobs", async () => {
  const id = await insert("Instagram", "active", "2100-01-01");
  assert.equal((await claim(id)).length, 0);
  assert.equal((await claim(null, true)).length, 0, "force cannot bypass the whole queue");
  assert.equal((await claim(id, true))[0].id, id);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(db.query("select * from public.social_sync_scheduler_state"), /permission denied/);
  } finally { await db.exec("reset role"); }
});
