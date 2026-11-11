-- Per-reel CPM adjustments, part 2: "after N views" and repricing money already credited.
--
-- 1. An adjusted CPM can start after a view count the team picks (0, 5K, 10K…). A reel's views up to N keep the
--    standard rate and only views past N earn the adjusted rate:
--      f(v) = f_standard(min(v, N)) + f_adjusted(v) − f_adjusted(min(v, N))
--    With N = 0 the whole reel earns the adjusted rate. Plan reels keep their base; "f" is the plan formula.
--
-- 2. Setting, changing or clearing an adjustment reprices the reel's approved earnings too, not only future views.
--    Each approved interval is worked out again at the new terms and the difference goes to the wallet:
--      more  → added to the interval's wallet credit (or a separate top-up credit if that credit is already in a payout)
--      less  → taken from the reel's credits that are still in the wallet (not reserved for or paid in a payout)
--    Money already withdrawn can't be taken back; that part is reported to the team as unrecovered and the reel's
--    record keeps what was actually paid, so a later restore never pays it twice.

alter table public.social_account_posts
 add column if not exists cpm_after_views bigint not null default 0 check(cpm_after_views between 0 and 1000000000),
 -- Running total of wallet changes made by this reel's CPM adjustments (negative when money was taken back).
 add column if not exists cpm_wallet_change_inr numeric(12,2) not null default 0;
alter table public.view_payout_claim_items
 add column if not exists cpm_after_views bigint check(cpm_after_views is null or cpm_after_views>=0);

-- Cumulative earnings with an adjusted rate from `p_after` views on. Without a standard rate it is the plain formula.
create or replace function public.reel_payout_cumulative_split(p_views bigint,p_mode text,p_rate numeric,p_base numeric,p_threshold bigint,p_standard numeric,p_after bigint) returns numeric
language sql immutable set search_path='' as $$
 select case when p_standard is null or p_after is null then public.reel_payout_cumulative(p_views,p_mode,p_rate,p_base,p_threshold)
  else public.reel_payout_cumulative(least(p_views,p_after),p_mode,p_standard,p_base,p_threshold)
   +greatest(public.reel_payout_cumulative(p_views,p_mode,p_rate,p_base,p_threshold)-public.reel_payout_cumulative(least(p_views,p_after),p_mode,p_rate,p_base,p_threshold),0) end
$$;

