import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real claim, authenticity, tracking and withdrawal functions; no network or live database writes.
const db = new PGlite();
const worker = "11111111-1111-4111-8111-111111111111";
const admin = "33333333-3333-4333-8333-333333333333";
const linked = "2026-10-29T07:52:00Z";
const posted = "2026-10-30T04:00:00Z";
const migration = "supabase/migrations/202610300001_approved_reel_wallet_credit.sql";

async function scalar<T>(query: string, values: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(query, values)).rows[0]?.value;
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await db.exec(await readFile("supabase/migrations/202610040001_core.sql", "utf8"));
  await db.exec(`insert into auth.users(id,email) values('${worker}','creator@example.test'),('${admin}','operator@example.test');
    insert into public.profiles(id,worker_code,email,role) values('${worker}','WKR-1','creator@example.test','Worker'),('${admin}','ADMIN','operator@example.test','Admin');`);
  // This migration also contains unrelated work-email functions requiring their own schema. Load its actual
  // request/transition definitions without inventing a second implementation of wallet reservations for the test.
  const transactions = await readFile("supabase/migrations/202610040004_transactions.sql", "utf8");
  const starts = transactions.indexOf("create or replace function public.request_payout(");
  const ends = transactions.indexOf("create or replace function public.submit_gig_credentials(", starts);
  assert.ok(starts >= 0 && ends > starts);
  await db.exec(transactions.slice(starts, ends));
  for (const name of [
    "202610080001_linked_social_accounts.sql", "202610080002_social_post_review.sql",
    "202610080003_social_auto_sync.sql", "202610080006_instagram_profile_sync.sql", "202610080007_view_payout_claims.sql",
    "202610080008_reel_view_freshness.sql", "202610080009_view_authenticity_review.sql", "202610290001_reel_tracking_window.sql",
    "202610290002_reel_removal.sql",
  ]) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(`create or replace function public.app_is_admin(p_actor uuid) returns boolean language sql as $$ select p_actor='${admin}'::uuid $$;`);
  const historical = await reel(await account(), 1000, "approved");
  await db.exec(await readFile(migration, "utf8"));
  assert.equal(Number(await scalar<string>("select count(*) as value from public.work_items")), 0, "installing the migration must not fund historical approvals");
  assert.equal(await scalar<string>("select status as value from public.social_account_posts where id=$1", [historical]), "approved");
  await db.exec(await readFile("supabase/migrations/202610300002_social_wallet_read_model.sql", "utf8"));
  await db.exec("grant select on all tables in schema public to service_role");
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate public.audit_events, public.view_payout_claim_items, public.view_payout_claims,
    public.payout_items, public.payout_batches, public.work_items, public.social_post_measurements,
    public.social_account_posts, public.linked_social_accounts, public.gig_applications, public.gigs,
    public.worker_kyc, public.upi_configs cascade;
    update public.profiles set active=true;`);
});

async function account(rate = "₹49", basis = "Per 1k views", alias = "WKR-1") {
  const gig = await scalar<string>("insert into public.gigs(title,company,workload,payout,payout_type) values('Reels','Reelencer','Reels',$1,$2) returning id as value", [rate, basis]);
  const app = await scalar<string>("insert into public.gig_applications(gig_id,worker_code,status) values($1,$2,'Accepted') returning id as value", [gig, alias]);
  return scalar<string>("insert into public.linked_social_accounts(application_id,gig_id,worker_code,platform,handle,linked_at) values($1,$2,$3,'Instagram','creator',$4) returning id as value", [app, gig, alias, linked]);
}
async function reel(accountId: string, views: number | null = 1500, status = "submitted", date: string | null = posted) {
  return scalar<string>("insert into public.social_account_posts(account_id,url,posted_at,status,views,source) values($1,'https://www.instagram.com/reel/'||gen_random_uuid()::text||'/',$2,$3,$4,'profile') returning id as value", [accountId, date, status, views]);
}
const approve = (post: string, actor = admin) => scalar<{ post: { id: string; status: string; reviewed_at: string } }>("select public.approve_social_post_and_credit($1,$2,'Reviewed reel for payment') as value", [actor, post]);
const credit = (post: string, actor = admin) => scalar<{ credited: boolean; amountINR: number; reason?: string }>("select public.credit_approved_social_post($1,$2) as value", [actor, post]);
const money = async () => Number(await scalar<string>("select coalesce(sum(reward_inr),0) as value from public.work_items where worker_id=$1 and status='Approved'", [worker]));
const quote = (accountId: string) => scalar<{ claimableViews: number; claimableINR: number }>("select public.view_payout_quote($1,$2) as value", [worker, accountId]);
const submit = (accountId: string) => scalar<{ id: string }>("select public.submit_view_payout_claim($1,$2) as value", [worker, accountId]);
type WalletState = {
  posts: Array<{ postId: string; creditedINR: number; consumedViews: number; pendingClaimINR: number; fixedCredit: boolean }>;
  accounts: Array<{ accountId: string; creditedINR: number; creditedReels: number }>;
};
const walletState = (posts: string[], accounts: string[]) => scalar<WalletState>("select public.social_post_wallet_state($1,$2) as value", [posts, accounts]);

test("approval creates one frozen claim and real wallet credit, retries do not duplicate it", async () => {
  const id = await account(), post = await reel(id);
  const first = await approve(post);
  await approve(post);
  await Promise.all([credit(post), credit(post)]);
  assert.equal(first.post.status, "approved");
  assert.equal(await money(), 73.5);
  assert.equal(await scalar<number>("select count(*)::int as value from public.work_items"), 1);
  assert.equal(await scalar<number>("select count(*)::int as value from public.view_payout_claims where status='Approved' and authenticity_review='unreviewed' and note='Approved through reel review'"), 1);
  const frozen = await db.query<{ from_views: number; to_views: number; amount_inr: number; reviewed_amount_inr: number }>("select from_views,to_views,amount_inr,reviewed_amount_inr from public.view_payout_claim_items");
  assert.equal(Number(frozen.rows[0].from_views), 0);
  assert.equal(Number(frozen.rows[0].to_views), 1500);
  assert.equal(Number(frozen.rows[0].reviewed_amount_inr), 73.5);
  assert.equal((await quote(id)).claimableINR, 0, "the creator cannot claim the same views again");
  assert.equal(await scalar<number>("select count(*)::int as value from public.audit_events where action='approved_reel_wallet_credit'"), 1);
});

test("sync and metric edits never fund growth until an explicit admin reapproval", async () => {
  const id = await account(), post = await reel(id, 1000);
  const first = await approve(post);
  await db.query("update public.social_account_posts set views=1500,updated_at=now() where id=$1", [post]);
  assert.equal(await money(), 49);
  await db.query("update public.social_account_posts set reviewed_at=reviewed_at,status=status,likes=100 where id=$1", [post]);
  assert.equal(await money(), 49);
  const next = await approve(post);
  assert.notEqual(first.post.reviewed_at, next.post.reviewed_at);
  assert.equal(await money(), 73.5);
  await db.query("update public.social_account_posts set views=1200 where id=$1", [post]);
  await approve(post);
  assert.equal(await money(), 73.5, "counter corrections never re-credit or rewrite existing payments");
});

test("incremental credits use cumulative paise rounding, including sub-paise growth", async () => {
  const id = await account("₹0.01"), post = await reel(id, 1);
  await approve(post);
  assert.equal(await money(), 0);
  await db.query("update public.social_account_posts set views=500 where id=$1", [post]);
  await approve(post);
  assert.equal(await money(), 0.01);
  await db.query("update public.social_account_posts set views=1500 where id=$1", [post]);
  await approve(post);
  assert.equal(await money(), 0.02);
});

test("Pending claims keep their exact reservation while approval credits only later growth", async () => {
  const id = await account(), post = await reel(id, 1000, "approved");
  const pending = await submit(id);
  const before = await scalar<unknown>("select to_jsonb(c) as value from public.view_payout_claims c where id=$1", [pending.id]);
  assert.deepEqual((await walletState([post], [id])).posts[0], { postId: post, creditedINR: 0, consumedViews: 1000, pendingClaimINR: 49, fixedCredit: false });
  await db.query("update public.social_account_posts set views=1500 where id=$1", [post]);
  await approve(post);
  assert.equal(await money(), 24.5);
  assert.deepEqual((await walletState([post], [id])).posts[0], { postId: post, creditedINR: 24.5, consumedViews: 1500, pendingClaimINR: 49, fixedCredit: false });
  assert.deepEqual(await scalar<unknown>("select to_jsonb(c) as value from public.view_payout_claims c where id=$1", [pending.id]), before);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Approved','Reviewed existing evidence','organic','[]'::jsonb)", [admin, pending.id]);
  assert.equal(await money(), 73.5, "later claim approval pays only its own frozen interval");
  assert.deepEqual((await walletState([post], [id])).accounts[0], { accountId: id, creditedINR: 73.5, creditedReels: 1 });
  assert.equal((await quote(id)).claimableViews, 0);
});

test("mixed authenticity deductions and hard rejections stay consumed forever", async () => {
  const id = await account(), post = await reel(id, 1500, "approved");
  const pending = await submit(id);
  const item = await scalar<string>("select id as value from public.view_payout_claim_items where claim_id=$1", [pending.id]);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Approved','Excluded identified artificial traffic','mixed',$3)", [admin, pending.id, [{ itemId: item, excludedViews: 500, reason: "Identified artificial traffic" }]]);
  assert.equal(await money(), 49);
  assert.deepEqual((await walletState([post], [id])).posts[0], { postId: post, creditedINR: 49, consumedViews: 1500, pendingClaimINR: 0, fixedCredit: false });
  await approve(post);
  assert.equal(await money(), 49);
  await db.query("update public.social_account_posts set views=2000 where id=$1", [post]);
  const hard = await submit(id);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Hard rejected','Ineligible growth','suspected','[]'::jsonb)", [admin, hard.id]);
  await approve(post);
  assert.equal(await money(), 49);
  await db.query("update public.social_account_posts set views=2500 where id=$1", [post]);
  await approve(post);
  assert.equal(await money(), 73.5);
  assert.equal(Number(await scalar<string>("select excluded_views as value from public.view_payout_claim_items where id=$1", [item])), 500);
});

test("a soft rejected reservation is released only by a subsequent explicit admin approval", async () => {
  const id = await account(), post = await reel(id, 1000, "approved");
  const pending = await submit(id);
  await db.query("select public.review_view_payout_claim_authenticity($1,$2,'Rejected','Correct the supporting evidence','insufficient','[]'::jsonb)", [admin, pending.id]);
  assert.equal(await money(), 0);
  await approve(post);
  assert.equal(await money(), 49);
  assert.equal(await scalar<string>("select status as value from public.view_payout_claims where id=$1", [pending.id]), "Rejected");
});

test("fixed-per-post approval pays once and payout basis changes cannot duplicate money", async () => {
  const id = await account("₹125", "Per post"), post = await reel(id, null);
  await approve(post); await approve(post);
  assert.equal(await money(), 125);
  assert.equal(await scalar<string>("select public_id as value from public.work_items"), `REEL-${post}`);
  await db.query("update public.gigs set payout_type='Per 1k views' where id=(select gig_id from public.linked_social_accounts where id=$1)", [id]);
  await db.query("update public.social_account_posts set views=1000 where id=$1", [post]);
  await assert.rejects(approve(post), /reel_wallet_basis_changed/);
  assert.equal(await money(), 125);
  const viewAccount = await account(), viewPost = await reel(viewAccount);
  await approve(viewPost);
  await db.query("update public.gigs set payout_type='Per post' where id=(select gig_id from public.linked_social_accounts where id=$1)", [viewAccount]);
  await assert.rejects(approve(viewPost), /reel_wallet_basis_changed/);
});

test("only authenticated admin approvals fund eligible creator reels", async () => {
  const id = await account(), post = await reel(id);
  await assert.rejects(approve(post, worker), /forbidden/);
  await assert.rejects(credit(post, worker), /forbidden/);
  assert.equal((await credit(post)).reason, "not_approved");
  await db.query("update public.profiles set active=false where id=$1", [worker]);
  await assert.rejects(approve(post), /worker_inactive/);
  await db.query("update public.profiles set active=true where id=$1", [worker]);
  await db.query("update public.linked_social_accounts set status='unlinked' where id=$1", [id]);
  await assert.rejects(approve(post), /claim_account_inactive/);
  await db.query("update public.linked_social_accounts set status='paused' where id=$1", [id]);
  await approve(post);
  assert.equal(await money(), 73.5, "paused but linked accounts retain their reviewed earnings");
});

test("removed, pre-link and undated payable reels cannot obtain wallet credits", async () => {
  const id = await account(), removed = await reel(id), early = await reel(id, 1000, "submitted", "2026-10-28T18:29:59Z"), undated = await reel(id, 1000, "submitted", null);
  await db.query("update public.social_account_posts set removed_at=now(),status='rejected' where id=$1", [removed]);
  await assert.rejects(approve(removed), /reel_removed/);
  await assert.rejects(approve(early), /reel_before_link/);
  await assert.rejects(approve(undated), /reel_date_required/);
  assert.equal(await money(), 0);
  assert.equal(await scalar<string>("select status as value from public.social_account_posts where id=$1", [undated]), "submitted", "failed funding rolls approval back");
  assert.equal(await scalar<number>("select count(*)::int as value from public.view_payout_claims"), 0);
});

test("foreign, invalid rates and unknown view counts never mint spendable money", async () => {
  for (const rate of ["$49", "USD49", "₹0", "₹49-99", "₹49.001"]) {
    const post = await reel(await account(rate)); await approve(post);
  }
  await approve(await reel(await account(), null));
  assert.equal(await money(), 0);
  assert.equal(await scalar<number>("select count(*)::int as value from public.view_payout_claims"), 0);
});

test("creator ownership resolves UUID, worker code and email without guessing collisions", async () => {
  for (const alias of [worker, "WKR-1", "CREATOR@EXAMPLE.TEST"]) await approve(await reel(await account("₹10", "Per post", alias)));
  assert.equal(await money(), 30);
  await db.query("update public.profiles set email='creator@example.test' where id=$1", [admin]);
  await assert.rejects(approve(await reel(await account("₹10", "Per post", "creator@example.test"))), /reel_wallet_owner_unknown/);
  await db.query("update public.profiles set email='operator@example.test' where id=$1", [admin]);
});

test("manual saves are atomic; plain metric edits do not credit additional views", async () => {
  const id = await account();
  const input = { account_id: id, url: "https://www.instagram.com/reel/manual/", posted_at: posted, views: 1000, status: "approved" };
  const save = (value: object) => scalar<{ post: { id: string; status: string } }>("select public.save_social_post_with_wallet($1,$2) as value", [admin, value]);
  const first = await save(input);
  assert.equal(await money(), 49);
  const { status: _status, ...edited } = { ...input, views: 1500 };
  void _status;
  await save(edited);
  assert.equal(await money(), 49);
  await save({ ...input, views: 1500 });
  assert.equal(await money(), 73.5);
  await assert.rejects(save({ ...input, url: "https://www.instagram.com/reel/no-date/", posted_at: null }), /reel_date_required/);
  assert.equal(await scalar<number>("select count(*)::int as value from public.social_account_posts where url like '%no-date%'"), 0);
  assert.equal(first.post.status, "approved");
  const draft = await save({ account_id: id, url: "https://www.instagram.com/reel/draft/", posted_at: posted, views: 1000 });
  assert.equal(draft.post.status, "submitted", "new records require an explicit approval");
});

test("unexpected credit failures roll back post approval, frozen claim and work credit together", async () => {
  const post = await reel(await account());
  await db.exec(`create function public.test_reject_wallet_audit() returns trigger language plpgsql as $$
    begin if new.action='approved_reel_wallet_credit' then raise exception 'test_audit_failure'; end if; return new; end $$;
    create trigger test_reject_wallet_audit before insert on public.audit_events for each row execute function public.test_reject_wallet_audit();`);
  try {
    await assert.rejects(approve(post), /test_audit_failure/);
    assert.equal(await scalar<string>("select status as value from public.social_account_posts where id=$1", [post]), "submitted");
    assert.equal(await money(), 0);
    assert.equal(await scalar<number>("select count(*)::int as value from public.view_payout_claims"), 0);
  } finally {
    await db.exec("drop trigger test_reject_wallet_audit on public.audit_events; drop function public.test_reject_wallet_audit()");
  }
});

test("wallet read models return explicit zeros and uncapped lifetime credits even for removed reels", async () => {
  const id = await account("₹10", "Per post");
  await db.query("insert into public.social_account_posts(account_id,url,posted_at,status,views,source) select $1,'https://www.instagram.com/reel/history-'||n||'/',$2,'approved',1000,'profile' from generate_series(1,2101) n", [id, posted]);
  const first = await scalar<string>("select id as value from public.social_account_posts where account_id=$1 and url like '%history-1/'", [id]);
  const last = await scalar<string>("select id as value from public.social_account_posts where account_id=$1 and url like '%history-2101/'", [id]);
  await approve(last);
  await db.query("update public.social_account_posts set status='rejected',removed_at=now() where id=$1", [last]);
  const state = await walletState([first], [id]);
  assert.deepEqual(state.posts, [{ postId: first, creditedINR: 0, consumedViews: 0, pendingClaimINR: 0, fixedCredit: false }]);
  assert.deepEqual(state.accounts, [{ accountId: id, creditedINR: 10, creditedReels: 1 }]);
  assert.deepEqual((await walletState([last], [])).posts[0], { postId: last, creditedINR: 10, consumedViews: 0, pendingClaimINR: 0, fixedCredit: true });
  assert.deepEqual(await walletState([], []), { posts: [], accounts: [] });
});

test("withdrawals reserve the exact real credits and failed withdrawals release them without new credits", async () => {
  const post = await reel(await account("₹1500", "Per post"), null);
  await approve(post);
  await db.query("insert into public.worker_kyc(user_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path) values($1,'approved','Test Creator','2000-01-01','0000000000','Test address','Test','TEST-ID','test-document','test-selfie')", [worker]);
  await db.query("insert into public.upi_configs(worker_id,upi_id,verified) values($1,'creator@bank',true)", [worker]);
  const available = () => scalar<string>("select coalesce(sum(w.reward_inr),0) as value from public.work_items w where w.worker_id=$1 and w.status='Approved' and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed')", [worker]);
  assert.equal(Number(await available()), 1500);
  const withdrawal = await scalar<{ batchId: string }>("select public.request_payout($1) as value", [worker]);
  const repeated = await Promise.all([1, 2].map(() => scalar<{ batchId: string }>("select public.request_payout($1) as value", [worker])));
  assert.ok(repeated.every(result => result.batchId === withdrawal.batchId));
  assert.equal(await scalar<number>("select count(*)::int as value from public.payout_items where batch_id=$1", [withdrawal.batchId]), 1);
  assert.equal(Number(await available()), 0);
  assert.equal(Number(await scalar<string>("select sum(amount_inr) as value from public.payout_items where batch_id=$1", [withdrawal.batchId])), 1500);
  await db.query("select public.transition_payout($1,$2,'reject','Retry a corrected payout')", [admin, withdrawal.batchId]);
  assert.equal(Number(await available()), 1500);
  assert.equal(await money(), 1500);
  const retry = await scalar<{ batchId: string }>("select public.request_payout($1) as value", [worker]);
  assert.notEqual(retry.batchId, withdrawal.batchId);
  await db.query("select public.transition_payout($1,$2,'approve',null)", [admin, retry.batchId]);
  await db.query("select public.transition_payout($1,$2,'mark-paid','TEST-PAID-REFERENCE')", [admin, retry.batchId]);
  await approve(post);
  assert.equal(await money(), 1500, "a paid reel's approval retry cannot create replacement wallet funds");
  assert.equal(Number(await available()), 0);
  assert.equal(await scalar<string>("select status as value from public.payout_batches where id=$1", [retry.batchId]), "Paid");
  assert.equal(await scalar<string>("select payment_reference as value from public.payout_batches where id=$1", [retry.batchId]), "TEST-PAID-REFERENCE");
});

test("migration has no automatic backfill and financial RPCs are service-only", async () => {
  const old = await reel(await account(), 1000, "approved");
  assert.equal(await money(), 0, "an already-approved row without a new admin decision is untouched");
  assert.equal((await credit(old)).amountINR, 49, "explicit, authorized reconciliation remains possible separately");
  for (const fn of ["credit_approved_social_post(uuid,uuid)", "approve_social_post_and_credit(uuid,uuid,text)", "save_social_post_with_wallet(uuid,jsonb)", "social_post_wallet_state(uuid[],uuid[])"]) {
    assert.equal(await scalar<boolean>("select has_function_privilege('authenticated',$1,'execute') as value", [`public.${fn}`]), false);
    assert.equal(await scalar<boolean>("select has_function_privilege('anon',$1,'execute') as value", [`public.${fn}`]), false);
    assert.equal(await scalar<boolean>("select has_function_privilege('service_role',$1,'execute') as value", [`public.${fn}`]), true);
  }
});
