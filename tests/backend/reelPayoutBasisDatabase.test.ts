import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Switching a reel between its base-pay plan and plain CPM, against the real credit, claim and wallet functions.
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
    "202611030001_creator_payout_plans.sql", "202611110001_reel_cpm_adjustments.sql", "202611110002_reel_cpm_after_views_and_wallet.sql", "202611110003_faster_wallet_read_model.sql", "202611110004_reel_cpm_from_now.sql", "202611170001_reel_payout_basis_switch.sql",
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
/** Puts every wallet credit of the creator into a payout, as a withdrawal would. */
async function withdrawAll() {
  const batch = await scalar<string>("insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status) values($1,'Week',current_date,current_date,'Paid') returning id as value", [worker]);
  await db.query("insert into public.payout_items(batch_id,work_item_id,worker_id,amount_inr,status) select $1,id,worker_id,reward_inr,'Paid' from public.work_items where worker_id=$2 and status='Approved' and reward_inr>0", [batch, worker]);
}
const wallet = (post: string, accountId: string) => scalar<{ posts: Array<{ payoutTerms?: { mode: string; rateINR: number; standardRateINR?: number; cpmAdjusted?: boolean } }> }>("select public.social_post_wallet_state($1,$2) as value", [[post], [accountId]]);
const plainCpm = (post: string, rate: number) => scalar<unknown>("select public.admin_set_social_post_cpm($1,$2,$3,$4,'',0,false) as value", [admin, post, rate, ["low_reel_engagement"]]);

type BasisResult = { post: { payout_basis: string | null; payout_basis_plan: { mode: string; baseINR: number; planName?: string } | null; cpm_override_inr: string | null }; wallet: { walletChangeINR: number; unrecoveredINR: number; clearedCpmINR?: number }; idempotent?: boolean };
const setBasis = (post: string, basis: string, actor = admin, reason = "") => scalar<BasisResult>("select public.admin_set_social_post_payout_basis($1,$2,$3,$4) as value", [actor, post, basis, reason]);
// The Premium Creators plan: ₹200 per reel until 10K views, then ₹49 per 1K on all views.
const premium = { name: "Premium creators", baseINR: "200", thresholdViews: "10000", mode: "all" };
async function onPlan(input: Record<string, unknown> = premium) {
  const plan = await savePlan(input);
  await assign(plan.id, [worker]);
  return plan;
}

test("switching an approved base-pay reel to CPM reprices its credit, and switching back restores the base", async () => {
  await onPlan();
  const { id } = await account();
  const post = await reel(id, 846);
  await approve(post);
  assert.equal(await money(), 200, "the plan's base");
  const switched = await setBasis(post, "cpm", admin, "Low-effort reel");
  assert.deepEqual(switched.wallet, { walletChangeINR: -158.55, unrecoveredINR: 0 });
  assert.equal(await money(), 41.45, "846 × ₹49 / 1K, no base");
  assert.equal(switched.post.payout_basis, "cpm");
  assert.deepEqual([switched.post.payout_basis_plan?.mode, switched.post.payout_basis_plan?.baseINR, switched.post.payout_basis_plan?.planName], ["all", 200, "Premium creators"]);
  assert.equal((await wallet(post, id)).posts[0].payoutTerms, undefined, "the read model now reports plain pay");
  const plan = await scalar<{ creditedINR: number }[]>("select public.admin_payout_plans()->'plans' as value");
  assert.equal(Number(plan[0].creditedINR), 0, "the reel no longer counts towards the plan's totals");

  await setViews(post, 2_000);
  await approve(post);
  assert.equal(await money(), 98, "growth is credited at plain CPM: 2K × ₹49");

  const restored = await setBasis(post, "plan");
  assert.equal(restored.wallet.walletChangeINR, 102);
  assert.equal(restored.post.payout_basis, null);
  assert.equal(await money(), 200, "back on the plan: ₹200 base covers 2K views");
  const terms = (await wallet(post, id)).posts[0].payoutTerms;
  assert.equal(terms?.mode, "all");
  const opens = await scalar<number>("select count(*)::int as value from public.view_payout_claim_items where post_id=$1 and opens_plan", [post]);
  assert.equal(opens, 1, "exactly one interval pays the base");
  const audit = await scalar<string[]>("select array_agg(action order by created_at) as value from public.audit_events where resource_id=$1 and action like 'reel_switched%'", [post]);
  assert.deepEqual(audit, ["reel_switched_to_cpm", "reel_switched_to_plan"]);
});

