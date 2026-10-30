import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { summarizeAccountEarnings } from "../../lib/creatorEarnings";
import { creatorAccountData } from "../../lib/creatorDeviceCache";
import { readSocialAccountWalletCredits, readSocialPostWalletCredit } from "../../lib/socialWallet";
import type { LinkedSocialAccount, SocialPost } from "../../lib/socialAnalytics";

const wallet = (creditedINR = 0, consumedViews = 0, pendingClaimINR = 0, fixedCredit = false) => ({ creditedINR, consumedViews, pendingClaimINR, fixedCredit });
const post = (id: string, views: number | undefined, credit = wallet(), status: SocialPost["status"] = "approved"): SocialPost => ({
  id, views, walletCredit: credit, status, url: `https://instagram.com/reel/${id}/`, createdAt: "2026-10-30", updatedAt: "2026-10-30", postedAt: "2026-10-30", source: "profile", submittedByWorker: false,
});
const account = (posts: SocialPost[], amountINR = 0, reels = 0, overrides: Partial<LinkedSocialAccount> = {}): LinkedSocialAccount => ({
  id: "account", applicationId: "application", gigId: "gig", workerCode: "WKR-TEST", platform: "Instagram", handle: "creator", profileUrl: "https://instagram.com/creator/", linkedAt: "2026-10-01", status: "active", snapshots: [], posts,
  payout: "₹49", payoutType: "Per 1k Views", sync: { available: false, status: "pending" }, walletCredits: { amountINR, reels }, ...overrides,
});

test("credited earnings use wallet evidence while new views wait for review, preserving mixed deductions", () => {
  const result = summarizeAccountEarnings([account([post("mixed", 2000, wallet(39.2, 1800, 24.5))], 39.2, 1)]);
  assert.equal(result.walletVerified, true);
  assert.equal(result.approved, 39.2);
  assert.equal(result.pending, 34.3, "₹24.50 frozen pending claim + ₹9.80 new views; excluded/consumed views never re-enter");
  assert.equal(result.pendingReels, 1);
  assert.equal(result.approvedReels, 1);
});

test("incremental view estimates use cumulative rounding instead of rounding the delta alone", () => {
  const result = summarizeAccountEarnings([account([post("fraction", 1066, wallet(49.59, 1012))], 49.59, 1)]);
  assert.equal(result.pending, 2.64, "round(1066×49/1000) − round(1012×49/1000)");
});

test("every submitted reel remains in the review count even when its measured earnings are zero", () => {
  const waiting = Array.from({ length: 30 }, (_, i) => post(`waiting-${i}`, i === 0 ? 46904 : 0, wallet(), "submitted"));
  const result = summarizeAccountEarnings([account([...waiting, post("already-reviewed", 1000, wallet(49, 1000))], 49, 1)]);
  assert.equal(result.pending, 2298.30);
  assert.equal(result.pendingReels, 30);
  assert.equal(result.approvedReels, 1);
});

test("restored fixed-price reels cannot count their old credit again, and rate changes preserve real credits", () => {
  const a = account([post("fixed", undefined, wallet(25, 0, 0, true), "submitted"), post("new", undefined)], 25, 1, { payout: "₹49", payoutType: "Per post" });
  assert.equal(summarizeAccountEarnings([a]).approved, 25);
  assert.equal(summarizeAccountEarnings([a]).pending, 49);
  const switched = account([post("views", 2000, wallet(49, 1000))], 49, 1, { payout: "₹100" });
  assert.equal(summarizeAccountEarnings([switched]).approved, 49);
  assert.equal(summarizeAccountEarnings([switched]).pending, 100);
  assert.equal(summarizeAccountEarnings([{ ...switched, payout: "$100" }]).approved, 49, "existing INR ledger credits survive a currency change");
  assert.equal(summarizeAccountEarnings([{ ...switched, payout: "$100" }]).pending, 0, "foreign estimates never enter INR totals");
});

test("lifetime credits survive removed reels and retired accounts without exposing removed posts", () => {
  const data = creatorAccountData({ accounts: [account([{ ...post("gone", 5000, wallet(245, 5000)), removedAt: "2026-10-31" }], 245, 1)], screenshotReader: false });
  assert.equal(data.accounts[0].posts.length, 0);
  const result = summarizeAccountEarnings(data.accounts);
  assert.equal(result.approved, 245);
  assert.equal(result.approvedReels, 1);
  assert.equal(result.walletVerified, true);
  assert.equal(summarizeAccountEarnings([account([], 245, 1, { status: "unlinked" })]).approved, 245);
});

test("missing wallet evidence stays an estimate and cache allowlists retain only validated wallet fields", () => {
  const a = account([post("old", 1000)], 49, 1);
  delete a.posts[0].walletCredit;
  assert.equal(summarizeAccountEarnings([a]).walletVerified, false);
  assert.equal(summarizeAccountEarnings([a]).approved, 49);
  const good = account([post("kept", 1000, { ...wallet(49, 1000), privateData: "discard" } as ReturnType<typeof wallet>)], 49, 1);
  const cached = creatorAccountData({ accounts: [good], screenshotReader: false });
  assert.deepEqual(cached.accounts[0].walletCredits, { amountINR: 49, reels: 1 });
  assert.deepEqual(cached.accounts[0].posts[0].walletCredit, wallet(49, 1000));
  for (const value of [wallet(-1), wallet(Infinity), { ...wallet(), consumedViews: -1 }, { ...wallet(), consumedViews: 1.5 }, { ...wallet(), pendingClaimINR: "49" }]) assert.equal(readSocialPostWalletCredit(value), undefined);
  assert.equal(readSocialAccountWalletCredits({ amountINR: 49, reels: 1.2 }), undefined);
});

