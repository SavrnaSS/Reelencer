-- An explicit admin reel approval credits the real withdrawal ledger in the same transaction.
-- No historical rows are changed here. Existing claim reservations, deductions and payments stay intact.

create function public.lock_social_reel_wallet_owner(p_account uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; owners uuid[]; owner_id uuid;
begin
 select * into a from public.linked_social_accounts where id=p_account;
 if not found then raise exception 'not_found'; end if;
 if nullif(btrim(a.worker_code),'') is null then raise exception 'reel_wallet_owner_unknown'; end if;
 select array_agg(id) into owners from public.profiles
  where lower(btrim(a.worker_code)) in (lower(id::text),lower(worker_code),lower(email));
 if coalesce(array_length(owners,1),0)<>1 then raise exception 'reel_wallet_owner_unknown'; end if;
 owner_id:=owners[1];
 -- Same order as claims and withdrawals. Approval/save RPCs acquire these before updating the post.
 perform 1 from public.profiles where id=owner_id and role='Worker' and active for update;
 if not found then raise exception 'worker_inactive'; end if;
 select * into a from public.linked_social_accounts where id=p_account for update;
 if not found then raise exception 'not_found'; end if;
 if a.status not in ('active','paused') then raise exception 'claim_account_inactive'; end if;
 select array_agg(id) into owners from public.profiles
  where lower(btrim(a.worker_code)) in (lower(id::text),lower(worker_code),lower(email));
 if coalesce(array_length(owners,1),0)<>1 or owners[1]<>owner_id then
  raise exception 'reel_wallet_owner_unknown';
 end if;
 return owner_id;
end; $$;

create function public.credit_approved_social_post(p_actor uuid,p_post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; worker uuid; a public.linked_social_accounts%rowtype;
 p public.social_account_posts%rowtype; g public.gigs%rowtype; existing public.work_items%rowtype;
 rate numeric; payable numeric; consumed bigint; claim_id uuid; credit_id uuid; basis text;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 select account_id into v_account_id from public.social_account_posts where id=p_post;
 if not found then raise exception 'not_found'; end if;
 worker:=public.lock_social_reel_wallet_owner(v_account_id);
 select * into a from public.linked_social_accounts where id=v_account_id;
 select * into p from public.social_account_posts where id=p_post for update;
 if not found then raise exception 'not_found'; end if;
 if p.account_id<>a.id then raise exception 'claim_evidence_changed'; end if;
 if p.status<>'approved' or p.removed_at is not null then
  return jsonb_build_object('credited',false,'amountINR',0,'reason','not_approved');
 end if;
 select * into g from public.gigs where id=a.gig_id;
 basis:=lower(btrim(coalesce(g.payout_type,'')));
 if basis not in ('per 1k views','per post') or btrim(coalesce(g.payout,'')) !~ '^(₹|INR)?[[:space:]]*([0-9]+|[0-9]{1,3}(,[0-9]{2,3})+)([.][0-9]{1,2})?$' then
  return jsonb_build_object('credited',false,'amountINR',0,'reason','invalid_inr_rate');
 end if;
 rate:=replace(regexp_replace(g.payout,'[^0-9.,]','','g'),',','')::numeric;
 if rate<=0 or rate>9999999999.99 then
  return jsonb_build_object('credited',false,'amountINR',0,'reason','invalid_inr_rate');
 end if;
 select * into existing from public.work_items where public_id='REEL-'||p.id::text;
 if found then
  if basis<>'per post' or existing.worker_id<>worker or existing.review->>'postId' is distinct from p.id::text then raise exception 'reel_wallet_basis_changed'; end if;
  return jsonb_build_object('credited',false,'amountINR',0,'workItemId',existing.id,'reason','already_credited','idempotent',true);
 end if;
 if basis='per post' then
  -- Changing a previously view-backed reel to a flat rate cannot make that same work payable again.
  if exists(select 1 from public.view_payout_claim_items where post_id=p.id) then raise exception 'reel_wallet_basis_changed'; end if;
  payable:=rate;
 else
  if p.views is null then return jsonb_build_object('credited',false,'amountINR',0,'reason','missing_views'); end if;
  select coalesce(max(i.to_views),0) into consumed
   from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id
   where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected');
  -- Full covered ranges remain consumed, including views excluded by a mixed authenticity review.
  if p.views<=consumed then return jsonb_build_object('credited',false,'amountINR',0,'reason','already_covered','idempotent',true); end if;
  payable:=round(p.views*rate/1000,2)-round(consumed*rate/1000,2);
 end if;
 if payable<=0 then return jsonb_build_object('credited',false,'amountINR',0,'reason','below_one_paise'); end if;
 if payable>9999999999.99 then raise exception 'invalid_view_rate'; end if;
 if p.posted_at is null then raise exception 'reel_date_required'; end if;
 if a.linked_at is null or p.posted_at<public.reel_tracking_start(a.linked_at) then raise exception 'reel_before_link'; end if;

 if basis='per post' then
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
   values('REEL-'||p.id::text,worker,'Approved reel earnings','Reel payout','Approved',payable,p_actor::text,now(),
    jsonb_build_object('postId',p.id,'accountId',a.id,'rateINR',rate,'basis','per post'),
    jsonb_build_object('source','reel_approval','postId',p.id,'note','Approved through reel review')) returning id into credit_id;
 else
  -- Approved claims do not interfere with the account's one Pending claim. Never label an admin content review organic.
  insert into public.view_payout_claims(account_id,worker_id,status,rate_inr,amount_inr,views,note,reviewed_at,reviewed_by,
    authenticity_review,approved_views,deducted_views,approved_amount_inr)
   values(a.id,worker,'Approved',rate,payable,p.views-consumed,'Approved through reel review',now(),p_actor,
    'unreviewed',p.views-consumed,0,payable) returning id into claim_id;
  insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at,reviewed_amount_inr)
   values(claim_id,p.id,p.url,consumed,p.views,payable,coalesce(p.views_source,p.source),coalesce(p.views_captured_at,p.updated_at,now()),payable);
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
   values('VIEW-'||claim_id::text,worker,'Approved reel view earnings','View payout','Approved',payable,p_actor::text,now(),
    jsonb_build_object('viewClaimId',claim_id,'postId',p.id,'views',p.views-consumed,'rateINR',rate),
    jsonb_build_object('source','view_payout_claim','claimId',claim_id,'postId',p.id,'method','reel_approval','note','Approved through reel review')) returning id into credit_id;
  update public.view_payout_claims set work_item_id=credit_id where id=claim_id;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,'approved_reel_wallet_credit',p.id::text,jsonb_build_object('workerId',worker,'accountId',a.id,'basis',basis,
   'amountINR',payable,'workItemId',credit_id,'claimId',claim_id,'fromViews',consumed,'toViews',p.views));
 return jsonb_build_object('credited',true,'amountINR',payable,'workItemId',credit_id,'claimId',claim_id);
