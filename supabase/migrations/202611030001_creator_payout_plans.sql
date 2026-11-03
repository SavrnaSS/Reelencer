-- Custom payout plans for selected creators.
--
-- A plan pays a fixed base for every approved reel. The view rate (the plan's own rate, or the gig's) only applies
-- once a reel passes the plan's view threshold:
--   beyond: base + rate × (views − threshold) / 1,000          e.g. ₹200 up to 10K, then ₹49 per 1K above 10K
--   all:    base until the threshold, then max(base, rate × views / 1,000)
-- Reels without a plan keep paying the gig's plain rate per 1,000 views, exactly as before.
--
-- A reel's terms are decided once, when its first earnings interval is frozen (approval credit or claim), and are
-- stored on that interval. Every later interval of the same reel reuses them, so changing, archiving or reassigning
-- a plan only affects reels that haven't earned yet. Amounts stay cumulative: interval = f(to) − f(from), with the
-- first plan interval paying f(to) in full (that is where the base is paid).

create table public.creator_payout_plans (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 1 and 80),
 description text not null default '' check(char_length(description)<=300),
 base_inr numeric(12,2) not null check(base_inr>0 and base_inr<=1000000),
 threshold_views bigint not null check(threshold_views between 1 and 1000000000),
 rate_inr numeric(12,2) check(rate_inr is null or (rate_inr>0 and rate_inr<=100000)),
 mode text not null default 'all' check(mode in ('beyond','all')),
 gig_id text references public.gigs(id) on delete cascade,
 active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- One plan per creator keeps the payable terms of a reel unambiguous.
create table public.creator_payout_plan_members (
 worker_id uuid primary key references public.profiles(id) on delete cascade,
 plan_id uuid not null references public.creator_payout_plans(id) on delete cascade,
 applies_from timestamptz not null,
 assigned_by uuid references auth.users(id) on delete set null,
 assigned_at timestamptz not null default now()
);
create index creator_payout_plan_members_plan on public.creator_payout_plan_members(plan_id);
alter table public.creator_payout_plans enable row level security;
alter table public.creator_payout_plan_members enable row level security;
revoke all on public.creator_payout_plans,public.creator_payout_plan_members from anon,authenticated;
grant all on public.creator_payout_plans,public.creator_payout_plan_members to service_role;

-- Frozen terms on every earnings interval. Existing intervals are plain per-1K ('cpm') and keep their amounts.
alter table public.view_payout_claim_items
 add column payout_mode text not null default 'cpm' check(payout_mode in ('cpm','beyond','all')),
 add column item_rate_inr numeric(12,2) check(item_rate_inr is null or item_rate_inr>0),
 add column base_inr numeric(12,2) not null default 0 check(base_inr>=0),
 add column threshold_views bigint not null default 0 check(threshold_views>=0),
 add column plan_id uuid,
 add column plan_name text not null default '' check(char_length(plan_name)<=80),
 add column opens_plan boolean not null default false,
 add constraint view_claim_item_plan_terms check(
  (payout_mode='cpm' and not opens_plan and base_inr=0) or
  (payout_mode<>'cpm' and item_rate_inr is not null and base_inr>0 and threshold_views>0));
