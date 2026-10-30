import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const creator = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
before(async () => {
  await db.exec(`create role anon; create role authenticated;
    create table public.profiles(id uuid primary key, active boolean default true);
    create table public.upi_configs(worker_id uuid primary key references public.profiles(id),upi_id text not null,verified boolean default false,verified_at timestamptz,verified_by uuid,payout_schedule text default 'Weekly',payout_day text default 'Fri');
    create table public.payout_batches(worker_id uuid,status text);
    create table public.audit_events(actor_id uuid,action text,resource_id text,details jsonb);
    create function public.app_is_admin(actor uuid) returns boolean language sql as $$ select actor='${admin}'::uuid $$;
    insert into public.profiles(id) values('${creator}');
    insert into public.upi_configs(worker_id,upi_id) values('${creator}','historical@bank');`);
  const transactions = await readFile("supabase/migrations/202610040004_transactions.sql", "utf8");
  for (const name of ["save_upi_config", "verify_upi_config"]) {
    const sql = transactions.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end; \\$\\$;`));
    assert.ok(sql); await db.exec(sql[0]);
  }
  await db.exec(await readFile("supabase/migrations/202610300003_upi_submission_timestamp.sql", "utf8"));
});
after(async () => { await db.close(); });
const config = async () => (await db.query<{ upi_id: string; verified: boolean; verified_at: Date | null; updated_at: Date | null }>("select * from public.upi_configs where worker_id=$1", [creator])).rows[0];

test("historical save times remain unknown; saves, review and address changes stay atomic", async () => {
  assert.equal((await config()).updated_at, null);
  const save = await db.query<{ value: { updated_at: string } }>("select public.save_upi_config($1,'current@bank','Weekly','Fri') as value", [creator]);
  assert.ok(save.rows[0].value.updated_at);
  const saved = await config();
  assert.ok(saved.updated_at);
  await db.query("select public.verify_upi_config($1,$2,'current@bank',true)", [admin, creator]);
  const verified = await config();
  assert.equal(verified.verified, true);
  assert.deepEqual(verified.updated_at, saved.updated_at, "review does not reset submission age");
  await db.query("select public.save_upi_config($1,'current@bank','Weekly','Fri')", [creator]);
  assert.deepEqual((await config()).updated_at, saved.updated_at, "unchanged saves do not jump the queue");
  assert.equal((await config()).verified, true);
  await db.query("select public.save_upi_config($1,'current@bank','Weekly','Mon')", [creator]);
  assert.equal((await config()).verified, true, "schedule changes retain verification of the same UPI");
  assert.ok((await config()).updated_at! >= saved.updated_at!);
  await db.query("select public.save_upi_config($1,'replacement@bank','Weekly','Mon')", [creator]);
  const changed = await config();
  assert.equal(changed.verified, false);
  assert.equal(changed.verified_at, null);
  await assert.rejects(db.query("select public.verify_upi_config($1,$2,'current@bank',true)", [admin, creator]), /invalid_transition/);
  assert.equal((await config()).verified, false, "stale admin review cannot verify a replacement address");
  assert.deepEqual((await config()).updated_at, changed.updated_at);
});

test("new submissions get a timestamp and rejected saves leave the previous submission intact", async () => {
  await db.query("delete from public.upi_configs where worker_id=$1", [creator]);
  await db.query("select public.save_upi_config($1,'new@bank','Monthly','12')", [creator]);
  assert.ok((await config()).updated_at);
  const previous = await config();
  await db.query("insert into public.payout_batches(worker_id,status) values($1,'Processing')", [creator]);
  await assert.rejects(db.query("select public.save_upi_config($1,'different@bank','Weekly','Fri')", [creator]), /active_batch/);
  assert.deepEqual(await config(), previous);
});
