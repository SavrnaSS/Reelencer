-- Read actual, ledger-backed reel credits separately from changing platform counters. Historical credits remain
-- in account totals even when their reels are removed or excluded from the creator's current reel list.
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
 ), accounts as (
  select a.id,coalesce(sum(s.credited),0) as credited,count(s.id) filter(where s.credited>0) as reels
  from public.linked_social_accounts a left join states s on s.account_id=a.id
  where a.id=any(coalesce(p_accounts,'{}'::uuid[])) group by a.id
 )
 select jsonb_build_object(
  'posts',coalesce((select jsonb_agg(jsonb_build_object('postId',id,'creditedINR',credited,'consumedViews',consumed,'pendingClaimINR',pending,'fixedCredit',fixed) order by id)
   from states where id=any(coalesce(p_posts,'{}'::uuid[]))),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('accountId',id,'creditedINR',credited,'creditedReels',reels) order by id) from accounts),'[]'::jsonb)
 )
$$;
revoke all on function public.social_post_wallet_state(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.social_post_wallet_state(uuid[],uuid[]) to service_role;
notify pgrst,'reload schema';