-- A plan's first interval may cover zero measured views: it carries the reel's base pay.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.view_payout_claim_items'::regclass and contype='c'
  and pg_get_constraintdef(oid) ~ 'to_views > from_views' loop
  execute format('alter table public.view_payout_claim_items drop constraint %I',c.conname);
 end loop;
 for c in select conname from pg_constraint where conrelid='public.view_payout_claims'::regclass and contype='c'
  and pg_get_constraintdef(oid) ~ '\(views > 0\)' loop
  execute format('alter table public.view_payout_claims drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.view_payout_claim_items add constraint view_claim_item_range check(to_views>from_views or (opens_plan and to_views=from_views));
alter table public.view_payout_claims add constraint view_claim_views_nonnegative check(views>=0);
create index if not exists view_claim_item_plan on public.view_payout_claim_items(plan_id) where plan_id is not null;

-- The gig's valid INR rate per 1,000 views, or null.
create function public.gig_view_rate(p_payout text,p_type text) returns numeric
language sql immutable set search_path='' as $$
 select case when lower(btrim(coalesce(p_type,'')))='per 1k views'
  and btrim(coalesce(p_payout,'')) ~ '^(₹|INR)?[[:space:]]*([0-9]+|[0-9]{1,3}(,[0-9]{2,3})+)([.][0-9]{1,2})?$'
  and replace(regexp_replace(p_payout,'[^0-9.,]','','g'),',','')::numeric between 0.01 and 9999999999.99
  then replace(regexp_replace(p_payout,'[^0-9.,]','','g'),',','')::numeric end
$$;

-- Cumulative, rounded earnings for a reel at a view count. Every amount is a difference of two of these.
create function public.reel_payout_cumulative(p_views bigint,p_mode text,p_rate numeric,p_base numeric,p_threshold bigint) returns numeric
language sql immutable set search_path='' as $$
 select case p_mode
  when 'beyond' then p_base+round(greatest(p_views-p_threshold,0)*p_rate/1000,2)
  when 'all' then case when p_views<=p_threshold then p_base else greatest(p_base,round(p_views*p_rate/1000,2)) end
  else round(p_views*p_rate/1000,2) end
$$;

-- The creator who owns a linked account, when exactly one profile matches it.
create function public.social_account_owner(p_worker_code text) returns uuid
language sql stable security definer set search_path='' as $$
 select case when count(*)=1 then (array_agg(id))[1] end from public.profiles
 where nullif(btrim(p_worker_code),'') is not null and lower(btrim(p_worker_code)) in (lower(id::text),lower(worker_code),lower(email))
$$;

-- The plan a new reel on this account would earn under (null for plain per-1K pay).
create function public.account_payout_plan(p_account uuid,p_posted_at timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('mode',pl.mode,'rateINR',coalesce(pl.rate_inr,public.gig_view_rate(g.payout,g.payout_type)),
  'baseINR',pl.base_inr,'thresholdViews',pl.threshold_views,'planId',pl.id,'planName',pl.name,'appliesFrom',m.applies_from)
 from public.linked_social_accounts a join public.gigs g on g.id=a.gig_id
  join public.creator_payout_plan_members m on m.worker_id=public.social_account_owner(a.worker_code)
  join public.creator_payout_plans pl on pl.id=m.plan_id
 where a.id=p_account and pl.active and (pl.gig_id is null or pl.gig_id=a.gig_id)
  and public.gig_view_rate(g.payout,g.payout_type) is not null
  and (p_posted_at is null or p_posted_at>=m.applies_from)
$$;

-- The terms a reel earns under: frozen from its latest consumed interval, else the owner's current plan, else the
-- gig's plain rate. Plain reels follow the gig's current rate, as they always have.
create function public.social_post_payout_terms(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.social_account_posts%rowtype; a public.linked_social_accounts%rowtype; g public.gigs%rowtype;
 gig_rate numeric; frozen record; plan jsonb;
begin
 select * into p from public.social_account_posts where id=p_post;
 if not found then return null; end if;
 select * into a from public.linked_social_accounts where id=p.account_id;
 select * into g from public.gigs where id=a.gig_id;
 gig_rate:=public.gig_view_rate(g.payout,g.payout_type);
 select i.payout_mode,i.item_rate_inr,i.base_inr,i.threshold_views,i.plan_id,i.plan_name,i.to_views into frozen
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

-- What a reel is owed now, as the interval the next credit or claim would freeze. Null for non-view gigs.
create function public.social_post_payout_due(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t jsonb; v bigint; consumed bigint; mode text; rate numeric; base numeric; threshold bigint; amount numeric;
begin
 t:=public.social_post_payout_terms(p_post);
 if t is null then return null; end if;
 select views into v from public.social_account_posts where id=p_post;
 mode:=t->>'mode'; rate:=(t->>'rateINR')::numeric; base:=(t->>'baseINR')::numeric; threshold:=(t->>'thresholdViews')::bigint;
 consumed:=(t->>'consumedViews')::bigint;
 if (t->>'started')::boolean or mode='cpm' then
  if v is null then return t||jsonb_build_object('fromViews',consumed,'toViews',consumed,'amountINR',0,'opensPlan',false,'reason','missing_views'); end if;
  if v<=consumed then return t||jsonb_build_object('fromViews',consumed,'toViews',consumed,'amountINR',0,'opensPlan',false,'reason','already_covered'); end if;
  amount:=public.reel_payout_cumulative(v,mode,rate,base,threshold)-public.reel_payout_cumulative(consumed,mode,rate,base,threshold);
  return t||jsonb_build_object('fromViews',consumed,'toViews',v,'amountINR',amount,'opensPlan',false,'reason',case when amount<=0 then 'below_one_paise' end);
 end if;
 -- First plan interval: the base is owed on approval, measured or not.
 v:=greatest(coalesce(v,0),0);
 amount:=public.reel_payout_cumulative(v,mode,rate,base,threshold);
 return t||jsonb_build_object('fromViews',0,'toViews',v,'amountINR',amount,'opensPlan',true,'reason',null);
end; $$;

-- An interval's payable amount after excluded views, at its frozen terms.
create function public.view_claim_item_amount(i public.view_payout_claim_items,p_claim_rate numeric) returns numeric
language sql immutable set search_path='' as $$
 select public.reel_payout_cumulative(i.to_views-i.excluded_views,i.payout_mode,coalesce(i.item_rate_inr,p_claim_rate),i.base_inr,i.threshold_views)
  -case when i.opens_plan then 0 else public.reel_payout_cumulative(i.from_views,i.payout_mode,coalesce(i.item_rate_inr,p_claim_rate),i.base_inr,i.threshold_views) end
$$;

create or replace function public.credit_approved_social_post(p_actor uuid,p_post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; worker uuid; a public.linked_social_accounts%rowtype;
 p public.social_account_posts%rowtype; g public.gigs%rowtype; existing public.work_items%rowtype;
 rate numeric; payable numeric; claim_id uuid; credit_id uuid; basis text; due jsonb;
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
  if exists(select 1 from public.view_payout_claim_items where post_id=p.id) then raise exception 'reel_wallet_basis_changed'; end if;
  payable:=rate;
 else
  due:=public.social_post_payout_due(p.id);
  if due is null then return jsonb_build_object('credited',false,'amountINR',0,'reason','invalid_inr_rate'); end if;
  if due->>'reason' in ('missing_views','already_covered') then
   return jsonb_build_object('credited',false,'amountINR',0,'reason',due->>'reason')||case when due->>'reason'='already_covered' then '{"idempotent":true}'::jsonb else '{}'::jsonb end;
  end if;
  payable:=(due->>'amountINR')::numeric;
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
  insert into public.view_payout_claims(account_id,worker_id,status,rate_inr,amount_inr,views,note,reviewed_at,reviewed_by,
    authenticity_review,approved_views,deducted_views,approved_amount_inr)
   values(a.id,worker,'Approved',(due->>'rateINR')::numeric,payable,(due->>'toViews')::bigint-(due->>'fromViews')::bigint,'Approved through reel review',now(),p_actor,
    'unreviewed',(due->>'toViews')::bigint-(due->>'fromViews')::bigint,0,payable) returning id into claim_id;
  insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at,reviewed_amount_inr,
    payout_mode,item_rate_inr,base_inr,threshold_views,plan_id,plan_name,opens_plan)
   values(claim_id,p.id,p.url,(due->>'fromViews')::bigint,(due->>'toViews')::bigint,payable,coalesce(p.views_source,p.source),coalesce(p.views_captured_at,p.updated_at,now()),payable,
    due->>'mode',case when due->>'mode'<>'cpm' then (due->>'rateINR')::numeric end,(due->>'baseINR')::numeric,(due->>'thresholdViews')::bigint,
    (due->>'planId')::uuid,coalesce(due->>'planName',''),(due->>'opensPlan')::boolean);
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
   values('VIEW-'||claim_id::text,worker,case when due->>'mode'='cpm' then 'Approved reel view earnings' else 'Approved reel earnings ('||coalesce(due->>'planName','payout plan')||')' end,'View payout','Approved',payable,p_actor::text,now(),
    jsonb_build_object('viewClaimId',claim_id,'postId',p.id,'views',(due->>'toViews')::bigint-(due->>'fromViews')::bigint,'rateINR',(due->>'rateINR')::numeric)
     ||case when due->>'mode'<>'cpm' then jsonb_build_object('payoutPlan',due->'planId','baseINR',due->'baseINR','thresholdViews',due->'thresholdViews','basePaid',due->'opensPlan') else '{}'::jsonb end,
    jsonb_build_object('source','view_payout_claim','claimId',claim_id,'postId',p.id,'method','reel_approval','note','Approved through reel review')) returning id into credit_id;
  update public.view_payout_claims set work_item_id=credit_id where id=claim_id;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor,'approved_reel_wallet_credit',p.id::text,jsonb_build_object('workerId',worker,'accountId',a.id,'basis',basis,
   'amountINR',payable,'workItemId',credit_id,'claimId',claim_id,'fromViews',due->'fromViews','toViews',coalesce(due->'toViews',to_jsonb(p.views)),
   'payoutMode',coalesce(due->>'mode','per post'),'planId',due->'planId'));
 return jsonb_build_object('credited',true,'amountINR',payable,'workItemId',credit_id,'claimId',claim_id);
end; $$;

create or replace function public.view_payout_quote(p_actor uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; g public.gigs%rowtype; code text; rate numeric; amount numeric; v bigint; missing integer; pending uuid; plan jsonb;
begin
 select * into a from public.linked_social_accounts where id=p_account;
 if not found then raise exception 'not_found'; end if;
 select worker_code into code from public.profiles where id=p_actor and active;
 if not public.app_is_admin(p_actor) and (code is null or a.worker_code not in (code,p_actor::text)) then raise exception 'not_found'; end if;
 select * into g from public.gigs where id=a.gig_id;
 rate:=public.gig_view_rate(g.payout,g.payout_type);
 if rate is null then raise exception 'invalid_view_rate'; end if;
 select id into pending from public.view_payout_claims where account_id=a.id and status='Pending';
 with eligible as (
  select p.views,public.social_post_payout_due(p.id) as due from public.social_account_posts p
  where p.account_id=a.id and p.status='approved' and (p.posted_at is null or p.posted_at>=public.reel_tracking_start(a.linked_at))
 ) select coalesce(sum(greatest((due->>'toViews')::bigint-(due->>'fromViews')::bigint,0)) filter(where (due->>'amountINR')::numeric>0),0),
   coalesce(sum((due->>'amountINR')::numeric) filter(where (due->>'amountINR')::numeric>0),0),
   count(*) filter(where views is null and coalesce((due->>'amountINR')::numeric,0)<=0)
  into v,amount,missing from eligible;
 plan:=public.account_payout_plan(a.id,null);
 return jsonb_build_object('accountId',a.id,'rateINR',rate,'claimableViews',v,'claimableINR',amount,'missingCounts',missing,'pendingClaimId',pending,'active',a.status='active')
  ||case when plan is not null then jsonb_build_object('payoutPlan',plan) else '{}'::jsonb end;
end; $$;

create or replace function public.submit_view_payout_claim(p_actor uuid,p_account uuid) returns jsonb
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
 -- Freeze each reel's interval at its own terms (plain per-1K or its payout plan).
 select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'url',p.url,'source',coalesce(p.views_source,p.source),
   'captured_at',coalesce(p.views_captured_at,p.updated_at,now()),'due',d.due) order by p.id),'[]'::jsonb),
  coalesce(sum((d.due->>'amountINR')::numeric),0),coalesce(sum((d.due->>'toViews')::bigint-(d.due->>'fromViews')::bigint),0)
 into evidence,amount,total_views
 from public.social_account_posts p cross join lateral (select public.social_post_payout_due(p.id) as due) d
 where p.account_id=a.id and p.status='approved' and (p.posted_at is null or p.posted_at>=public.reel_tracking_start(a.linked_at))
  and coalesce((d.due->>'amountINR')::numeric,0)>0;
 if amount<=0 then raise exception 'no_claimable_views'; end if;
 insert into public.view_payout_claims(account_id,worker_id,rate_inr,amount_inr,views)
 values(a.id,p_actor,(q->>'rateINR')::numeric,amount,total_views) returning * into c;
 insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at,
   payout_mode,item_rate_inr,base_inr,threshold_views,plan_id,plan_name,opens_plan)
 select c.id,(e->>'post_id')::uuid,e->>'url',(e->'due'->>'fromViews')::bigint,(e->'due'->>'toViews')::bigint,(e->'due'->>'amountINR')::numeric,e->>'source',(e->>'captured_at')::timestamptz,
  e->'due'->>'mode',case when e->'due'->>'mode'<>'cpm' then (e->'due'->>'rateINR')::numeric end,(e->'due'->>'baseINR')::numeric,(e->'due'->>'thresholdViews')::bigint,
  (e->'due'->>'planId')::uuid,coalesce(e->'due'->>'planName',''),(e->'due'->>'opensPlan')::boolean
 from jsonb_array_elements(evidence) e;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_submitted',c.id::text,q);
 return to_jsonb(c);
