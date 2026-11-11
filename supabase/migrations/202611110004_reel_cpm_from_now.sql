-- Per-reel CPM adjustments, part 3: "from now".
--
-- The team can start a reel's lower CPM at the moment they save it: the start point becomes the reel's view count
-- in the database right then (never a number from the admin's screen, which may be stale). Every view the reel had
-- keeps the full rate, so nothing already credited changes; only views gained afterwards earn the lower CPM.

alter table public.social_account_posts
 add column if not exists cpm_from_now boolean not null default false;

drop function if exists public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text,bigint);
create or replace function public.admin_set_social_post_cpm(p_actor uuid,p_post uuid,p_rate numeric,p_reasons text[],p_note text,p_after_views bigint default 0,p_from_now boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; t jsonb; standard numeric; reasons text[]; wallet jsonb; account uuid; after_views bigint;
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
  update public.social_account_posts set cpm_override_inr=null,cpm_override_reasons='{}',cpm_override_note='',cpm_after_views=0,cpm_from_now=false,
   cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id;
 else
  if p_rate<=0 or p_rate>=standard or round(p_rate,2)<>p_rate then raise exception 'cpm_not_lower'; end if;
  if coalesce(p_from_now,false) then
   -- Today's count, and never below views already credited or claimed, so no earned view is repriced.
   after_views:=greatest(coalesce(p.views,0),coalesce((t->>'consumedViews')::bigint,0),0);
  else
   if p_after_views is null or p_after_views<0 or p_after_views>1000000000 then raise exception 'cpm_after_views_invalid'; end if;
   after_views:=p_after_views;
  end if;
  if cardinality(reasons)=0 then raise exception 'cpm_reason_required'; end if;
  if not reasons <@ array['low_reel_engagement','low_profile_engagement','no_bio_link','no_auto_dm','low_signups']::text[] then raise exception 'cpm_reason_required'; end if;
  if char_length(coalesce(p_note,''))>300 then raise exception 'cpm_note_too_long'; end if;
  update public.social_account_posts set cpm_override_inr=p_rate,cpm_override_reasons=reasons,cpm_override_note=btrim(coalesce(p_note,'')),
   cpm_after_views=after_views,cpm_from_now=coalesce(p_from_now,false),cpm_override_at=now(),cpm_override_by=p_actor,updated_at=now()
   where id=p.id;
 end if;
 wallet:=public.reprice_social_post_wallet(p_actor,p.id);
 select * into p from public.social_account_posts where id=p_post;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,case when p_rate is null then 'reel_cpm_restored' else 'reel_cpm_adjusted' end,p.id::text,
   jsonb_build_object('accountId',p.account_id,'standardRateINR',standard,'rateINR',p_rate,'afterViews',p.cpm_after_views,'fromNow',p.cpm_from_now,
    'reasons',to_jsonb(reasons),'note',p.cpm_override_note)||wallet);
 return jsonb_build_object('post',to_jsonb(p),'wallet',wallet-'workerId');
end; $$;

revoke all on function public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.admin_set_social_post_cpm(uuid,uuid,numeric,text[],text,bigint,boolean) to service_role;
notify pgrst,'reload schema';
