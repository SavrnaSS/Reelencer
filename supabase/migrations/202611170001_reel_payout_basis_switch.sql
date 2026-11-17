-- Per-reel pay basis: move one reel off the creator's base-pay plan onto plain CPM, or back.
--
-- A creator on a payout plan earns a fixed base for every approved reel, with the view rate past a threshold
-- (202611030001_creator_payout_plans.sql). The team can now pay a particular reel at the gig's plain rate per 1,000
-- views instead, from its first view: no base. The switch covers the whole reel, including money already credited:
--   * the reel's frozen intervals are rewritten to plain CPM terms (the base-only interval of an unmeasured reel
--     becomes a zero-view interval worth ₹0), then
--   * reprice_social_post_wallet (202611110002) moves the difference in or out of the wallet. Money already
--     withdrawn can't be taken back; that part is reported as unrecovered.
-- The plan terms the reel had are kept on the reel, so switching back restores exactly those terms (and the base).
-- A lowered CPM (202611110001) stays on the reel while it's still below the new standard rate; otherwise it's cleared.

alter table public.social_account_posts
 add column if not exists payout_basis text check(payout_basis is null or payout_basis='cpm'),
 -- The plan terms the reel earned under before the switch (mode, rateINR, baseINR, thresholdViews, planId, planName).
 add column if not exists payout_basis_plan jsonb,
 add column if not exists payout_basis_at timestamptz,
 add column if not exists payout_basis_by uuid references auth.users(id) on delete set null,
 add constraint social_post_payout_basis_plan check(payout_basis is null or jsonb_typeof(payout_basis_plan)='object');

-- Intervals rewritten by a switch. A plan's base-only interval covers zero views; as plain CPM it stays a zero-view
-- interval (worth ₹0) so the reel's history and consumed views are unchanged.
alter table public.view_payout_claim_items add column if not exists rebased boolean not null default false;
alter table public.view_payout_claim_items drop constraint if exists view_claim_item_range;
alter table public.view_payout_claim_items add constraint view_claim_item_range
 check(to_views>from_views or (to_views=from_views and (opens_plan or rebased)));

-- Standard terms (no CPM adjustment): as before, except a reel switched to CPM never takes the account's plan.
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
  if frozen.payout_mode='cpm' or p.payout_basis='cpm' then
   if gig_rate is null then return null; end if;
   return jsonb_build_object('mode','cpm','rateINR',gig_rate,'baseINR',0,'thresholdViews',0,'started',true,'consumedViews',frozen.to_views);
  end if;
  return jsonb_build_object('mode',frozen.payout_mode,'rateINR',frozen.item_rate_inr,'baseINR',frozen.base_inr,'thresholdViews',frozen.threshold_views,
   'planId',frozen.plan_id,'planName',frozen.plan_name,'started',true,'consumedViews',frozen.to_views);
 end if;
 if gig_rate is null then return null; end if;
 plan:=case when p.posted_at is not null and p.payout_basis is null then public.account_payout_plan(a.id,p.posted_at) end;
 if plan is not null then return (plan-'appliesFrom')||jsonb_build_object('started',false,'consumedViews',0); end if;
 return jsonb_build_object('mode','cpm','rateINR',gig_rate,'baseINR',0,'thresholdViews',0,'started',false,'consumedViews',0);
end; $$;