end; $$;

create function public.credit_explicit_social_post_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'approved' or new.updated_by is null or not public.app_is_admin(new.updated_by) then return null; end if;
 if tg_op='UPDATE' and old.status='approved' and new.reviewed_at is not distinct from old.reviewed_at then return null; end if;
 perform public.credit_approved_social_post(new.updated_by,new.id);
 return null;
end; $$;
create trigger social_post_approval_wallet_insert after insert on public.social_account_posts
 for each row execute function public.credit_explicit_social_post_approval();
create trigger social_post_approval_wallet_update after update of status,reviewed_at on public.social_account_posts
 for each row execute function public.credit_explicit_social_post_approval();

create function public.approve_social_post_and_credit(p_actor uuid,p_post uuid,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; p public.social_account_posts%rowtype;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if char_length(coalesce(p_note,''))>500 then raise exception 'invalid_transition'; end if;
 select account_id into v_account_id from public.social_account_posts where id=p_post;
 if not found then raise exception 'not_found'; end if;
 perform public.lock_social_reel_wallet_owner(v_account_id);
 select * into p from public.social_account_posts where id=p_post for update;
 if not found then raise exception 'not_found'; end if;
 if p.account_id<>v_account_id then raise exception 'claim_evidence_changed'; end if;
 if p.removed_at is not null then raise exception 'reel_removed'; end if;
 update public.social_account_posts set status='approved',review_note=coalesce(btrim(p_note),''),updated_by=p_actor,
  reviewed_at=greatest(clock_timestamp(),coalesce(reviewed_at,'-infinity'::timestamptz)+interval '1 microsecond'),updated_at=clock_timestamp()
  where id=p.id returning * into p;
 return jsonb_build_object('post',to_jsonb(p));
end; $$;

-- Manual saves keep the same lock order as approvals. Editing metrics without a review never funds view growth.
create function public.save_social_post_with_wallet(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; current_post public.social_account_posts%rowtype; result public.social_account_posts%rowtype;
 metric text; value jsonb; desired_status text; review_at timestamptz; posting timestamptz; input_url text;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid_input'; end if;
 v_account_id:=(p_input->>'account_id')::uuid;
 input_url:=btrim(coalesce(p_input->>'url',''));
 if v_account_id is null or char_length(input_url) not between 8 and 500 or input_url !~* '^https://' then raise exception 'invalid_input'; end if;
 if char_length(coalesce(p_input->>'caption',''))>300 then raise exception 'invalid_input'; end if;
 foreach metric in array array['views','reach','likes','comments','shares','saves'] loop
  value:=p_input->metric;
  if value is not null and value<>'null'::jsonb and
    (jsonb_typeof(value)<>'number' or (value#>>'{}') !~ '^[0-9]+$' or (value#>>'{}')::numeric>2000000000) then raise exception 'invalid_input'; end if;
 end loop;
 if p_input ? 'status' and coalesce(p_input->>'status','') not in ('approved','rejected') then raise exception 'invalid_input'; end if;
 if nullif(p_input->>'views_source','') is not null and p_input->>'views_source' not in ('manual','api','profile','screenshot') then raise exception 'invalid_input'; end if;
 perform public.lock_social_reel_wallet_owner(v_account_id);
 select * into current_post from public.social_account_posts where account_id=v_account_id and url=input_url for update;
 if current_post.removed_at is not null then raise exception 'reel_removed'; end if;
 posting:=nullif(p_input->>'posted_at','')::timestamptz;
 if posting is not null and posting<public.reel_tracking_start((select linked_at from public.linked_social_accounts where id=v_account_id)) then raise exception 'reel_before_link'; end if;
 desired_status:=coalesce(p_input->>'status',current_post.status,'submitted');
 review_at:=case when p_input ? 'status' then greatest(clock_timestamp(),coalesce(current_post.reviewed_at,'-infinity'::timestamptz)+interval '1 microsecond') else current_post.reviewed_at end;
 insert into public.social_account_posts(account_id,url,caption,posted_at,views,views_captured_at,views_source,reach,likes,comments,shares,saves,status,reviewed_at,updated_by,updated_at)
 values(v_account_id,input_url,btrim(coalesce(p_input->>'caption','')),posting,(p_input->>'views')::integer,
  case when p_input->>'views' is not null then coalesce(nullif(p_input->>'views_captured_at','')::timestamptz,clock_timestamp()) else null end,
  case when p_input->>'views' is not null then coalesce(nullif(p_input->>'views_source',''),'manual') else null end,
  (p_input->>'reach')::integer,(p_input->>'likes')::integer,(p_input->>'comments')::integer,(p_input->>'shares')::integer,(p_input->>'saves')::integer,
  desired_status,review_at,p_actor,clock_timestamp())
 on conflict(account_id,url) do update set caption=excluded.caption,posted_at=excluded.posted_at,views=excluded.views,
  views_captured_at=excluded.views_captured_at,views_source=excluded.views_source,reach=excluded.reach,likes=excluded.likes,comments=excluded.comments,
  shares=excluded.shares,saves=excluded.saves,status=excluded.status,reviewed_at=excluded.reviewed_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at
 returning * into result;
 return jsonb_build_object('post',to_jsonb(result));
end; $$;

revoke all on function public.lock_social_reel_wallet_owner(uuid),public.credit_approved_social_post(uuid,uuid),
 public.credit_explicit_social_post_approval(),public.approve_social_post_and_credit(uuid,uuid,text),public.save_social_post_with_wallet(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.lock_social_reel_wallet_owner(uuid),public.credit_approved_social_post(uuid,uuid),
 public.approve_social_post_and_credit(uuid,uuid,text),public.save_social_post_with_wallet(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
