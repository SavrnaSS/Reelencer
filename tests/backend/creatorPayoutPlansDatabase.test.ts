import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Custom payout plans against the real credit, claim, review and read-model functions.
const db = new PGlite();
const worker = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const linked = "2026-10-29T07:52:00Z";
const posted = "2026-10-30T04:00:00Z";

async function scalar<T>(query: string, values: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(query, values)).rows[0]?.value;
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await db.exec(await readFile("supabase/migrations/202610040001_core.sql", "utf8"));
  await db.exec(`insert into auth.users(id,email) values('${worker}','creator@example.test'),('${other}','other@example.test'),('${admin}','operator@example.test');
    insert into public.profiles(id,worker_code,email,role) values('${worker}','WKR-1','creator@example.test','Worker'),('${other}','WKR-2','other@example.test','Worker'),('${admin}','ADMIN','operator@example.test','Admin');`);
  for (const name of [
    "202610080001_linked_social_accounts.sql", "202610080002_social_post_review.sql",
    "202610080003_social_auto_sync.sql", "202610080006_instagram_profile_sync.sql", "202610080007_view_payout_claims.sql",
    "202610080008_reel_view_freshness.sql", "202610080009_view_authenticity_review.sql", "202610290001_reel_tracking_window.sql",
    "202610290002_reel_removal.sql", "202610300001_approved_reel_wallet_credit.sql", "202610300002_social_wallet_read_model.sql",
    "202611030001_creator_payout_plans.sql",
  ]) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(`create or replace function public.app_is_admin(p_actor uuid) returns boolean language sql as $$ select p_actor='${admin}'::uuid $$;`);
  await db.exec("grant select on all tables in schema public to service_role");
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate public.audit_events, public.view_payout_claim_items, public.view_payout_claims, public.work_items,
    public.social_post_measurements, public.social_account_posts, public.linked_social_accounts, public.gig_applications,
    public.creator_payout_plan_members, public.creator_payout_plans, public.gigs cascade;`);
});

async function account(alias = "WKR-1", rate = "₹49") {
  const gig = await scalar<string>("insert into public.gigs(title,company,workload,payout,payout_type) values('Reels','Reelencer','Reels',$1,'Per 1k views') returning id as value", [rate]);
  const app = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values($1,$2,'Accepted') returning id as value", [gig, alias]);
  const id = await scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle,linked_at) values($1,$2,$3,'Instagram','creator',$4) returning id as value", [app, gig, alias, linked]);
  return { id, gig };
}
async function reel(accountId: string, views: number | null, status = "submitted") {
  return scalar<string>("insert into public.social_account_posts(account_id,url,posted_at,status,views,source) values($1,'https://www.instagram.com/reel/'||gen_random_uuid()::text||'/',$2,$3,$4,'profile') returning id as value", [accountId, posted, status, views]);
}
type Plan = { id: string };
const savePlan = (input: Record<string, unknown>) => scalar<Plan>("select public.admin_save_payout_plan($1,$2) as value", [admin, input]);
const assign = (plan: string | null, workers: string[], from = "2026-10-01T00:00:00Z") => scalar<{ assigned: number; removed: number; moved: number }>("select public.admin_assign_payout_plan($1,$2,$3,$4) as value", [admin, plan, workers, from]);
const approve = (post: string) => db.query("select public.approve_social_post_and_credit($1,$2,'Reviewed') as value", [admin, post]);
const money = async (who = worker) => Number(await scalar<string>("select coalesce(sum(reward_inr),0) as value from public.work_items where worker_id=$1 and status='Approved'", [who]));
const setViews = (post: string, views: number) => db.query("update public.social_account_posts set views=$2 where id=$1", [post, views]);
const quote = (accountId: string) => scalar<{ claimableViews: number; claimableINR: number; payoutPlan?: { baseINR: number } }>("select public.view_payout_quote($1,$2) as value", [worker, accountId]);
const submit = (accountId: string) => scalar<{ id: string; amount_inr: number }>("select public.submit_view_payout_claim($1,$2) as value", [worker, accountId]);
const cumulative = (views: number, mode: string, rate = 49, base = 200, threshold = 10_000) => scalar<string>("select public.reel_payout_cumulative($1,$2,$3,$4,$5)::text as value", [views, mode, rate, base, threshold]).then(Number);
const standard = { name: "Premium creators", baseINR: "200", thresholdViews: "10000", mode: "beyond" };

test("plan formulas: base until the threshold, then the view rate", async () => {
  assert.equal(await cumulative(0, "beyond"), 200);
  assert.equal(await cumulative(10_000, "beyond"), 200);
  assert.equal(await cumulative(12_500, "beyond"), 322.5, "₹200 + 2.5K × ₹49");
  assert.equal(await cumulative(10_000, "all"), 200);
  assert.equal(await cumulative(12_500, "all"), 612.5, "full ₹49 / 1K once past 10K");
  assert.equal(await cumulative(12_500, "cpm"), 612.5);
});

test("approval pays the base for a planned reel, then only the growth beyond the threshold", async () => {
  const plan = await savePlan(standard);
  assert.equal((await assign(plan.id, [worker])).assigned, 1);
  const { id } = await account();
  const post = await reel(id, 4_000);
  await approve(post);
  assert.equal(await money(), 200, "base pay, not 4K × ₹49");
  await setViews(post, 9_000);
  await approve(post);
  assert.equal(await money(), 200, "growth under the threshold earns nothing more");
  await setViews(post, 15_000);
  await approve(post);
  assert.equal(await money(), 445, "₹200 + 5K × ₹49");
  const items = await db.query<{ payout_mode: string; opens_plan: boolean; from_views: string; to_views: string }>("select payout_mode,opens_plan,from_views,to_views from public.view_payout_claim_items order by to_views");
  assert.deepEqual(items.rows.map(row => [row.payout_mode, row.opens_plan, Number(row.from_views), Number(row.to_views)]), [["beyond", true, 0, 4000], ["beyond", false, 4000, 15000]]);
});

test("unmeasured planned reels still earn the base, and other creators keep plain pay", async () => {
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  const mine = await account("WKR-1");
  const theirs = await account("WKR-2");
  await approve(await reel(mine.id, null));
  await approve(await reel(theirs.id, 4_000));
  assert.equal(await money(worker), 200);
  assert.equal(await money(other), 196, "4K × ₹49 for a creator without a plan");
});

test("reels keep the terms they started earning under", async () => {
  const { id } = await account();
  const plain = await reel(id, 2_000);
  await approve(plain);
  assert.equal(await money(), 98);
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  await setViews(plain, 4_000);
  await approve(plain);
  assert.equal(await money(), 196, "an already-earning plain reel stays plain");
  const planned = await reel(id, 1_000);
  await approve(planned);
  assert.equal(await money(), 396);
  await savePlan({ ...standard, id: plan.id, baseINR: "500" });
  await assign(null, [worker]);
  await setViews(planned, 11_000);
  await approve(planned);
  assert.equal(await money(), 445, "edits and removal never change a started reel's terms: + 1K × ₹49");
});

test("applies-from date and gig scope limit which reels a plan covers", async () => {
  const { id, gig } = await account();
  const scoped = await savePlan({ ...standard, gigId: gig });
  await assign(scoped.id, [worker], "2026-11-01T00:00:00Z");
  await approve(await reel(id, 1_000));
  assert.equal(await money(), 49, "posted before the plan's start date");
  const elsewhere = await account();
  await assign(scoped.id, [worker]);
  await approve(await reel(elsewhere.id, 1_000));
  assert.equal(await money(), 98, "another gig keeps its own rate");
  await approve(await reel(id, 1_000));
  assert.equal(await money(), 298);
});

test("creator claims freeze plan intervals and mixed reviews keep the base", async () => {
  const plan = await savePlan({ ...standard, rateINR: "60" });
  await assign(plan.id, [worker]);
  const { id } = await account();
  const first = await reel(id, 12_000, "approved");
  await reel(id, null, "approved");
  const q = await quote(id);
  assert.equal(q.claimableINR, 200 + 120 + 200, "₹200 + 2K × ₹60, plus a base for the unmeasured reel");
  assert.equal(q.payoutPlan?.baseINR, 200);
  const claim = await submit(id);
  assert.equal(Number(claim.amount_inr), 520);
  assert.equal((await quote(id)).claimableINR, 0);
  const item = await scalar<string>("select id::text as value from public.view_payout_claim_items where post_id=$1", [first]);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Approved','Spike excluded','mixed',$3::jsonb)", [admin, claim.id, JSON.stringify([{ itemId: item, excludedViews: 1_000, reason: "Spike" }])]);
  assert.equal(await money(), 460, "excluding 1K views removes ₹60, never the base");
});

test("a soft rejection releases the base; a hard rejection forfeits it", async () => {
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  const { id } = await account();
  const post = await reel(id, 3_000, "approved");
  const soft = await submit(id);
  await db.query("select public.review_view_payout_claim($1,$2,'Rejected','Retry with insights')", [admin, soft.id]);
  assert.equal((await quote(id)).claimableINR, 200);
  const hard = await submit(id);
  await db.query("select public.review_view_payout_claim($1,$2,'Hard rejected','Not original content')", [admin, hard.id]);
  assert.equal((await quote(id)).claimableINR, 0);
  await setViews(post, 12_000);
  assert.equal((await quote(id)).claimableINR, 98, "only growth past the threshold after a forfeited base");
});

test("the wallet read model reports planned terms and the account's plan", async () => {
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  const { id } = await account();
  const post = await reel(id, 500);
  const state = await scalar<{ posts: Array<{ payoutTerms?: { mode: string; baseINR: number; started: boolean } }>; accounts: Array<{ payoutPlan?: { planName: string } }> }>("select public.social_post_wallet_state($1,$2) as value", [[post], [id]]);
  assert.equal(state.posts[0].payoutTerms?.mode, "beyond");
  assert.equal(state.posts[0].payoutTerms?.started, false);
  assert.equal(state.accounts[0].payoutPlan?.planName, "Premium creators");
});

test("plan administration validates input, rejects inactive plans and audits changes", async () => {
  await assert.rejects(savePlan({ ...standard, baseINR: "-1" }), /invalid_input/);
  await assert.rejects(savePlan({ ...standard, mode: "bonus" }), /invalid_input/);
  await assert.rejects(scalar("select public.admin_save_payout_plan($1,$2) as value", [worker, standard]), /forbidden/);
  const plan = await savePlan({ ...standard, active: false });
  await assert.rejects(assign(plan.id, [worker]), /payout_plan_inactive/);
  const live = await savePlan(standard);
  const second = await savePlan({ ...standard, name: "Launch" });
  await assign(live.id, [worker, other]);
  assert.equal((await assign(second.id, [worker])).moved, 1);
  assert.equal((await assign(null, [worker, other])).removed, 2);
  const listing = await scalar<{ plans: unknown[]; gigs: unknown[] }>("select public.admin_payout_plans() as value");
  assert.equal(listing.plans.length, 3);
  assert.ok(Number(await scalar<string>("select count(*)::text as value from public.audit_events where action like 'payout_plan_%'")) >= 6);
});