create or replace function public.social_post_payout_terms(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t jsonb; p record;
begin
 t:=public.social_post_standard_payout_terms(p_post);
 if t is null then return null; end if;
 select cpm_override_inr,cpm_after_views into p from public.social_account_posts where id=p_post;
 if p.cpm_override_inr is null then return t; end if;
 return t||jsonb_build_object('rateINR',p.cpm_override_inr,'standardRateINR',t->'rateINR','cpmAdjusted',true,'cpmAfterViews',p.cpm_after_views);
end; $$;

-- What a reel is owed now (unchanged, except that amounts use the split formula).
create or replace function public.social_post_payout_due(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t jsonb; v bigint; consumed bigint; mode text; rate numeric; base numeric; threshold bigint; amount numeric; standard numeric; after_views bigint;
begin
 t:=public.social_post_payout_terms(p_post);
 if t is null then return null; end if;
 select views into v from public.social_account_posts where id=p_post;
 mode:=t->>'mode'; rate:=(t->>'rateINR')::numeric; base:=(t->>'baseINR')::numeric; threshold:=(t->>'thresholdViews')::bigint;
 standard:=(t->>'standardRateINR')::numeric; after_views:=(t->>'cpmAfterViews')::bigint;
 consumed:=(t->>'consumedViews')::bigint;
 if (t->>'started')::boolean or mode='cpm' then
  if v is null then return t||jsonb_build_object('fromViews',consumed,'toViews',consumed,'amountINR',0,'opensPlan',false,'reason','missing_views'); end if;
  if v<=consumed then return t||jsonb_build_object('fromViews',consumed,'toViews',consumed,'amountINR',0,'opensPlan',false,'reason','already_covered'); end if;
  amount:=public.reel_payout_cumulative_split(v,mode,rate,base,threshold,standard,after_views)-public.reel_payout_cumulative_split(consumed,mode,rate,base,threshold,standard,after_views);
  return t||jsonb_build_object('fromViews',consumed,'toViews',v,'amountINR',amount,'opensPlan',false,'reason',case when amount<=0 then 'below_one_paise' end);
 end if;
 v:=greatest(coalesce(v,0),0);
 amount:=public.reel_payout_cumulative_split(v,mode,rate,base,threshold,standard,after_views);
 return t||jsonb_build_object('fromViews',0,'toViews',v,'amountINR',amount,'opensPlan',true,'reason',null);
end; $$;

-- An interval's payable amount after excluded views, at its frozen terms (now including the split).
create or replace function public.view_claim_item_amount(i public.view_payout_claim_items,p_claim_rate numeric) returns numeric
language sql immutable set search_path='' as $$
 select public.reel_payout_cumulative_split(i.to_views-i.excluded_views,i.payout_mode,coalesce(i.item_rate_inr,p_claim_rate),i.base_inr,i.threshold_views,i.standard_rate_inr,i.cpm_after_views)
  -case when i.opens_plan then 0 else public.reel_payout_cumulative_split(i.from_views,i.payout_mode,coalesce(i.item_rate_inr,p_claim_rate),i.base_inr,i.threshold_views,i.standard_rate_inr,i.cpm_after_views) end
$$;

create or replace function public.view_claim_item_cpm_adjustment() returns trigger
language plpgsql security definer set search_path='' as $$
declare t jsonb;
begin
 t:=public.social_post_payout_terms(new.post_id);
 if t is not null and coalesce((t->>'cpmAdjusted')::boolean,false)
  and (new.item_rate_inr is null or new.item_rate_inr=(t->>'rateINR')::numeric) then
  new.item_rate_inr:=(t->>'rateINR')::numeric;
  new.standard_rate_inr:=(t->>'standardRateINR')::numeric;
  new.cpm_after_views:=(t->>'cpmAfterViews')::bigint;
 end if;
 return new;
end; $$;

-- Reprice one reel's approved intervals at its current terms and move the difference in or out of the wallet.
create or replace function public.reprice_social_post_wallet(p_actor uuid,p_post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb; adjusted boolean; r record; target numeric; diff numeric; take numeric; cut numeric; reserved boolean; topup record;
 added numeric:=0; removed numeric:=0; unrecovered numeric:=0; worker uuid; new_rate numeric;
begin
 t:=public.social_post_payout_terms(p_post);
 if t is null then return jsonb_build_object('walletChangeINR',0,'unrecoveredINR',0); end if;
 adjusted:=coalesce((t->>'cpmAdjusted')::boolean,false);
 new_rate:=(t->>'rateINR')::numeric;
 -- Every live interval of the reel takes the new terms (pending claims are then reviewed at them).
 update public.view_payout_claim_items i set
   -- Always explicit: a claim's own rate may be an earlier adjusted one, so it can't be the fallback.
   item_rate_inr=new_rate,
   standard_rate_inr=case when adjusted then (t->>'standardRateINR')::numeric end,
   cpm_after_views=case when adjusted then (t->>'cpmAfterViews')::bigint end
  from public.view_payout_claims c
  where c.id=i.claim_id and i.post_id=p_post and c.status in ('Pending','Approved') and i.payout_mode=t->>'mode';

 for r in select i.id,i.claim_id,i.amount_inr,i.reviewed_amount_inr,public.view_claim_item_amount(i,c.rate_inr) as target_amount,c.work_item_id as credit_id,c.worker_id as claim_worker
  from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id
  join public.work_items w on w.id=c.work_item_id and w.status='Approved'
  where i.post_id=p_post and c.status='Approved' order by i.to_views
 loop
  worker:=r.claim_worker;
  target:=r.target_amount;
  diff:=target-coalesce(r.reviewed_amount_inr,r.amount_inr);
  continue when diff=0;
  reserved:=exists(select 1 from public.payout_items p where p.work_item_id=r.credit_id and p.status<>'Failed');
  if diff>0 then
   if not reserved then
    update public.work_items set reward_inr=reward_inr+diff where id=r.credit_id;
   else
    insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
     values('CPMADJ-'||r.id::text||'-'||replace(gen_random_uuid()::text,'-',''),r.claim_worker,'Reel CPM adjustment','View payout','Approved',diff,p_actor::text,now(),
      jsonb_build_object('postId',p_post,'claimItemId',r.id,'viewClaimId',r.claim_id),
      jsonb_build_object('source','reel_cpm_adjustment','postId',p_post,'claimItemId',r.id,'note','CPM adjustment on credited views'));
   end if;
   update public.view_payout_claim_items set reviewed_amount_inr=target where id=r.id;
   update public.view_payout_claims set approved_amount_inr=coalesce(approved_amount_inr,0)+diff where id=r.claim_id;
   added:=added+diff;
  else
   take:=-diff;
   -- Top-ups for this interval that are still in the wallet go first, then the interval's own credit.
   for topup in select w.id,w.reward_inr from public.work_items w
    where w.review->>'source'='reel_cpm_adjustment' and w.review->>'claimItemId'=r.id::text and w.status='Approved' and w.reward_inr>0
     and not exists(select 1 from public.payout_items p where p.work_item_id=w.id and p.status<>'Failed') order by w.created_at desc
   loop
    exit when take<=0;
    update public.work_items set reward_inr=reward_inr-least(take,topup.reward_inr) where id=topup.id;
    take:=take-least(take,topup.reward_inr);
   end loop;
   if take>0 and not reserved then
    select least(take,reward_inr) into cut from public.work_items where id=r.credit_id;
    update public.work_items set reward_inr=reward_inr-cut where id=r.credit_id;
    take:=take-cut;
   end if;
   -- The interval keeps what was actually left with the creator.
   update public.view_payout_claim_items set reviewed_amount_inr=target+take where id=r.id;
   update public.view_payout_claims set approved_amount_inr=coalesce(approved_amount_inr,0)+diff+take where id=r.claim_id;
   removed:=removed+(-diff-take);
   unrecovered:=unrecovered+take;
  end if;
 end loop;
 if added<>0 or removed<>0 then
  update public.social_account_posts set cpm_wallet_change_inr=cpm_wallet_change_inr+added-removed where id=p_post;
 end if;
 return jsonb_build_object('walletChangeINR',added-removed,'unrecoveredINR',unrecovered,'workerId',worker);
end; $$;

drop function if exists public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text);
-- Set or clear a reel's adjusted CPM, from `p_after_views` on, and reprice the money already credited for it.
create or replace function public.admin_set_social_post_cpm(p_actor uuid,p_post uuid,p_rate numeric,p_reasons text[],p_note text,p_after_views bigint default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; t jsonb; standard numeric; reasons text[]; wallet jsonb; account uuid;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 select account_id into account from public.social_account_posts where id=p_post;
 if not found then raise exception 'not_found'; end if;
 -- Same lock order as approvals, claims and withdrawals: the creator's wallet, then the reel.
 perform public.lock_social_reel_wallet_owner(account);
 select * into p from public.social_account_posts where id=p_post for update;
 if p.removed_at is not null then raise exception 'reel_removed'; end if;
 t:=public.social_post_standard_payout_terms(p_post);
 if t is null then raise exception 'cpm_not_view_based'; end if;
 standard:=(t->>'rateINR')::numeric;
 reasons:=coalesce((select array_agg(distinct r order by r) from unnest(coalesce(p_reasons,'{}'::text[])) r where nullif(btrim(r),'') is not null),'{}'::text[]);
 if p_rate is null then
  update public.social_account_posts set cpm_override_inr=null,cpm_override_reasons='{}',cpm_override_note='',cpm_after_views=0,cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id;
 else
  if p_rate<=0 or p_rate>=standard or round(p_rate,2)<>p_rate then raise exception 'cpm_not_lower'; end if;
  if p_after_views is null or p_after_views<0 or p_after_views>1000000000 then raise exception 'cpm_after_views_invalid'; end if;
  if cardinality(reasons)=0 then raise exception 'cpm_reason_required'; end if;
  if not reasons <@ array['low_reel_engagement','low_profile_engagement','no_bio_link','no_auto_dm','low_signups']::text[] then raise exception 'cpm_reason_required'; end if;
  if char_length(coalesce(p_note,''))>300 then raise exception 'cpm_note_too_long'; end if;
  update public.social_account_posts set cpm_override_inr=p_rate,cpm_override_reasons=reasons,cpm_override_note=btrim(coalesce(p_note,'')),cpm_after_views=p_after_views,
   cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id;
 end if;
 wallet:=public.reprice_social_post_wallet(p_actor,p.id);
 select * into p from public.social_account_posts where id=p_post;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,case when p_rate is null then 'reel_cpm_restored' else 'reel_cpm_adjusted' end,p.id::text,
   jsonb_build_object('accountId',p.account_id,'standardRateINR',standard,'rateINR',p_rate,'afterViews',p.cpm_after_views,'reasons',to_jsonb(reasons),'note',p.cpm_override_note)||wallet);
 return jsonb_build_object('post',to_jsonb(p),'wallet',wallet-'workerId');
end; $$;

revoke all on function public.reel_payout_cumulative_split(bigint,text,numeric,numeric,bigint,numeric,bigint),
 public.reprice_social_post_wallet(uuid,uuid),public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text,bigint)
 from public,anon,authenticated;
grant execute on function public.reel_payout_cumulative_split(bigint,text,numeric,numeric,bigint,numeric,bigint),
 public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text,bigint)
 to service_role;
notify pgrst,'reload schema';
