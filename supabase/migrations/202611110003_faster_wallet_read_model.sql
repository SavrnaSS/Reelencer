-- Faster wallet read model for the admin's Linked accounts list.
--
-- social_post_wallet_state looked up every account's payout plan twice, and each lookup resolved the account's
-- owner by scanning every profile (lower(id::text) / lower(worker_code) / lower(email) can't use an index in that
-- form). With a few hundred linked accounts the statement ran past the database's statement timeout.
--
-- Now: the owner is found with three indexed lookups, and each account's plan is looked up once.

create index if not exists profiles_lower_worker_code on public.profiles(lower(worker_code));
create index if not exists profiles_lower_email on public.profiles(lower(email));

-- The creator who owns a linked account, when exactly one profile matches it (same rule as before).
create or replace function public.social_account_owner(p_worker_code text) returns uuid
language sql stable security definer set search_path='' as $$
 with code as (select lower(btrim(coalesce(p_worker_code,''))) as v), hits as (
  select p.id from public.profiles p, code
   where p.id=case when code.v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then code.v::uuid end
  union select p.id from public.profiles p, code where code.v<>'' and lower(p.worker_code)=code.v
  union select p.id from public.profiles p, code where code.v<>'' and lower(p.email)=code.v
 )
 select case when count(*)=1 then (array_agg(id))[1] end from hits
$$;

create or replace function public.social_post_wallet_state(p_posts uuid[], p_accounts uuid[] default '{}'::uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 with selected_posts as materialized (
  select p.id,p.account_id from public.social_account_posts p
  where p.id=any(coalesce(p_posts,'{}'::uuid[])) or p.account_id=any(coalesce(p_accounts,'{}'::uuid[]))
 ), claim_state as (
  select i.post_id,
   coalesce(sum(coalesce(i.reviewed_amount_inr,i.amount_inr)) filter(where c.status='Approved' and w.status='Approved' and w.worker_id=c.worker_id),0) as credited,
   coalesce(max(i.to_views) filter(where c.status in ('Pending','Approved','Hard rejected')),0) as consumed,
   coalesce(sum(i.amount_inr) filter(where c.status='Pending'),0) as pending
  from public.view_payout_claim_items i join selected_posts p on p.id=i.post_id
   join public.view_payout_claims c on c.id=i.claim_id and c.account_id=p.account_id left join public.work_items w on w.id=c.work_item_id
  group by i.post_id
 ), fixed_state as (
  select p.id as post_id,coalesce(sum(w.reward_inr) filter(where w.status='Approved'),0) as credited,
   count(*) filter(where w.status='Approved')>0 as fixed
  from selected_posts p join public.work_items w on w.public_id='REEL-'||p.id::text
   and w.review->>'source'='reel_approval' and w.review->>'postId'=p.id::text group by p.id
 ), states as materialized (
  select p.id,p.account_id,coalesce(c.credited,0)+coalesce(f.credited,0) as credited,
   coalesce(c.consumed,0) as consumed,coalesce(c.pending,0) as pending,coalesce(f.fixed,false) as fixed
  from selected_posts p left join claim_state c on c.post_id=p.id left join fixed_state f on f.post_id=p.id
 ), accounts as materialized (
  select a.id,coalesce(sum(s.credited),0) as credited,count(s.id) filter(where s.credited>0) as reels
  from public.linked_social_accounts a left join states s on s.account_id=a.id
  where a.id=any(coalesce(p_accounts,'{}'::uuid[])) group by a.id
 ), account_plans as materialized (
  select a.id,public.account_payout_plan(a.id,null) as plan from accounts a
 )
 select jsonb_build_object(
  'posts',coalesce((select jsonb_agg(jsonb_build_object('postId',id,'creditedINR',credited,'consumedViews',consumed,'pendingClaimINR',pending,'fixedCredit',fixed)
    ||coalesce((select jsonb_build_object('payoutTerms',t-'consumedViews') from (select public.social_post_payout_terms(states.id) as t) x
      where t is not null and (t->>'mode'<>'cpm' or t ? 'cpmAdjusted')),'{}'::jsonb) order by id)
   from states where id=any(coalesce(p_posts,'{}'::uuid[]))),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('accountId',a.id,'creditedINR',a.credited,'creditedReels',a.reels)
    ||case when pl.plan is not null then jsonb_build_object('payoutPlan',pl.plan) else '{}'::jsonb end order by a.id)
   from accounts a join account_plans pl on pl.id=a.id),'[]'::jsonb)
 )
$$;

notify pgrst,'reload schema';
