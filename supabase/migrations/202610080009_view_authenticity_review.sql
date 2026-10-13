-- Keep the measured Instagram counters and frozen claims intact; review changes wallet credit only.
alter table public.view_payout_claims
 add column authenticity_review text not null default 'unreviewed' check(authenticity_review in ('unreviewed','organic','mixed','suspected','insufficient')),
 add column approved_views bigint check(approved_views>=0),
 add column deducted_views bigint check(deducted_views>=0),
 add column approved_amount_inr numeric(12,2) check(approved_amount_inr>=0);
alter table public.view_payout_claim_items
 add column excluded_views bigint not null default 0 check(excluded_views between 0 and to_views-from_views),
 add column reviewed_amount_inr numeric(12,2) check(reviewed_amount_inr>=0),
 add column deduction_reason text not null default '' check(char_length(deduction_reason)<=1000),
 add column evidence_url text not null default '' check(char_length(evidence_url)<=1000 and (evidence_url='' or evidence_url ~ '^https://'));
-- Prior decisions retain their credits; they are not retroactively declared organic.
update public.view_payout_claims set approved_views=case when status='Approved' then views else 0 end,
 deducted_views=case when status='Hard rejected' then views else 0 end,
 approved_amount_inr=case when status='Approved' then amount_inr else 0 end where status<>'Pending';
update public.view_payout_claim_items i set excluded_views=case when c.status='Hard rejected' then i.to_views-i.from_views else 0 end,
 reviewed_amount_inr=case when c.status='Approved' then i.amount_inr else 0 end from public.view_payout_claims c where c.id=i.claim_id and c.status<>'Pending';

create table public.social_post_measurements (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.social_account_posts(id) on delete cascade,
 captured_at timestamptz not null, views bigint not null check(views>=0), likes bigint check(likes>=0), comments bigint check(comments>=0),
 source text not null check(source in ('manual','profile','api','screenshot')), unique(post_id,captured_at)
);
create index social_post_measurements_history on public.social_post_measurements(post_id,captured_at desc);
alter table public.social_post_measurements enable row level security;
revoke all on public.social_post_measurements from anon,authenticated;
grant all on public.social_post_measurements to service_role;
insert into public.social_post_measurements(post_id,captured_at,views,likes,comments,source)
 select id,coalesce(views_captured_at,updated_at),views,likes,comments,coalesce(views_source,source) from public.social_account_posts where views is not null;

create function public.stamp_social_view_measurement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.views is not null then
  if tg_op='INSERT' then new.views_captured_at:=coalesce(new.views_captured_at,new.updated_at,now()); new.views_source:=coalesce(new.views_source,new.source);
  elsif new.views is distinct from old.views and new.views_captured_at is not distinct from old.views_captured_at then
   new.views_captured_at:=now(); new.views_source:=coalesce(new.views_source,new.source);
  end if;
 end if;
 return new;
end; $$;
create function public.record_social_view_measurement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.views is null then return new; end if;
 if tg_op='UPDATE' then
  if new.views is not distinct from old.views and new.views_captured_at is not distinct from old.views_captured_at then return new; end if;
 end if;
 insert into public.social_post_measurements(post_id,captured_at,views,likes,comments,source)
 values(new.id,coalesce(new.views_captured_at,now()),new.views,new.likes,new.comments,coalesce(new.views_source,new.source)) on conflict(post_id,captured_at) do nothing;
 return new;
end; $$;
create trigger social_view_stamp before insert or update on public.social_account_posts for each row execute function public.stamp_social_view_measurement();
create trigger social_view_history after insert or update on public.social_account_posts for each row execute function public.record_social_view_measurement();
revoke all on function public.stamp_social_view_measurement(),public.record_social_view_measurement() from public,anon,authenticated;

