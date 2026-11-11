import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Per-reel CPM adjustments against the real credit, claim, review and read-model functions.
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
    "202611030001_creator_payout_plans.sql", "202611110001_reel_cpm_adjustments.sql", "202611110002_reel_cpm_after_views_and_wallet.sql", "202611110003_faster_wallet_read_model.sql",
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
const standard = { name: "Premium creators", baseINR: "200", thresholdViews: "10000", mode: "beyond" };

type CpmResult = { post: { cpm_override_inr: string | null; cpm_wallet_change_inr: string }; wallet: { walletChangeINR: number; unrecoveredINR: number } };
const setCpm = (post: string, rate: number | null, reasons: string[] = ["low_reel_engagement"], note = "", actor = admin, after = 0) =>
  scalar<CpmResult>("select public.admin_set_social_post_cpm($1,$2,$3,$4,$5,$6) as value", [actor, post, rate, reasons, note, after]);
/** Puts every wallet credit of the creator into a payout, as a withdrawal would. */
async function withdrawAll() {
  const batch = await scalar<string>("insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status) values($1,'Week',current_date,current_date,'Paid') returning id as value", [worker]);
  await db.query("insert into public.payout_items(batch_id,work_item_id,worker_id,amount_inr,status) select $1,id,worker_id,reward_inr,'Paid' from public.work_items where worker_id=$2 and status='Approved' and reward_inr>0", [batch, worker]);
}
const wallet = (post: string, accountId: string) => scalar<{ posts: Array<{ payoutTerms?: { mode: string; rateINR: number; standardRateINR?: number; cpmAdjusted?: boolean } }> }>("select public.social_post_wallet_state($1,$2) as value", [[post], [accountId]]);

test("an adjusted CPM prices a plain reel's approval credit", async () => {
  const { id } = await account();
  const post = await reel(id, 10_000);
  await setCpm(post, 20, ["low_reel_engagement", "no_bio_link"], "Views without comments");
  await approve(post);
  assert.equal(await money(), 200, "10K × ₹20, not ₹490");
  const item = await db.query<{ item_rate_inr: string; standard_rate_inr: string }>("select item_rate_inr::text,standard_rate_inr::text from public.view_payout_claim_items where post_id=$1", [post]);
  assert.deepEqual([Number(item.rows[0].item_rate_inr), Number(item.rows[0].standard_rate_inr)], [20, 49], "the interval freezes both rates");
  const state = await wallet(post, id);
  assert.deepEqual([state.posts[0].payoutTerms?.mode, state.posts[0].payoutTerms?.rateINR, state.posts[0].payoutTerms?.standardRateINR], ["cpm", 20, 49]);
});

test("adjusting reprices money already in the wallet, and restoring gives it back", async () => {
  const { id } = await account();
  const post = await reel(id, 2_000);
  await approve(post);
  assert.equal(await money(), 98, "2K × ₹49 before any adjustment");
  const lowered = await setCpm(post, 35);
  assert.deepEqual(lowered.wallet, { walletChangeINR: -28, unrecoveredINR: 0 });
  assert.equal(await money(), 70, "the credited 2K views are repriced at ₹35");
  await setViews(post, 4_000);
  await approve(post);
  assert.equal(await money(), 140, "+ 2K × ₹35");
  const restored = await setCpm(post, null);
  assert.equal(restored.wallet.walletChangeINR, 56);
  assert.equal(Number(restored.post.cpm_wallet_change_inr), 28, "running total of wallet changes");
  assert.equal(await money(), 196, "all 4K views back at ₹49");
  await setViews(post, 5_000);
  await approve(post);
  assert.equal(await money(), 245, "+ 1K × ₹49 after restoring");
  assert.equal((await wallet(post, id)).posts[0].payoutTerms, undefined, "a plain reel at its full rate reports no special terms");
});