-- Switch one reel to plain CPM ('cpm') or back to the plan terms it had ('plan'), repricing its credited earnings.
create or replace function public.admin_set_social_post_payout_basis(p_actor uuid,p_post uuid,p_basis text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; t jsonb; plan jsonb; account uuid; gig_rate numeric; wallet jsonb;
 standard numeric; cleared_cpm numeric; first_item uuid;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_basis is null or p_basis not in ('cpm','plan') then raise exception 'invalid_input'; end if;
 if char_length(coalesce(p_reason,''))>300 then raise exception 'invalid_input'; end if;
 select account_id into account from public.social_account_posts where id=p_post;
 if not found then raise exception 'not_found'; end if;
 -- Same lock order as approvals, claims, CPM changes and withdrawals: the creator's wallet, then the reel.
 perform public.lock_social_reel_wallet_owner(account);
 select * into p from public.social_account_posts where id=p_post for update;
 if p.removed_at is not null then raise exception 'reel_removed'; end if;
 perform 1 from public.view_payout_claim_items where post_id=p.id order by id for update;
 select public.gig_view_rate(g.payout,g.payout_type) into gig_rate
  from public.linked_social_accounts a join public.gigs g on g.id=a.gig_id where a.id=p.account_id;
 if gig_rate is null then raise exception 'cpm_not_view_based'; end if;

 if p_basis='cpm' then
  if p.payout_basis='cpm' then return jsonb_build_object('post',to_jsonb(p),'wallet',jsonb_build_object('walletChangeINR',0,'unrecoveredINR',0),'idempotent',true); end if;
  t:=public.social_post_standard_payout_terms(p.id);
  if t is null or t->>'mode'='cpm' then raise exception 'payout_basis_not_plan'; end if;
  plan:=jsonb_build_object('mode',t->'mode','rateINR',t->'rateINR','baseINR',t->'baseINR','thresholdViews',t->'thresholdViews')
   ||case when t ? 'planId' and t->>'planId' is not null then jsonb_build_object('planId',t->'planId') else '{}'::jsonb end
   ||case when coalesce(t->>'planName','')<>'' then jsonb_build_object('planName',t->'planName') else '{}'::jsonb end;
  update public.social_account_posts set payout_basis='cpm',payout_basis_plan=plan,payout_basis_at=now(),payout_basis_by=p_actor,updated_at=now() where id=p.id;
  -- Every consumed interval becomes plain CPM from view 0: no base, the gig's rate.
  update public.view_payout_claim_items i set payout_mode='cpm',item_rate_inr=gig_rate,base_inr=0,threshold_views=0,opens_plan=false,
    plan_id=null,plan_name='',rebased=true
   from public.view_payout_claims c
   where c.id=i.claim_id and i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected') and i.payout_mode<>'cpm';
  standard:=gig_rate;
 else
  if p.payout_basis is null then return jsonb_build_object('post',to_jsonb(p),'wallet',jsonb_build_object('walletChangeINR',0,'unrecoveredINR',0),'idempotent',true); end if;
  plan:=p.payout_basis_plan;
  if plan is null or plan->>'mode' not in ('beyond','all') or coalesce((plan->>'baseINR')::numeric,0)<=0
   or coalesce((plan->>'thresholdViews')::bigint,0)<=0 or coalesce((plan->>'rateINR')::numeric,0)<=0 then raise exception 'payout_basis_no_plan'; end if;
  update public.social_account_posts set payout_basis=null,payout_basis_plan=null,payout_basis_at=now(),payout_basis_by=p_actor,updated_at=now() where id=p.id;
  -- The reel's earliest consumed interval starts the plan again: it is where the base is paid.
  select i.id into first_item from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id
   where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected') and i.from_views=0 order by i.to_views,c.created_at,i.id limit 1;
  update public.view_payout_claim_items i set payout_mode=plan->>'mode',item_rate_inr=(plan->>'rateINR')::numeric,base_inr=(plan->>'baseINR')::numeric,
    threshold_views=(plan->>'thresholdViews')::bigint,opens_plan=(i.id=first_item),plan_id=(plan->>'planId')::uuid,plan_name=coalesce(plan->>'planName',''),rebased=true
   from public.view_payout_claims c
   where c.id=i.claim_id and i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected') and i.payout_mode='cpm';
  standard:=(plan->>'rateINR')::numeric;
 end if;

 -- A lowered CPM must stay below the reel's standard rate; one that no longer is would be a raise, so it's cleared.
 if p.cpm_override_inr is not null and p.cpm_override_inr>=standard then
  cleared_cpm:=p.cpm_override_inr;
  update public.social_account_posts set cpm_override_inr=null,cpm_override_reasons='{}',cpm_override_note='',cpm_after_views=0,cpm_from_now=false,
   cpm_override_at=now(),cpm_override_by=p_actor where id=p.id;
 end if;

 wallet:=public.reprice_social_post_wallet(p_actor,p.id);
 select * into p from public.social_account_posts where id=p_post;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,case when p_basis='cpm' then 'reel_switched_to_cpm' else 'reel_switched_to_plan' end,p.id::text,
   jsonb_build_object('accountId',p.account_id,'planTerms',plan,'gigRateINR',gig_rate,'reason',btrim(coalesce(p_reason,'')))
    ||case when cleared_cpm is not null then jsonb_build_object('clearedCpmINR',cleared_cpm) else '{}'::jsonb end||wallet);
 return jsonb_build_object('post',to_jsonb(p),'wallet',(wallet-'workerId')
  ||case when cleared_cpm is not null then jsonb_build_object('clearedCpmINR',cleared_cpm) else '{}'::jsonb end);
end; $$;

revoke all on function public.admin_set_social_post_payout_basis(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_set_social_post_payout_basis(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
