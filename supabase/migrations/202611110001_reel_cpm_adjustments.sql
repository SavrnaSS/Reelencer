-- Per-reel CPM adjustments.
--
-- The team can lower the per-1K rate of one reel (e.g. ₹49 → ₹20) when the reel or the creator's profile gets little
-- real interaction. The adjusted rate replaces the reel's view rate everywhere money is worked out:
--   plain reels:  the gig's rate per 1K views
--   plan reels:   the plan's rate past its threshold (the base per reel is unchanged)
-- Amounts stay cumulative, so an adjustment only changes views that haven't been credited or claimed yet: the next
-- interval pays f_adjusted(to) − f_adjusted(from). Clearing the adjustment restores the standard rate the same way.
--
-- Each adjustment carries reasons (shown to the creator with what to do about them) and an optional note.

alter table public.social_account_posts
 add column if not exists cpm_override_inr numeric(12,2) check(cpm_override_inr is null or (cpm_override_inr>0 and cpm_override_inr<=100000)),
 add column if not exists cpm_override_reasons text[] not null default '{}'
  check(cpm_override_reasons <@ array['low_reel_engagement','low_profile_engagement','no_bio_link','no_auto_dm','low_signups']::text[]),
 add column if not exists cpm_override_note text not null default '' check(char_length(cpm_override_note)<=300),
 add column if not exists cpm_override_at timestamptz,
 add column if not exists cpm_override_by uuid references auth.users(id) on delete set null;

-- An interval priced at an adjusted rate keeps the standard rate next to it, so the reel's "down from" stays known
-- after its first credit freezes the terms.
alter table public.view_payout_claim_items
 add column if not exists standard_rate_inr numeric(12,2) check(standard_rate_inr is null or standard_rate_inr>0);