test("creator claims and the claim review pay the adjusted rate", async () => {
  const { id } = await account();
  const post = await reel(id, 3_000, "approved");
  await setCpm(post, 19);
  assert.equal((await quote(id)).claimableINR, 57);
  const claim = await submit(id);
  assert.equal(Number(claim.amount_inr), 57);
  await setCpm(post, 30);
  const item = await scalar<string>("select id::text as value from public.view_payout_claim_items where post_id=$1", [post]);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Approved','Spike excluded','mixed',$3::jsonb)", [admin, claim.id, JSON.stringify([{ itemId: item, excludedViews: 1_000, reason: "Spike" }])]);
  assert.equal(await money(), 60, "2K × ₹30: a pending claim is reviewed at the reel's latest CPM, never the gig's ₹49");
});

test("a plan reel keeps its base; the adjusted CPM replaces the rate past the threshold", async () => {
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  const { id } = await account();
  const post = await reel(id, 15_000);
  await setCpm(post, 20);
  await approve(post);
  assert.equal(await money(), 300, "₹200 base + 5K × ₹20");
  const state = await wallet(post, id);
  assert.deepEqual([state.posts[0].payoutTerms?.mode, state.posts[0].payoutTerms?.rateINR, state.posts[0].payoutTerms?.standardRateINR], ["beyond", 20, 49], "the standard rate survives the frozen interval");
  await setCpm(post, null);
  assert.equal(await money(), 445, "restoring reprices the credited reel: ₹200 + 5K × ₹49");
  await setViews(post, 16_000);
  await approve(post);
  assert.equal(await money(), 494, "+ 1K × ₹49");
});

test("adjustments only lower the rate, need a reason, and are admin-only and audited", async () => {
  const { id } = await account();
  const post = await reel(id, 1_000);
  await assert.rejects(setCpm(post, 49), /cpm_not_lower/);
  await assert.rejects(setCpm(post, 60), /cpm_not_lower/);
  await assert.rejects(setCpm(post, 0), /cpm_not_lower/);
  await assert.rejects(setCpm(post, 20.005), /cpm_not_lower/);
  await assert.rejects(setCpm(post, 20, []), /cpm_reason_required/);
  await assert.rejects(setCpm(post, 20, ["made_up"]), /cpm_reason_required/);
  await assert.rejects(setCpm(post, 20, ["low_signups"], "", worker), /forbidden/);
  const saved = await setCpm(post, 20.5, ["low_signups", "low_signups", "no_auto_dm"], "  Ask viewers to comment  ");
  assert.equal(Number(saved.post.cpm_override_inr), 20.5);
  const row = await db.query<{ cpm_override_reasons: string[]; cpm_override_note: string }>("select cpm_override_reasons,cpm_override_note from public.social_account_posts where id=$1", [post]);
  assert.deepEqual(row.rows[0].cpm_override_reasons, ["low_signups", "no_auto_dm"]);
  assert.equal(row.rows[0].cpm_override_note, "Ask viewers to comment");
  await setCpm(post, null);
  const actions = await db.query<{ action: string }>("select action from public.audit_events where resource_id=$1 order by created_at", [post]);
  assert.deepEqual(actions.rows.map(r => r.action), ["reel_cpm_adjusted", "reel_cpm_restored"]);
});

test("per-post gigs have no CPM to adjust", async () => {
  const gig = await scalar<string>("insert into public.gigs(title,company,workload,payout,payout_type) values('Reels','Reelencer','Reels','₹300','Per post') returning id as value");
  const app = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values($1,'WKR-1','Accepted') returning id as value", [gig]);
  const acc = await scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle,linked_at) values($1,$2,'WKR-1','Instagram','creator',$3) returning id as value", [app, gig, linked]);
  await assert.rejects(setCpm(await reel(acc, 1_000), 20), /cpm_not_view_based/);
});

