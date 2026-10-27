import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const missing = { status: "missing", missingChecks: 2, removedAt: "2026-10-27T00:00:00Z" };
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.linked_social_accounts(id uuid primary key default gen_random_uuid(), application_id uuid default gen_random_uuid(), gig_id text default 'gig', worker_code text default 'WKR-1', platform text default 'Instagram', handle text default 'creator', profile_url text default 'https://www.instagram.com/creator/', status text default 'unlinked', external_id text, linked_by uuid, updated_at timestamptz default now(), sync_status text default 'error', sync_error text default 'not found', sync_error_code text default 'not_found', sync_failures integer default 2, sync_locked_until timestamptz, sync_lock_token uuid, next_sync_at timestamptz);
    create table public.social_account_posts(id uuid primary key default gen_random_uuid(), account_id uuid references public.linked_social_accounts(id), views integer, status text);
    create table public.social_account_snapshots(account_id uuid references public.linked_social_accounts(id), followers integer);`);
  await db.exec(await readFile("supabase/migrations/202610270001_social_profile_recovery.sql", "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate public.social_account_posts,public.social_account_snapshots,public.linked_social_accounts"); });
const insert = async (handle = "creator", worker = "WKR-1", status = "unlinked", health = missing) => (await db.query<{ id: string; application_id: string }>("insert into public.linked_social_accounts(handle,worker_code,status,profile_health) values($1,$2,$3,$4::jsonb) returning id,application_id", [handle,worker,status,JSON.stringify(health)])).rows[0];
const change = async (id: string, restore = false, handle = "creator.fixed", expected: unknown = missing, health: unknown = restore ? { status: "healthy", missingChecks: 0 } : { ...missing, recovery: { handle: "creator.fixed" } }, worker = "WKR-1") => {
  const result = await db.query<{ account: Record<string, unknown> }>("select public.update_social_profile_recovery($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7,null,null) as account", [id,JSON.stringify(expected),JSON.stringify(health),worker,restore,handle,`https://www.instagram.com/${handle}/`]);
  return { rows: result.rows.map(row => row.account) };
};

test("recovery corrects the same account row while retaining reels and snapshots", async () => {
  const account = await insert();
  await db.query("insert into public.social_account_posts(account_id,views,status) values($1,1234,'approved')", [account.id]);
  await db.query("insert into public.social_account_snapshots(account_id,followers) values($1,99)", [account.id]);
  const row = (await change(account.id, true)).rows[0];
  assert.equal(row.id, account.id);
  assert.equal(row.status, "active");
  assert.equal(row.handle, "creator.fixed");
  assert.equal(row.sync_error, "");
  assert.equal(row.sync_status, "pending");
  assert.ok(row.next_sync_at);
  assert.equal((await db.query("select * from public.social_account_posts")).rows.length, 1);
  assert.equal((await db.query("select * from public.social_account_snapshots")).rows.length, 1);
});

test("stale attempts, manual unlinks and owner changes cannot restore a profile", async () => {
  const a = await insert();
  await change(a.id);
  await assert.rejects(change(a.id, true), /invalid_transition/);
  const b = await insert("manual", "WKR-1", "unlinked", {} as typeof missing);
  await assert.rejects(change(b.id, true, "manual", {}), /invalid_transition/);
  const c = await insert("someone", "WKR-2");
  await assert.rejects(change(c.id, true), /invalid_transition/);
});

test("restoration checks duplicate profiles and capacity in the database", async () => {
  const a = await insert();
  await insert("creator.fixed", "WKR-2", "active");
  await assert.rejects(change(a.id, true), /profile_already_linked/);
  await db.exec("delete from public.linked_social_accounts where status='active'");
  for (let i = 0; i < 3; i++) {
    const b = await insert(`full${i}`, "WKR-1", "active");
    await db.query("update public.linked_social_accounts set application_id=$1 where id=$2", [a.application_id,b.id]);
  }
  await assert.rejects(change(a.id, true), /profile_account_limit/);
});

test("browser roles cannot call the recovery transaction", async () => {
  const a = await insert();
  await db.exec("set role authenticated");
  try { await assert.rejects(change(a.id, true), /permission denied/); }
  finally { await db.exec("reset role"); }
});
