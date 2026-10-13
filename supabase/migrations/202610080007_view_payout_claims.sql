-- Frozen claims reserve only the view growth not already reserved, credited or hard rejected.
create table public.view_payout_claims (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.linked_social_accounts(id),
 worker_id uuid not null references public.profiles(id), status text not null default 'Pending' check(status in ('Pending','Approved','Rejected','Hard rejected')),
 rate_inr numeric(12,2) not null check(rate_inr>0), amount_inr numeric(12,2) not null check(amount_inr>0), views bigint not null check(views>0),
 note text not null default '', created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id),
 work_item_id uuid unique references public.work_items(id)
);
create unique index view_claim_one_pending on public.view_payout_claims(account_id) where status='Pending';
create table public.view_payout_claim_items (
 id uuid primary key default gen_random_uuid(), claim_id uuid not null references public.view_payout_claims(id), post_id uuid not null references public.social_account_posts(id),
 url text not null, from_views bigint not null check(from_views>=0), to_views bigint not null check(to_views>from_views),
 amount_inr numeric(12,2) not null check(amount_inr>=0), source text not null, captured_at timestamptz not null, unique(claim_id,post_id)
);
create index view_claim_worker on public.view_payout_claims(worker_id,created_at desc);
create index view_claim_post on public.view_payout_claim_items(post_id,to_views desc);
alter table public.view_payout_claims enable row level security;
alter table public.view_payout_claim_items enable row level security;
revoke all on public.view_payout_claims,public.view_payout_claim_items from anon,authenticated;
grant all on public.view_payout_claims,public.view_payout_claim_items to service_role;

create function public.view_payout_quote(p_actor uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; g public.gigs%rowtype; code text; rate numeric; amount numeric; v bigint; missing integer; pending uuid;
begin
 select * into a from public.linked_social_accounts where id=p_account;
 if not found then raise exception 'not_found'; end if;
 select worker_code into code from public.profiles where id=p_actor and active;
 if not public.app_is_admin(p_actor) and (code is null or a.worker_code not in (code,p_actor::text)) then raise exception 'not_found'; end if;
 select * into g from public.gigs where id=a.gig_id;
 if lower(btrim(coalesce(g.payout_type,'')))<>'per 1k views' then raise exception 'invalid_view_rate'; end if;
 if btrim(g.payout) !~ '^(₹|INR)?[[:space:]]*([0-9]+|[0-9]{1,3}(,[0-9]{2,3})+)([.][0-9]{1,2})?$' then raise exception 'invalid_view_rate'; end if;
 rate:=replace(regexp_replace(g.payout,'[^0-9.,]','','g'),',','')::numeric;
 if rate<=0 or rate>9999999999.99 then raise exception 'invalid_view_rate'; end if;
 select id into pending from public.view_payout_claims where account_id=a.id and status='Pending';
 select count(*) into missing from public.social_account_posts where account_id=a.id and status='approved' and views is null;
 with eligible as (
  select p.views,coalesce((select max(i.to_views) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected')),0) as consumed
  from public.social_account_posts p where p.account_id=a.id and p.status='approved' and p.views is not null
 ) select coalesce(sum(greatest(views-consumed,0)),0),coalesce(sum(case when views>consumed then round(views*rate/1000,2)-round(consumed*rate/1000,2) else 0 end),0) into v,amount from eligible;
 return jsonb_build_object('accountId',a.id,'rateINR',rate,'claimableViews',v,'claimableINR',amount,'missingCounts',missing,'pendingClaimId',pending,'active',a.status='active');
end; $$;

create function public.submit_view_payout_claim(p_actor uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; q jsonb; c public.view_payout_claims%rowtype; evidence jsonb; amount numeric; total_views bigint;
begin
 perform 1 from public.profiles where id=p_actor and active for update;
 if not found then raise exception 'forbidden'; end if;
 select * into a from public.linked_social_accounts where id=p_account for update;
 if not exists(select 1 from public.profiles where id=p_actor and active and a.worker_code in (worker_code,p_actor::text)) then raise exception 'not_found'; end if;
 q:=public.view_payout_quote(p_actor,p_account);
 if a.status<>'active' then raise exception 'claim_account_inactive'; end if;
 if q->>'pendingClaimId' is not null then return jsonb_build_object('id',q->>'pendingClaimId','idempotent',true); end if;
 -- Lock the evidence while the claim snapshots are taken.
 perform 1 from public.social_account_posts where account_id=a.id order by id for update;
 q:=public.view_payout_quote(p_actor,p_account);
 if (q->>'claimableINR')::numeric<=0 then raise exception 'no_claimable_views'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'url',p.url,'from_views',x.consumed,'to_views',p.views,
 'amount_inr',round(p.views*(q->>'rateINR')::numeric/1000,2)-round(x.consumed*(q->>'rateINR')::numeric/1000,2),'source',p.source,'captured_at',p.updated_at)),'[]'::jsonb),
 coalesce(sum(round(p.views*(q->>'rateINR')::numeric/1000,2)-round(x.consumed*(q->>'rateINR')::numeric/1000,2)),0),coalesce(sum(p.views-x.consumed),0)
 into evidence,amount,total_views
 from public.social_account_posts p cross join lateral (
 select coalesce(max(i.to_views),0) as consumed from public.view_payout_claim_items i join public.view_payout_claims previous on previous.id=i.claim_id
 where i.post_id=p.id and previous.status in ('Pending','Approved','Hard rejected')
 ) x where p.account_id=a.id and p.status='approved' and p.views>x.consumed;
 if amount<=0 then raise exception 'no_claimable_views'; end if;
 insert into public.view_payout_claims(account_id,worker_id,rate_inr,amount_inr,views)
 values(a.id,p_actor,(q->>'rateINR')::numeric,amount,total_views) returning * into c;
 insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at)
 select c.id,e.post_id,e.url,e.from_views,e.to_views,e.amount_inr,e.source,e.captured_at from jsonb_to_recordset(evidence)
 as e(post_id uuid,url text,from_views bigint,to_views bigint,amount_inr numeric,source text,captured_at timestamptz);
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_submitted',c.id::text,q);
 return to_jsonb(c);