test("the lower CPM can start after a view count", async () => {
  const { id } = await account();
  const post = await reel(id, 10_000);
  await setCpm(post, 20, ["low_signups"], "", admin, 5_000);
  await approve(post);
  assert.equal(await money(), 345, "first 5K × ₹49 + next 5K × ₹20");
  const state = await wallet(post, id);
  assert.equal((state.posts[0].payoutTerms as { cpmAfterViews?: number }).cpmAfterViews, 5_000);
  await setCpm(post, 20, ["low_signups"], "", admin, 0);
  assert.equal(await money(), 200, "moving the start to 0 reprices the credited views: 10K × ₹20");
  await setCpm(post, 20, ["low_signups"], "", admin, 10_000);
  assert.equal(await money(), 490, "starting after all credited views restores them");
  await assert.rejects(setCpm(post, 20, ["low_signups"], "", admin, -1), /cpm_after_views_invalid/);
});

test("withdrawn money can't be taken back: it is reported and never paid twice", async () => {
  const { id } = await account();
  const post = await reel(id, 2_000);
  await approve(post);
  await withdrawAll();
  const lowered = await setCpm(post, 20);
  assert.deepEqual(lowered.wallet, { walletChangeINR: 0, unrecoveredINR: 58 });
  assert.equal(await money(), 98, "the paid ₹98 credit is untouched");
  await setViews(post, 3_000);
  await approve(post);
  assert.equal(await money(), 118, "new views earn ₹20 / 1K");
  const restored = await setCpm(post, null);
  assert.equal(restored.wallet.walletChangeINR, 29, "only the newer 1K views go back up; the withdrawn interval was already paid in full");
  assert.equal(await money(), 147);
});

test("a raise on a withdrawn credit is paid as a top-up, which a later cut takes back first", async () => {
  const { id } = await account();
  const post = await reel(id, 2_000);
  await setCpm(post, 20);
  await approve(post);
  assert.equal(await money(), 40);
  await withdrawAll();
  await setCpm(post, 40);
  assert.equal(await money(), 80, "+₹40 top-up for the withdrawn interval");
  assert.equal(Number(await scalar<string>("select count(*)::text as value from public.work_items where review->>'source'='reel_cpm_adjustment'")), 1);
  const cut = await setCpm(post, 30);
  assert.deepEqual(cut.wallet, { walletChangeINR: -20, unrecoveredINR: 0 }, "taken from the top-up still in the wallet");
  assert.equal(await money(), 60);
});

test("account owners resolve by id, worker code or email, and only when exactly one profile matches", async () => {
  const owner = (code: string | null) => scalar<string | null>("select public.social_account_owner($1)::text as value", [code]);
  assert.equal(await owner("WKR-1"), worker);
  assert.equal(await owner("  wkr-1 "), worker, "case and spaces don't matter");
  assert.equal(await owner("Creator@Example.test"), worker);
  assert.equal(await owner(worker.toUpperCase()), worker);
  assert.equal(await owner("nobody"), null);
  assert.equal(await owner(""), null);
  assert.equal(await owner(null), null);
  await db.query("update public.profiles set email='wkr-1' where id=$1", [other]);
  assert.equal(await owner("WKR-1"), null, "ambiguous: one profile's code is another's email");
  await db.query("update public.profiles set email='other@example.test' where id=$1", [other]);
});

test("the wallet read model still reports each account's plan once", async () => {
  const plan = await savePlan(standard);
  await assign(plan.id, [worker]);
  const mine = await account("WKR-1");
  const theirs = await account("WKR-2");
  const state = await scalar<{ accounts: Array<{ accountId: string; payoutPlan?: { planName: string } }> }>("select public.social_post_wallet_state('{}',$1) as value", [[mine.id, theirs.id]]);
  assert.equal(state.accounts.length, 2);
  assert.equal(state.accounts.find(a => a.accountId === mine.id)?.payoutPlan?.planName, "Premium creators");
  assert.equal(state.accounts.find(a => a.accountId === theirs.id)?.payoutPlan, undefined);
});