end; $$;

create or replace function public.review_view_payout_claim_authenticity(p_actor uuid,p_claim uuid,p_decision text,p_note text,p_assessment text,p_adjustments jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.view_payout_claims%rowtype; worker uuid; account uuid; wid uuid; adjustment jsonb; item public.view_payout_claim_items%rowtype;
 excluded numeric; total_excluded bigint; payable numeric; approved_count bigint; evidence jsonb; base_paid numeric;
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
  -- A plan's base-only interval (zero views) may be approved before the reel has a measured count.
  if exists(select 1 from public.view_payout_claim_items i join public.social_account_posts p on p.id=i.post_id where i.claim_id=c.id
   and (p.status<>'approved' or (p.views is null and i.to_views>0) or p.views<i.to_views)) then raise exception 'claim_evidence_changed'; end if;
  update public.view_payout_claim_items i set reviewed_amount_inr=public.view_claim_item_amount(i,c.rate_inr) where claim_id=c.id;
  select coalesce(sum(reviewed_amount_inr),0),coalesce(sum(to_views-from_views-excluded_views),0),coalesce(sum(base_inr) filter(where opens_plan),0)
   into payable,approved_count,base_paid from public.view_payout_claim_items where claim_id=c.id;
  if payable<=0 or (approved_count<=0 and base_paid<=0) then raise exception 'claim_no_eligible_views'; end if;
  insert into public.work_items(public_id,worker_id,title,type,status,reward_inr,created_by,completed_at,submission,review)
  values('VIEW-'||c.id::text,c.worker_id,'Approved view earnings','View payout','Approved',payable,p_actor::text,now(),
   jsonb_build_object('viewClaimId',c.id,'views',approved_count,'claimedViews',c.views,'excludedViews',total_excluded,'rateINR',c.rate_inr)
    ||case when base_paid>0 then jsonb_build_object('basePaidINR',base_paid) else '{}'::jsonb end,
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
  'currentViews',p.views,'currentCapturedAt',p.views_captured_at,'payoutMode',i.payout_mode,'baseINR',i.base_inr,'opensPlan',i.opens_plan)) into evidence
  from public.view_payout_claim_items i join public.social_account_posts p on p.id=i.post_id where i.claim_id=c.id;
 update public.view_payout_claims set status=p_decision,note=btrim(p_note),reviewed_at=now(),reviewed_by=p_actor,work_item_id=wid,
 authenticity_review=p_assessment,approved_views=approved_count,deducted_views=total_excluded,approved_amount_inr=payable where id=c.id returning * into c;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_authenticity_reviewed',c.id::text,
  jsonb_build_object('decision',p_decision,'assessment',p_assessment,'note',p_note,'requestedINR',c.amount_inr,'approvedINR',payable,'excludedViews',total_excluded,'walletCredit',wid,'evidence',evidence));
 return to_jsonb(c);
