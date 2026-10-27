import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { activityChange, activityCsv, adminActivityResponse, isAdminActivity } from "../../lib/adminOverview";
import { createAdminSessionCache } from "../../lib/adminSessionCache";

const db = new PGlite();
const now = "2026-10-27T18:00:00Z";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.profiles(id uuid primary key,worker_code text,display_name text,email text,role text,created_at timestamptz);
    create table public.worker_moderation(user_id uuid,status text);
    create table public.gig_applications(id uuid default gen_random_uuid(),worker_code text,status text default 'Pending',applied_at timestamptz);
    create table public.linked_social_accounts(id uuid default gen_random_uuid(),worker_code text,status text default 'active',profile_health jsonb default '{}');
    create table public.social_account_posts(id uuid default gen_random_uuid(),account_id uuid,created_at timestamptz,status text default 'submitted',submitted_by_worker boolean default false);
    create table public.view_payout_claims(id uuid default gen_random_uuid(),worker_id uuid,status text default 'Pending',created_at timestamptz);
    create table public.payout_batches(id uuid default gen_random_uuid(),worker_id uuid,status text default 'Draft',created_at timestamptz);
    create table public.worker_kyc(user_id uuid,status text default 'pending');
    grant select on all tables in schema public to service_role;`);
  await db.exec(await readFile("supabase/migrations/202610270002_admin_activity_overview.sql", "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec("truncate profiles,worker_moderation,gig_applications,linked_social_accounts,social_account_posts,view_payout_claims,payout_batches,worker_kyc"); });
const read = async (days: number | null = 7) => {
  const raw = (await db.query<{ data: unknown }>("select public.admin_activity_overview($1,$2) as data", [days, now])).rows[0].data;
  const data = adminActivityResponse(raw);
  assert.ok(data, "the aggregate must satisfy the public analytics contract");
  return data;
};
const user = async (id = first, code = "WKR-FIRST", created = "2026-10-01T00:00:00Z", role = "Worker") => {
  await db.query("insert into profiles values($1,$2,$3,$4,$5,$6)", [id,code,"Creator " + code,code.toLowerCase() + "@example.test",role,created]);
};

test("activity zero-fills every day in 7, 30 and 90 day windows with exact IST boundaries", async () => {
  for (const days of [7, 30, 90]) {
    const data = await read(days);
    assert.equal(isAdminActivity(data), true);
    assert.equal(data.days.length, days);
    assert.equal(data.days.at(-1)?.date, "2026-10-27");
    assert.ok(data.days.every(day => day.actions === 0 && day.activeUsers === 0));
    assert.equal(data.summary.activeUsers, 0);
    assert.deepEqual(data.recent, []);
  }
  for (const days of [null, 0, 14, 365]) await assert.rejects(read(days), /invalid_input/);
});

test("canonical aliases count one person once while preserving their real applications, submissions and requests", async () => {
  await user(); await user(second,"WKR-SECOND","2026-10-26T05:00:00Z");
  await db.query("insert into gig_applications(worker_code,applied_at) values($1,'2026-10-26T19:00Z'),($2,'2026-10-26T19:10Z'),($3,'2026-10-26T19:20Z'),($1,'2026-10-27T18:01Z')", [first,"WKR-FIRST","WKR-SECOND@EXAMPLE.TEST"]);
  const account = (await db.query<{ id: string }>("insert into linked_social_accounts(worker_code) values('WKR-FIRST') returning id")).rows[0].id;
  await db.query("insert into social_account_posts(account_id,created_at,submitted_by_worker) values($1,'2026-10-26T20:00Z',true),($1,'2026-10-26T20:00Z',false)", [account]);
  await db.query("insert into view_payout_claims(worker_id,created_at) values($1,'2026-10-26T20:10Z')", [second]);
  await db.query("insert into payout_batches(worker_id,created_at) values($1,'2026-10-26T20:20Z')", [first]);
  const data = await read();
  assert.equal(isAdminActivity(data), true);
  assert.equal(data.totalUsers, 2);
  assert.deepEqual(data.summary, { activeUsers: 2, newUsers: 1, applications: 3, reels: 1, claims: 1, withdrawals: 1, actions: 6 });
  assert.equal(data.days.at(-1)?.activeUsers, 2);
  assert.equal(data.days.at(-1)?.actions, 6);
  assert.equal(data.days.at(-1)?.newUsers, 0);
  assert.equal(data.days.at(-2)?.newUsers, 1);
  assert.ok(!JSON.stringify(data).includes("@example.test"), "email addresses and network information stay out of analytics");
});

test("IST midnight splits current and previous periods without counting future activity", async () => {
  await user();
  await db.exec("insert into gig_applications(worker_code,applied_at) values('WKR-FIRST','2026-10-20T18:29:59Z'),('WKR-FIRST','2026-10-20T18:30:00Z'),('WKR-FIRST','2026-10-27T18:00:01Z')");
  const data = await read();
  assert.equal(data.period.start, "2026-10-21");
  assert.equal(data.summary.applications, 1);
  assert.equal(data.previous.applications, 1);
  assert.equal(data.days[0].applications, 1);
  assert.equal(data.recent.length, 1);
});

test("deleted people and administrators are excluded while current review queues retain their own definitions", async () => {
  await user(); await user(second,"WKR-DELETED","2026-10-26T00:00Z");
  const admin = "33333333-3333-4333-8333-333333333333";
  await user(admin,"ADMIN","2026-10-26T00:00Z","Admin");
  await db.query("insert into worker_moderation values($1,'deleted')", [second]);
  await db.exec("insert into gig_applications(worker_code,applied_at) values('WKR-DELETED','2026-10-26'),('ADMIN','2026-10-26'),('WKR-FIRST','2026-10-26')");
  await db.exec("insert into linked_social_accounts(worker_code,status,profile_health) values('WKR-FIRST','active','{}'),('WKR-FIRST','paused','{}'),('WKR-FIRST','unlinked','{\"status\":\"missing\"}')");
  await db.query("insert into worker_kyc(user_id,status) values($1,'pending'),($2,'pending')", [first,second]);
  await db.query("insert into payout_batches(worker_id,status,created_at) values($1,'Draft','2026-10-26'),($1,'Processing','2026-10-26'),($1,'Paid','2026-10-26'),($1,'Failed','2026-10-26')", [first]);
  const data = await read();
  assert.equal(data.totalUsers, 1);
  assert.equal(data.summary.newUsers, 0);
  assert.equal(data.summary.applications, 1);
  assert.equal(data.counts.linkedAccounts, 2);
  assert.equal(data.counts.pendingWithdrawals, 2);
  assert.equal(data.queues.applications, 1);
  assert.equal(data.queues.identityChecks, 1);
  assert.equal(data.queues.profiles, 1);
});

test("aggregation remains exact above row caps and only the service role can execute it", async () => {
  await user();
  await db.exec("insert into gig_applications(worker_code,applied_at) select 'WKR-FIRST','2026-10-26'::timestamptz from generate_series(1,1501)");
  const data = await read();
  assert.equal(data.summary.applications, 1501);
  assert.equal(data.summary.activeUsers, 1);
  assert.equal(data.recent.length, 8);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(read(), /permission denied/); } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { assert.equal((await read()).summary.applications, 1501); } finally { await db.exec("reset role"); }
});

test("cached analytics reject missing days, inconsistent totals and invalid event payloads; CSV exports recorded counts", async () => {
  const data = await read();
  assert.equal(isAdminActivity(data), true);
  assert.equal(isAdminActivity({ ...data, days: data.days.slice(1) }), false);
  assert.equal(isAdminActivity({ ...data, summary: { ...data.summary, actions: 1 } }), false);
  assert.equal(isAdminActivity({ ...data, recent: [{ id: "x", kind: "login", userName: "Creator", workerCode: "WKR-FIRST", at: now }] }), false);
  const csv = activityCsv(data);
  assert.equal(csv.split("\r\n").length, 8);
  assert.ok(csv.includes("2026-10-27,0,0,0,0,0,0,0"));
  assert.deepEqual(activityChange(4,0), { label: "New activity", direction: "up" });
  assert.deepEqual(activityChange(0,0), { label: "No change", direction: "flat" });
  assert.deepEqual(activityChange(2,4), { label: "50%", direction: "down" });
});

test("reviewed aggregate activity persists across cache instances without weakening private-record guards", async () => {
  const data = await read();
  const saved = new Map<string,string>();
  const storage = {
    get length() { return saved.size; }, key: (index: number) => [...saved.keys()][index] ?? null,
    getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key,value); }, removeItem: (key: string) => { saved.delete(key); },
  };
  const cache = createAdminSessionCache({ storage });
  assert.equal(cache.write("admin", "activity", data, { persist: true }), true);
  assert.deepEqual(createAdminSessionCache({ storage }).read("admin", "activity")?.data, data);
  assert.equal(cache.write("admin", "private-record", { kyc: { document: "private" } }, { persist: true }), false);
});