test("an unmeasured reel's base-only credit becomes ₹0 at CPM and comes back on the plan", async () => {
  await onPlan();
  const { id } = await account();
  const post = await reel(id, null);
  await approve(post);
  assert.equal(await money(), 200, "the base is paid before views are measured");
  const switched = await setBasis(post, "cpm");
  assert.equal(switched.wallet.walletChangeINR, -200);
  assert.equal(await money(), 0);
  const item = await db.query<{ from_views: string; to_views: string; payout_mode: string; rebased: boolean }>("select from_views::text,to_views::text,payout_mode,rebased from public.view_payout_claim_items where post_id=$1", [post]);
  assert.deepEqual(item.rows[0], { from_views: "0", to_views: "0", payout_mode: "cpm", rebased: true }, "kept as a zero-view interval");
  await setViews(post, 1_000);
  await approve(post);
  assert.equal(await money(), 49);
  await setBasis(post, "plan");
  assert.equal(await money(), 200, "the base again; 1K views are inside it");
});

test("a reel switched before approval is credited at plain CPM, in claims too", async () => {
  await onPlan();
  const { id } = await account();
  const post = await reel(id, 3_000);
  await setBasis(post, "cpm");
  await approve(post);
  assert.equal(await money(), 147, "3K × ₹49, no base");
  const other = await reel(id, 3_000, "approved");
  await setBasis(other, "cpm");
  assert.equal((await quote(id)).claimableINR, 147, "the quote prices the switched reel at CPM");
  await setBasis(other, "plan");
  assert.equal((await quote(id)).claimableINR, 200, "and at the plan again once switched back");
});

test("money already withdrawn isn't taken back and is reported", async () => {
  await onPlan();
  const { id } = await account();
  const post = await reel(id, 1_000);
  await approve(post);
  await withdrawAll();
  const switched = await setBasis(post, "cpm");
  assert.deepEqual(switched.wallet, { walletChangeINR: 0, unrecoveredINR: 151 });
  assert.equal(await money(), 200, "the paid credit is untouched");
  const restored = await setBasis(post, "plan");
  assert.equal(restored.wallet.walletChangeINR, 0, "switching back never pays the base twice");
});

test("a lowered CPM stays when it's still below the new rate and is cleared when it isn't", async () => {
  await onPlan({ ...premium, rateINR: "60" });
  const { id } = await account();
  const kept = await reel(id, 20_000);
  await plainCpm(kept, 30);
  const keptResult = await setBasis(kept, "cpm");
  assert.equal(Number(keptResult.post.cpm_override_inr), 30, "₹30 is still below the gig's ₹49");
  await approve(kept);
  assert.equal(await money(), 600, "20K × ₹30");
  const cleared = await reel(id, 20_000);
  await plainCpm(cleared, 55);
  const clearedResult = await setBasis(cleared, "cpm");
  assert.equal(clearedResult.post.cpm_override_inr, null, "₹55 would be a raise over the gig's ₹49");
  assert.equal(clearedResult.wallet.clearedCpmINR, 55);
});

test("switching is admin-only, needs a plan reel and is idempotent", async () => {
  const { id } = await account();
  const plain = await reel(id, 1_000);
  await assert.rejects(setBasis(plain, "cpm"), /payout_basis_not_plan/);
  await assert.rejects(setBasis(plain, "base"), /invalid_input/);
  assert.equal((await setBasis(plain, "plan")).idempotent, true, "a reel that was never switched is already on its usual terms");
  await onPlan();
  const post = await reel(id, 1_000);
  await assert.rejects(setBasis(post, "cpm", worker), /forbidden/);
  await setBasis(post, "cpm");
  assert.equal((await setBasis(post, "cpm")).idempotent, true);
  await db.query("update public.social_account_posts set removed_at=now(),status='rejected' where id=$1", [post]);
  await assert.rejects(setBasis(post, "plan"), /reel_removed/);
});