end; $$;

-- The wallet read model also reports each reel's payout terms, so estimates match what approval will credit.
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
    ||coalesce((select jsonb_build_object('payoutTerms',t-'consumedViews') from (select public.social_post_payout_terms(states.id) as t) x where t is not null and t->>'mode'<>'cpm'),'{}'::jsonb) order by id)
   from states where id=any(coalesce(p_posts,'{}'::uuid[]))),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('accountId',id,'creditedINR',credited,'creditedReels',reels)
    ||coalesce((select jsonb_build_object('payoutPlan',public.account_payout_plan(accounts.id,null)) where public.account_payout_plan(accounts.id,null) is not null),'{}'::jsonb) order by id) from accounts),'[]'::jsonb)
 )
$$;

-- Admin writes. Every change is audited; none of them touch frozen intervals or credited money.
create function public.admin_save_payout_plan(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare plan public.creator_payout_plans%rowtype; plan_id uuid; v_name text; v_base numeric; v_threshold bigint; v_rate numeric; v_mode text; v_gig text; v_active boolean; v_description text;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid_input'; end if;
 v_name:=btrim(coalesce(p_input->>'name',''));
 v_description:=btrim(coalesce(p_input->>'description',''));
 if char_length(v_name) not between 1 and 80 or char_length(v_description)>300 then raise exception 'invalid_input'; end if;
 if coalesce(p_input->>'baseINR','') !~ '^[0-9]+([.][0-9]{1,2})?$' or coalesce(p_input->>'thresholdViews','') !~ '^[0-9]+$' then raise exception 'invalid_input'; end if;
 if nullif(p_input->>'rateINR','') is not null and p_input->>'rateINR' !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'invalid_input'; end if;
 v_base:=(p_input->>'baseINR')::numeric; v_threshold:=(p_input->>'thresholdViews')::bigint; v_rate:=nullif(p_input->>'rateINR','')::numeric;
 v_mode:=coalesce(nullif(p_input->>'mode',''),'all'); v_gig:=nullif(btrim(coalesce(p_input->>'gigId','')),'');
 v_active:=coalesce((p_input->>'active')::boolean,true);
 if v_mode not in ('beyond','all') then raise exception 'invalid_input'; end if;
 if v_gig is not null and not exists(select 1 from public.gigs g where g.id=v_gig and public.gig_view_rate(g.payout,g.payout_type) is not null) then raise exception 'payout_plan_gig_not_view_based'; end if;
 plan_id:=nullif(p_input->>'id','')::uuid;
 if plan_id is null then
  insert into public.creator_payout_plans(name,description,base_inr,threshold_views,rate_inr,mode,gig_id,active,created_by,updated_by)
   values(v_name,v_description,v_base,v_threshold,v_rate,v_mode,v_gig,v_active,p_actor,p_actor) returning * into plan;
 else
  update public.creator_payout_plans set name=v_name,description=v_description,base_inr=v_base,threshold_views=v_threshold,rate_inr=v_rate,
   mode=v_mode,gig_id=v_gig,active=v_active,updated_by=p_actor,updated_at=now() where id=plan_id returning * into plan;
  if not found then raise exception 'not_found'; end if;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'payout_plan_saved',plan.id::text,to_jsonb(plan));
 return to_jsonb(plan);