const db = new PGlite();
const aid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fixedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const worker = "11111111-1111-4111-8111-111111111111";
const otherWorker = "22222222-2222-4222-8222-222222222222";
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.linked_social_accounts(id uuid primary key);
    create table public.social_account_posts(id uuid primary key,account_id uuid,removed_at timestamptz);
    create table public.work_items(id uuid primary key default gen_random_uuid(),public_id text unique,worker_id uuid,status text,reward_inr numeric,review jsonb default '{}');
    create table public.view_payout_claims(id uuid primary key default gen_random_uuid(),account_id uuid,worker_id uuid,status text,work_item_id uuid);
    create table public.view_payout_claim_items(claim_id uuid,post_id uuid,to_views bigint,amount_inr numeric,reviewed_amount_inr numeric);
    insert into public.linked_social_accounts values('${aid}');
    insert into public.social_account_posts values('${pid}','${aid}',now()),('${fixedId}','${aid}',null);
    insert into public.work_items(public_id,worker_id,status,reward_inr) values('VIEW-good','${worker}','Approved',39.2),('VIEW-wrong','${otherWorker}','Approved',500);
    insert into public.work_items(public_id,worker_id,status,reward_inr,review) values('REEL-${fixedId}','${worker}','Approved',10.25,'{"source":"reel_approval","postId":"${fixedId}"}');
    insert into public.view_payout_claims(account_id,worker_id,status,work_item_id) select '${aid}','${worker}','Approved',id from public.work_items where public_id='VIEW-good';
    insert into public.view_payout_claim_items select id,'${pid}',1000,49,39.2 from public.view_payout_claims;
    insert into public.view_payout_claims(account_id,worker_id,status) values('${aid}','${worker}','Pending'),('${aid}','${worker}','Hard rejected'),('${aid}','${worker}','Rejected');
    insert into public.view_payout_claim_items select id,'${pid}',case status when 'Pending' then 1500 when 'Hard rejected' then 1800 else 2000 end,case status when 'Pending' then 24.5 else 10 end,0 from public.view_payout_claims where status<>'Approved';
    grant select on all tables in schema public to service_role;`);
  await db.exec(await readFile("supabase/migrations/202610300002_social_wallet_read_model.sql", "utf8"));
});
after(async () => { await db.close(); });

test("the SQL read model preserves deductions, frozen pending amounts and lifetime removed/fixed credits", async () => {
  const { rows } = await db.query<{ data: { posts: Array<{ postId: string; creditedINR: number; consumedViews: number; pendingClaimINR: number; fixedCredit: boolean }>; accounts: Array<{ creditedINR: number; creditedReels: number }> } }>("select public.social_post_wallet_state($1,$2) as data", [[pid, pid, fixedId], [aid]]);
  const data = rows[0].data;
  assert.equal(data.posts.length, 2);
  assert.deepEqual(data.posts.find(p => p.postId === pid), { postId: pid, creditedINR: 39.2, consumedViews: 1800, pendingClaimINR: 24.5, fixedCredit: false });
  assert.deepEqual(data.posts.find(p => p.postId === fixedId), { postId: fixedId, creditedINR: 10.25, consumedViews: 0, pendingClaimINR: 0, fixedCredit: true });
  assert.equal(data.accounts[0].creditedINR, 49.45);
  assert.equal(data.accounts[0].creditedReels, 2);
  const lifetime = (await db.query<{ data: { posts: unknown[]; accounts: Array<{ creditedINR: number }> } }>("select public.social_post_wallet_state('{}'::uuid[],$1) as data", [[aid]])).rows[0].data;
  assert.deepEqual(lifetime.posts, []);
  assert.equal(lifetime.accounts[0].creditedINR, 49.45);
});

test("wallet read model excludes mismatched work-item owners and is executable only by the service role", async () => {
  await db.exec(`insert into public.view_payout_claims(account_id,worker_id,status,work_item_id) select '${aid}','${worker}','Approved',id from public.work_items where public_id='VIEW-wrong';
    insert into public.view_payout_claim_items select id,'${pid}',3000,500,500 from public.view_payout_claims where work_item_id=(select id from public.work_items where public_id='VIEW-wrong');`);
  const value = (await db.query<{ data: { posts: Array<{ creditedINR: number }> } }>("select public.social_post_wallet_state($1) as data", [[pid]])).rows[0].data;
  assert.equal(value.posts[0].creditedINR, 39.2);
  const privileges = (await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon','public.social_post_wallet_state(uuid[],uuid[])','execute') as anon,has_function_privilege('authenticated','public.social_post_wallet_state(uuid[],uuid[])','execute') as authenticated,has_function_privilege('service_role','public.social_post_wallet_state(uuid[],uuid[])','execute') as service")).rows[0];
  assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
});