create function public.review_view_payout_claim_authenticity(p_actor uuid,p_claim uuid,p_decision text,p_note text,p_assessment text,p_adjustments jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.view_payout_claims%rowtype; worker uuid; account uuid; wid uuid; adjustment jsonb; item public.view_payout_claim_items%rowtype;
 excluded numeric; total_excluded bigint; payable numeric; approved_count bigint; evidence jsonb;
begin
 if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 select worker_id,account_id into worker,account from public.view_payout_claims where id=p_claim;
 if not found then raise exception 'not_found'; end if;
 perform 1 from public.profiles where id=worker for update;
 perform 1 from public.linked_social_accounts where id=account for update;
 select * into c from public.view_payout_claims where id=p_claim for update;
 if p_decision not in ('Approved','Rejected','Hard rejected') or p_decision is null then raise exception 'invalid_transition'; end if;
 if c.status=p_decision then return to_jsonb(c); end if;
 if c.status<>'Pending' then raise exception 'invalid_transition'; end if;
 if nullif(btrim(p_note),'') is null then raise exception 'claim_review_reason_required'; end if;
 if length(p_note)>1000 then raise exception 'invalid_transition'; end if;
 if p_assessment not in ('organic','mixed','suspected','insufficient') or p_assessment is null then raise exception 'claim_authenticity_required'; end if;
 if p_adjustments is null or jsonb_typeof(p_adjustments)<>'array' then raise exception 'invalid_view_adjustment'; end if;
 if jsonb_array_length(p_adjustments)>2000 then raise exception 'invalid_view_adjustment'; end if;
 if p_decision<>'Approved' and jsonb_array_length(p_adjustments)>0 then raise exception 'invalid_view_adjustment'; end if;
 if exists(select 1 from jsonb_array_elements(p_adjustments) x group by x->>'itemId' having count(*)>1) then raise exception 'invalid_view_adjustment'; end if;
 perform 1 from public.view_payout_claim_items where claim_id=c.id order by id for update;
 for adjustment in select * from jsonb_array_elements(p_adjustments) loop
  select * into item from public.view_payout_claim_items where claim_id=c.id and id::text=adjustment->>'itemId';
  if not found or jsonb_typeof(adjustment->'excludedViews')<>'number' or coalesce(adjustment->>'excludedViews','') !~ '^[0-9]+$' then raise exception 'invalid_view_adjustment'; end if;
  excluded:=(adjustment->>'excludedViews')::numeric;
  if excluded<=0 or excluded>item.to_views-item.from_views then raise exception 'invalid_view_adjustment'; end if;
  if nullif(btrim(adjustment->>'reason'),'') is null or length(adjustment->>'reason')>1000 then raise exception 'claim_deduction_reason_required'; end if;
  if length(coalesce(adjustment->>'evidenceUrl',''))>1000 or (coalesce(adjustment->>'evidenceUrl','')<>'' and adjustment->>'evidenceUrl' !~ '^https://') then raise exception 'invalid_view_adjustment'; end if;
  update public.view_payout_claim_items set excluded_views=excluded::bigint,deduction_reason=btrim(adjustment->>'reason'),evidence_url=coalesce(adjustment->>'evidenceUrl','') where id=item.id;
 end loop;
 select coalesce(sum(excluded_views),0) into total_excluded from public.view_payout_claim_items where claim_id=c.id;
 if p_decision='Approved' then
  if (p_assessment='organic' and total_excluded<>0) or (p_assessment='mixed' and total_excluded=0) or p_assessment not in ('organic','mixed') then raise exception 'claim_authenticity_required'; end if;
  perform 1 from public.social_account_posts p join public.view_payout_claim_items i on i.post_id=p.id where i.claim_id=c.id order by p.id for update of p;
  if exists(select 1 from public.view_payout_claim_items i join public.social_account_posts p on p.id=i.post_id where i.claim_id=c.id and (p.status<>'approved' or p.views is null or p.views<i.to_views)) then raise exception 'claim_evidence_changed'; end if;
  update public.view_payout_claim_items set reviewed_amount_inr=round((to_views-excluded_views)*c.rate_inr/1000,2)-round(from_views*c.rate_inr/1000,2) where claim_id=c.id;
  select coalesce(sum(reviewed_amount_inr),0),coalesce(sum(to_views-from_views-excluded_views),0) into payable,approved_count from public.view_payout_claim_items where claim_id=c.id;
  if payable<=0 or approved_count<=0 then raise exception 'claim_no_eligible_views'; end if;
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
  values('VIEW-'||c.id::text,c.worker_id,'Approved view earnings','View payout','Approved',payable,p_actor::text,now(),
   jsonb_build_object('viewClaimId',c.id,'views',approved_count,'claimedViews',c.views,'excludedViews',total_excluded,'rateINR',c.rate_inr),
   jsonb_build_object('source','view_payout_claim','claimId',c.id,'note',p_note,'authenticity',p_assessment)) returning id into wid;
 else
  if p_assessment in ('organic','mixed') then raise exception 'claim_authenticity_required'; end if;
  payable:=0; approved_count:=0;
  if p_decision='Hard rejected' then
   update public.view_payout_claim_items set excluded_views=to_views-from_views,reviewed_amount_inr=0,deduction_reason=btrim(p_note) where claim_id=c.id;
   total_excluded:=c.views;
  else
   update public.view_payout_claim_items set reviewed_amount_inr=0 where claim_id=c.id;
  end if;
 end if;
 select jsonb_agg(jsonb_build_object('postId',i.post_id,'url',i.url,'fromViews',i.from_views,'toViews',i.to_views,'excludedViews',i.excluded_views,'payableINR',i.reviewed_amount_inr,'reason',i.deduction_reason,'evidenceUrl',i.evidence_url,'capturedAt',i.captured_at,
  'currentViews',p.views,'currentCapturedAt',p.views_captured_at)) into evidence from public.view_payout_claim_items i join public.social_account_posts p on p.id=i.post_id where i.claim_id=c.id;
 update public.view_payout_claims set status=p_decision,note=btrim(p_note),reviewed_at=now(),reviewed_by=p_actor,work_item_id=wid,
 authenticity_review=p_assessment,approved_views=approved_count,deducted_views=total_excluded,approved_amount_inr=payable where id=c.id returning * into c;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_authenticity_reviewed',c.id::text,
  jsonb_build_object('decision',p_decision,'assessment',p_assessment,'note',p_note,'requestedINR',c.amount_inr,'approvedINR',payable,'excludedViews',total_excluded,'walletCredit',wid,'evidence',evidence));
 return to_jsonb(c);
end; $$;
-- Old integrations can still reject; pending approvals must go through explicit authenticity review.
create or replace function public.review_view_payout_claim(p_actor uuid,p_claim uuid,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_decision='Approved' then
  if exists(select 1 from public.view_payout_claims where id=p_claim and status='Approved') then return (select to_jsonb(c) from public.view_payout_claims c where id=p_claim); end if;
  raise exception 'claim_authenticity_required';
 end if;
 if nullif(btrim(p_note),'') is null then raise exception 'claim_reason_required'; end if;
 return public.review_view_payout_claim_authenticity(p_actor,p_claim,p_decision,p_note,case when p_decision='Hard rejected' then 'suspected' else 'insufficient' end,'[]'::jsonb);
end; $$;
revoke all on function public.review_view_payout_claim_authenticity(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_view_payout_claim_authenticity(uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