end; $$;

-- Assign creators to a plan (moving them off any other plan), or remove them when p_plan is null.
create function public.admin_assign_payout_plan(p_actor uuid,p_plan uuid,p_workers uuid[],p_applies_from timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare plan public.creator_payout_plans%rowtype; changed integer; moved integer; missing integer;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_workers is null or coalesce(array_length(p_workers,1),0) not between 1 and 1000 then raise exception 'invalid_input'; end if;
 select count(*) into missing from unnest(p_workers) w where not exists(select 1 from public.profiles p where p.id=w and p.role='Worker');
 if p_plan is null then
  delete from public.creator_payout_plan_members where worker_id=any(p_workers);
  get diagnostics changed=row_count;
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'payout_plan_removed','creators',jsonb_build_object('workers',to_jsonb(p_workers),'removed',changed));
  return jsonb_build_object('assigned',0,'removed',changed,'moved',0,'skipped',missing);
 end if;
 select * into plan from public.creator_payout_plans where id=p_plan for update;
 if not found then raise exception 'not_found'; end if;
 if not plan.active then raise exception 'payout_plan_inactive'; end if;
 if p_applies_from is null or p_applies_from>now()+interval '366 days' or p_applies_from<now()-interval '366 days' then raise exception 'invalid_input'; end if;
 select count(*) into moved from public.creator_payout_plan_members where worker_id=any(p_workers) and plan_id<>p_plan;
 insert into public.creator_payout_plan_members(worker_id,plan_id,applies_from,assigned_by,assigned_at)
  select distinct w,p_plan,p_applies_from,p_actor,now() from unnest(p_workers) w join public.profiles p on p.id=w and p.role='Worker'
 on conflict(worker_id) do update set plan_id=excluded.plan_id,applies_from=excluded.applies_from,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 get diagnostics changed=row_count;
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'payout_plan_assigned',plan.id::text,
  jsonb_build_object('workers',to_jsonb(p_workers),'assigned',changed,'moved',moved,'skipped',missing,'appliesFrom',p_applies_from,
   'terms',jsonb_build_object('baseINR',plan.base_inr,'thresholdViews',plan.threshold_views,'rateINR',plan.rate_inr,'mode',plan.mode,'gigId',plan.gig_id)));
 return jsonb_build_object('assigned',changed,'removed',0,'moved',moved,'skipped',missing);