-- The terms a reel would earn under without any adjustment (the previous social_post_payout_terms, reading the
-- standard rate of frozen plan intervals that were priced at an adjusted rate).
create or replace function public.social_post_standard_payout_terms(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; a public.linked_social_accounts%rowtype; g public.gigs%rowtype;
 gig_rate numeric; frozen record; plan jsonb;
begin
 select * into p from public.social_account_posts where id=p_post;
 if not found then return null; end if;
 select * into a from public.linked_social_accounts where id=p.account_id;
 select * into g from public.gigs where id=a.gig_id;
 gig_rate:=public.gig_view_rate(g.payout,g.payout_type);
 select i.payout_mode,coalesce(i.standard_rate_inr,i.item_rate_inr) as item_rate_inr,i.base_inr,i.threshold_views,i.plan_id,i.plan_name,i.to_views into frozen
  from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id
  where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected') order by i.to_views desc,c.created_at desc limit 1;
 if found then
  if frozen.payout_mode='cpm' then
   if gig_rate is null then return null; end if;
   return jsonb_build_object('mode','cpm','rateINR',gig_rate,'baseINR',0,'thresholdViews',0,'started',true,'consumedViews',frozen.to_views);
  end if;
  return jsonb_build_object('mode',frozen.payout_mode,'rateINR',frozen.item_rate_inr,'baseINR',frozen.base_inr,'thresholdViews',frozen.threshold_views,
   'planId',frozen.plan_id,'planName',frozen.plan_name,'started',true,'consumedViews',frozen.to_views);
 end if;
 if gig_rate is null then return null; end if;
 plan:=case when p.posted_at is not null then public.account_payout_plan(a.id,p.posted_at) end;
 if plan is not null then return (plan-'appliesFrom')||jsonb_build_object('started',false,'consumedViews',0); end if;
 return jsonb_build_object('mode','cpm','rateINR',gig_rate,'baseINR',0,'thresholdViews',0,'started',false,'consumedViews',0);
end; $$;

-- The terms a reel earns under: its standard terms, with the team's adjusted rate when one is set.
-- social_post_payout_due, the quote, claims and approval credits all read this, so they all pay the adjusted rate.
create or replace function public.social_post_payout_terms(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t jsonb; adjusted numeric;
begin
 t:=public.social_post_standard_payout_terms(p_post);
 if t is null then return null; end if;
 select cpm_override_inr into adjusted from public.social_account_posts where id=p_post;
 if adjusted is null then return t; end if;
 return t||jsonb_build_object('rateINR',adjusted,'standardRateINR',t->'rateINR','cpmAdjusted',true);
end; $$;

-- Freeze the adjusted rate on the interval itself. Plain intervals otherwise take the claim's (gig) rate at review,
-- which would pay the standard rate for views that were priced at the adjusted one.
create or replace function public.view_claim_item_cpm_adjustment() returns trigger
language plpgsql security definer set search_path='' as $$
declare t jsonb;
begin
 t:=public.social_post_payout_terms(new.post_id);
 if t is not null and coalesce((t->>'cpmAdjusted')::boolean,false)
  and (new.item_rate_inr is null or new.item_rate_inr=(t->>'rateINR')::numeric) then
  new.item_rate_inr:=(t->>'rateINR')::numeric;
  new.standard_rate_inr:=(t->>'standardRateINR')::numeric;
 end if;
 return new;
end; $$;
drop trigger if exists view_claim_item_cpm_adjustment on public.view_payout_claim_items;
create trigger view_claim_item_cpm_adjustment before insert on public.view_payout_claim_items
 for each row execute function public.view_claim_item_cpm_adjustment();

-- Set or clear a reel's adjusted CPM. Only lowers the rate: the standard terms stay the ceiling.
create or replace function public.admin_set_social_post_cpm(p_actor uuid,p_post uuid,p_rate numeric,p_reasons text[],p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; t jsonb; standard numeric; reasons text[];
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 select * into p from public.social_account_posts where id=p_post for update;
 if not found then raise exception 'not_found'; end if;
 if p.removed_at is not null then raise exception 'reel_removed'; end if;
 t:=public.social_post_standard_payout_terms(p_post);
 if t is null then raise exception 'cpm_not_view_based'; end if;
 standard:=(t->>'rateINR')::numeric;
 reasons:=coalesce((select array_agg(distinct r order by r) from unnest(coalesce(p_reasons,'{}'::text[])) r where nullif(btrim(r),'') is not null),'{}'::text[]);
 if p_rate is null then
  update public.social_account_posts set cpm_override_inr=null,cpm_override_reasons='{}',cpm_override_note='',cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id returning * into p;
 else
  if p_rate<=0 or p_rate>=standard or round(p_rate,2)<>p_rate then raise exception 'cpm_not_lower'; end if;
  if cardinality(reasons)=0 then raise exception 'cpm_reason_required'; end if;
  if not reasons <@ array['low_reel_engagement','low_profile_engagement','no_bio_link','no_auto_dm','low_signups']::text[] then raise exception 'cpm_reason_required'; end if;
  if char_length(coalesce(p_note,''))>300 then raise exception 'cpm_note_too_long'; end if;
  update public.social_account_posts set cpm_override_inr=p_rate,cpm_override_reasons=reasons,cpm_override_note=btrim(coalesce(p_note,'')),
   cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id returning * into p;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,case when p_rate is null then 'reel_cpm_restored' else 'reel_cpm_adjusted' end,p.id::text,
   jsonb_build_object('accountId',p.account_id,'standardRateINR',standard,'rateINR',p_rate,'reasons',to_jsonb(reasons),'note',p.cpm_override_note));
 return jsonb_build_object('post',to_jsonb(p));
end; $$;

-- The wallet read model also reports adjusted plain reels, so estimates use the adjusted rate.
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
  'posts',coalesce((select jsonb_agg(jsonb_build_object('postId',id,'creditedINR',credited,'consumedViews',consumed,'pendingClaimINR',pending,'fixedCredit',fixed)
    ||coalesce((select jsonb_build_object('payoutTerms',t-'consumedViews') from (select public.social_post_payout_terms(states.id) as t) x
      where t is not null and (t->>'mode'<>'cpm' or t ? 'cpmAdjusted')),'{}'::jsonb) order by id)
   from states where id=any(coalesce(p_posts,'{}'::uuid[]))),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('accountId',id,'creditedINR',credited,'creditedReels',reels)
    ||coalesce((select jsonb_build_object('payoutPlan',public.account_payout_plan(accounts.id,null)) where public.account_payout_plan(accounts.id,null) is not null),'{}'::jsonb) order by id) from accounts),'[]'::jsonb)
 )
$$;

revoke all on function public.social_post_standard_payout_terms(uuid),public.social_post_payout_terms(uuid),
 public.view_claim_item_cpm_adjustment(),public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text)
 from public,anon,authenticated;
grant execute on function public.social_post_standard_payout_terms(uuid),public.social_post_payout_terms(uuid),
 public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text)
 to service_role;
notify pgrst,'reload schema';
