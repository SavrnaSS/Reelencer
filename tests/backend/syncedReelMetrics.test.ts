import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { adaptiveSyncInterval, HOT_REEL_SYNC_INTERVAL_MS, PROFILE_SYNC_INTERVAL_MS, QUIET_PROFILE_SYNC_INTERVAL_MS, API_SYNC_INTERVAL_MS, storedSyncState, syncPresentation } from "../../lib/socialSyncSchedule";
import { mergeSyncedCount } from "../../lib/api/socialSync";

// The monotonic sync merge (202610300004) against a minimal posts table.
const db = new PGlite();
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(), caption text default '', posted_at timestamptz,
      views integer, views_captured_at timestamptz, views_source text, likes integer, comments integer, removed_at timestamptz, updated_at timestamptz default now());`);
  await db.exec(await readFile("supabase/migrations/202610300004_synced_reel_metrics.sql", "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate public.social_account_posts"); });

const at = "2026-10-30T10:00:00Z";
const reel = async (values = "views, views_source, views_captured_at, likes", row = "901, 'manual', '2026-10-30T09:00:00Z', 38") =>
  (await db.query<{ id: string }>(`insert into public.social_account_posts(${values}) values(${row}) returning id`)).rows[0].id;
const apply = async (id: string, views: number | null, likes: number | null = null) =>
  (await db.query<{ value: { views: number; changed: boolean } | null }>("select public.apply_synced_post_metrics($1,$2,$3,null,'profile',$4) as value", [id, views, likes, at])).rows[0].value;
const read = async (id: string) => (await db.query<{ views: number; views_source: string; likes: number; updated_at: Date }>("select views, views_source, likes, updated_at from public.social_account_posts where id=$1", [id])).rows[0];

test("a lower public reading never replaces the team's number", async () => {
  const id = await reel();
  const before = await read(id);
  assert.deepEqual(await apply(id, 850, 30), { views: 901, changed: false });
  const after = await read(id);
  assert.equal(after.views, 901);
  assert.equal(after.views_source, "manual");
  assert.equal(after.likes, 38);
  assert.equal(after.updated_at.getTime(), before.updated_at.getTime(), "an unchanged reading writes nothing, so nobody is pinged");
});

test("a reading at least as high takes over and is stamped with its source and time", async () => {
  const id = await reel();
  assert.deepEqual(await apply(id, 1200, 41), { views: 1200, changed: true });
  const after = await read(id);
  assert.equal(after.views, 1200);
  assert.equal(after.views_source, "profile");
  assert.equal(after.likes, 41);
});

test("first readings fill empty counts, and removed reels are left alone", async () => {
  const empty = await reel("caption", "''");
  assert.deepEqual(await apply(empty, 10), { views: 10, changed: true });
  const removed = await reel("views, removed_at", "5, now()");
  assert.equal(await apply(removed, 99), null);
  assert.equal((await read(removed)).views, 5);
});

test("the in-app fallback applies the same rule", () => {
  assert.equal(mergeSyncedCount(901, 850), undefined);
  assert.equal(mergeSyncedCount(901, 901), 901);
  assert.equal(mergeSyncedCount(null, 3), 3);
  assert.equal(mergeSyncedCount(5, undefined), undefined);
});

test("fresh reels are checked more often, quiet profiles less", () => {
  const now = Date.parse(at);
  const daysAgo = (days: number) => now - days * 86_400_000;
  assert.equal(adaptiveSyncInterval("Instagram", daysAgo(1), now), HOT_REEL_SYNC_INTERVAL_MS);
  assert.equal(adaptiveSyncInterval("Instagram", daysAgo(7), now), PROFILE_SYNC_INTERVAL_MS);
  assert.equal(adaptiveSyncInterval("Instagram", daysAgo(40), now), QUIET_PROFILE_SYNC_INTERVAL_MS);
  assert.equal(adaptiveSyncInterval("Instagram", undefined, now), PROFILE_SYNC_INTERVAL_MS);
  assert.equal(adaptiveSyncInterval("YouTube", daysAgo(1), now), API_SYNC_INTERVAL_MS);
});

test("an account checked on a quiet schedule still reads as up to date", () => {
  const now = Date.parse(at);
  const sync = storedSyncState({ status: "active", sync_status: "ok", last_synced_at: new Date(now - 10 * 60_000).toISOString(), next_sync_at: new Date(now + 5 * 60_000).toISOString() });
  assert.equal(syncPresentation({ status: "active", platform: "Instagram", sync }, now).label, "Up to date");
});

test("embed and reel-page readings keep the higher count of each metric", async () => {
  const { mergeReelReadings } = await import("../../lib/api/instagramProfile");
  const embed = { externalId: "ig:A", url: "https://www.instagram.com/reel/A/", views: 907, likes: 39, comments: 1 };
  const page = { externalId: "ig:A", url: "https://www.instagram.com/reel/A/", likes: 38, comments: 2, caption: "Hi" };
  assert.deepEqual(mergeReelReadings(embed, page), { ...embed, caption: "Hi", likes: 39, comments: 2 });
  assert.equal(mergeReelReadings(undefined, page), page);
});