end; $$;

create function public.review_view_payout_claim(p_actor uuid,p_claim uuid,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.view_payout_claims%rowtype; worker uuid; account uuid; wid uuid;
begin
 if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 select worker_id,account_id into worker,account from public.view_payout_claims where id=p_claim;
 if not found then raise exception 'not_found'; end if;
 -- Same lock order as submission and wallet requests.
 perform 1 from public.profiles where id=worker for update;
 perform 1 from public.linked_social_accounts where id=account for update;
 select * into c from public.view_payout_claims where id=p_claim for update;
 if p_decision not in ('Approved','Rejected','Hard rejected') or p_decision is null then raise exception 'invalid_transition'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'invalid_transition'; end if;
 if c.status=p_decision then return to_jsonb(c); end if;
 if c.status<>'Pending' then raise exception 'invalid_transition'; end if;
 if p_decision<>'Approved' and nullif(btrim(p_note),'') is null then raise exception 'claim_reason_required'; end if;
 if p_decision='Approved' then
  perform 1 from public.social_account_posts p join public.view_payout_claim_items i on i.post_id=p.id where i.claim_id=c.id order by p.id for update of p;
  if exists(select 1 from public.view_payout_claim_items i join public.social_account_posts p on p.id=i.post_id where i.claim_id=c.id and (p.status<>'approved' or p.views is null or p.views<i.to_views)) then raise exception 'claim_evidence_changed'; end if;
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
  values('VIEW-'||c.id::text,c.worker_id,'Approved view earnings','View payout','Approved',c.amount_inr,p_actor::text,now(),jsonb_build_object('viewClaimId',c.id,'views',c.views,'rateINR',c.rate_inr),jsonb_build_object('source','view_payout_claim','claimId',c.id,'note',p_note)) returning id into wid;
 end if;
 update public.view_payout_claims set status=p_decision,note=coalesce(p_note,''),reviewed_at=now(),reviewed_by=p_actor,work_item_id=wid where id=c.id returning * into c;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_reviewed',c.id::text,jsonb_build_object('decision',p_decision,'note',p_note,'walletCredit',wid));
 return to_jsonb(c);
end; $$;
revoke all on function public.view_payout_quote(uuid,uuid),public.submit_view_payout_claim(uuid,uuid),public.review_view_payout_claim(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.view_payout_quote(uuid,uuid),public.submit_view_payout_claim(uuid,uuid),public.review_view_payout_claim(uuid,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