end; $$;

-- Plans with their creators and what they have paid so far.
create function public.admin_payout_plans() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'plans',coalesce((select jsonb_agg(to_jsonb(pl)||jsonb_build_object(
    'gigTitle',(select g.title from public.gigs g where g.id=pl.gig_id),
    'memberCount',(select count(*) from public.creator_payout_plan_members m where m.plan_id=pl.id),
    'reels',(select count(distinct i.post_id) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.plan_id=pl.id and c.status in ('Pending','Approved')),
    'creditedINR',(select coalesce(sum(i.reviewed_amount_inr),0) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.plan_id=pl.id and c.status='Approved'),
    'baseCreditedINR',(select coalesce(sum(least(i.base_inr,i.reviewed_amount_inr)),0) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.plan_id=pl.id and i.opens_plan and c.status='Approved')
   ) order by pl.active desc,pl.created_at desc) from public.creator_payout_plans pl),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(jsonb_build_object('workerId',m.worker_id,'planId',m.plan_id,'appliesFrom',m.applies_from,'assignedAt',m.assigned_at,
    'workerCode',p.worker_code,'email',p.email) order by m.assigned_at desc)
   from public.creator_payout_plan_members m join public.profiles p on p.id=m.worker_id),'[]'::jsonb),
  'gigs',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'company',g.company,'rateINR',public.gig_view_rate(g.payout,g.payout_type)) order by g.title)
   from public.gigs g where public.gig_view_rate(g.payout,g.payout_type) is not null),'[]'::jsonb)
 )
$$;

revoke all on function public.gig_view_rate(text,text),public.reel_payout_cumulative(bigint,text,numeric,numeric,bigint),
 public.social_account_owner(text),public.account_payout_plan(uuid,timestamptz),public.social_post_payout_terms(uuid),
 public.social_post_payout_due(uuid),public.view_claim_item_amount(public.view_payout_claim_items,numeric),
 public.admin_save_payout_plan(uuid,jsonb),public.admin_assign_payout_plan(uuid,uuid,uuid[],timestamptz),public.admin_payout_plans()
 from public,anon,authenticated;
grant execute on function public.gig_view_rate(text,text),public.reel_payout_cumulative(bigint,text,numeric,numeric,bigint),
 public.social_account_owner(text),public.account_payout_plan(uuid,timestamptz),public.social_post_payout_terms(uuid),
 public.social_post_payout_due(uuid),public.view_claim_item_amount(public.view_payout_claim_items,numeric),
 public.admin_save_payout_plan(uuid,jsonb),public.admin_assign_payout_plan(uuid,uuid,uuid[],timestamptz),public.admin_payout_plans()
 to service_role;
notify pgrst,'reload schema';
