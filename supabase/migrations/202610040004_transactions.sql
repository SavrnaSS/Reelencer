create or replace function public.app_is_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=p_actor and lower(u.email)='savarnasumit@gmail.com' and u.email_confirmed_at is not null and p.active);
$$;

create or replace function public.bootstrap_worker(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u auth.users%rowtype; p public.profiles%rowtype;
begin
  select * into u from auth.users where id=p_user and email_confirmed_at is not null;
  if not found then raise exception 'forbidden'; end if;
  insert into public.profiles(id,role,display_name,email)
    values(p_user,case when lower(u.email)='savarnasumit@gmail.com' then 'Admin' else 'Worker' end,
      coalesce(nullif(u.raw_user_meta_data->>'name',''),u.email),u.email)
    on conflict(id) do nothing;
  select * into p from public.profiles where id=p_user for update;
  if not p.active then raise exception 'forbidden'; end if;
  update public.profiles set role=case when lower(u.email)='savarnasumit@gmail.com' then 'Admin' else 'Worker' end,
    email=u.email where id=p_user returning * into p;
  if p.role='Worker' then
    insert into public.workers(id,user_id,name,email,active)
      values(p.worker_code,p_user,coalesce(p.display_name,'Worker'),u.email,true)
      on conflict(user_id) do nothing;
  end if;
  return jsonb_build_object('id',p.id,'role',p.role,'workerCode',p.worker_code,'worker_code',p.worker_code,'display_name',p.display_name);
end; $$;

create or replace function public.consume_api_rate_limit(p_key text,p_limit integer,p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_window_seconds not between 1 and 3600 then raise exception 'forbidden'; end if;
  insert into public.api_rate_limits(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_window_seconds))
  on conflict(key) do update set
    count=case when public.api_rate_limits.expires_at<=now() then 1 else public.api_rate_limits.count+1 end,
    expires_at=case when public.api_rate_limits.expires_at<=now() then excluded.expires_at else public.api_rate_limits.expires_at end
  returning count into n;
  -- Bound abandoned buckets without a separate scheduler.
  if random()<0.01 then delete from public.api_rate_limits where expires_at<now()-interval '1 hour'; end if;
  return n<=p_limit;
end; $$;

create or replace function public.transition_work_item(p_actor uuid,p_item text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.work_items%rowtype; next_status text; admin_actor boolean;
begin
  admin_actor:=public.app_is_admin(p_actor);
  select * into w from public.work_items where id::text=p_item or public_id=p_item for update;
  if not found or (w.worker_id<>p_actor and not admin_actor) then raise exception 'not_found'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and active) then raise exception 'forbidden'; end if;
  if p_action='start' then
    if w.status='In progress' then return to_jsonb(w); end if;
    if w.status<>'Open' then raise exception 'invalid_transition'; end if;
    next_status:='In progress';
    update public.work_items set status=next_status,started_at=now() where id=w.id returning * into w;
  elsif p_action='submit' then
    if w.status not in ('Open','In progress','Needs fix') or coalesce(w.review->>'source','')='gig_assignment_approval' then raise exception 'invalid_transition'; end if;
    if coalesce(p_payload->>'reelUrl','') !~ '^https://' or coalesce(p_payload->>'screenshotUrl','') !~ '^https://' then raise exception 'invalid_transition'; end if;
    next_status:='Submitted';
    update public.work_items set status=next_status,submission=p_payload||jsonb_build_object('submittedAt',now()),
      gates=coalesce(gates,'{}')||'{"proofAttached":true}'::jsonb,review=null,completed_at=now()
      where id=w.id returning * into w;
  elsif p_action='review' then
    if not admin_actor then raise exception 'forbidden'; end if;
    if coalesce(w.review->>'source','')='gig_assignment_approval' then raise exception 'invalid_transition'; end if;
    next_status:=p_payload->>'status';
    if next_status not in ('Approved','Needs fix','Hard rejected') or next_status is null then raise exception 'invalid_transition'; end if;
    if w.status=next_status then return to_jsonb(w); end if;
    if w.status<>'Submitted' or exists(select 1 from public.payout_items where work_item_id=w.id and status<>'Failed') then raise exception 'invalid_transition'; end if;
    update public.work_items set status=next_status,review=coalesce(p_payload->'review','{}'),
      completed_at=case when next_status in ('Approved','Hard rejected') then now() else null end
      where id=w.id returning * into w;
  else raise exception 'invalid_transition'; end if;
  update public.work_items set audit=jsonb_build_array(jsonb_build_object('at',now(),'by',case when admin_actor then 'Admin' else 'Worker' end,'text',next_status))||coalesce(audit,'[]') where id=w.id returning * into w;
  insert into public.work_item_audit(work_item_id,actor_id,action) values(w.id,p_actor,p_action);
  return to_jsonb(w);
end; $$;

create or replace function public.save_upi_config(p_worker uuid,p_upi text,p_schedule text,p_day text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype;
begin
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  if p_upi !~ '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$' or length(p_upi)>100 or p_schedule not in ('Weekly','Monthly') then raise exception 'invalid_transition'; end if;
  select * into u from public.upi_configs where worker_id=p_worker;
  if u.upi_id is distinct from p_upi and exists(select 1 from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing')) then raise exception 'active_batch'; end if;
  insert into public.upi_configs(worker_id,upi_id,payout_schedule,payout_day) values(p_worker,p_upi,p_schedule,p_day)
  on conflict(worker_id) do update set upi_id=excluded.upi_id,payout_schedule=excluded.payout_schedule,payout_day=excluded.payout_day,
    verified=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified else false end,
    verified_at=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified_at else null end,
    verified_by=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified_by else null end
  returning * into u;
  return to_jsonb(u);
end; $$;

create or replace function public.verify_upi_config(p_actor uuid,p_worker uuid,p_upi text,p_verified boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  perform 1 from public.profiles where id=p_worker for update;
  update public.upi_configs set verified=p_verified,verified_at=case when p_verified then now() else null end,
    verified_by=case when p_verified then p_actor else null end where worker_id=p_worker and upi_id=p_upi returning * into u;
  if not found then raise exception 'invalid_transition'; end if;
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'upi_verification',p_worker::text,jsonb_build_object('verified',p_verified));
  return to_jsonb(u);
end; $$;

create or replace function public.request_payout(p_worker uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; b public.payout_batches%rowtype; ids uuid[]; total numeric(12,2); n integer; today date;
begin
  -- The worker lock serializes payout requests and UPI changes across all server instances.
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into b from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing');
  if found then return jsonb_build_object('batchId',b.id,'itemCount',(select count(*) from public.payout_items where batch_id=b.id),'idempotent',true); end if;
  if not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved') then raise exception 'kyc_required'; end if;
  select * into u from public.upi_configs where worker_id=p_worker and verified for update;
  if not found then raise exception 'upi_required'; end if;
  perform 1 from public.work_items w where w.worker_id=p_worker and w.status='Approved' for update;
  select array_agg(w.id),coalesce(sum(w.reward_inr),0),count(*) into ids,total,n
    from public.work_items w where w.worker_id=p_worker and w.status='Approved' and w.reward_inr>0
    and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed');
  if total<1000 then raise exception 'minimum_amount'; end if;
  today:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot)
    values(p_worker,case when u.payout_schedule='Monthly' then 'Month '||to_char(today,'YYYY-MM') else 'Week of '||to_char(date_trunc('week',today),'YYYY-MM-DD') end,
      date_trunc(case when u.payout_schedule='Monthly' then 'month' else 'week' end,today)::date,today,'Draft','UPI','["Requested by worker"]',u.upi_id) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_worker,'payout_requested',b.id::text,jsonb_build_object('amount',total,'items',n));
  return jsonb_build_object('batchId',b.id,'itemCount',n);
end; $$;

create or replace function public.transition_payout(p_actor uuid,p_batch uuid,p_action text,p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.payout_batches%rowtype; worker uuid;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_id into worker from public.payout_batches where id=p_batch;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.profiles where id=worker for update;
  select * into b from public.payout_batches where id=p_batch for update;
  if p_action='approve' then
    if b.status='Processing' then return to_jsonb(b); end if;
    if b.status<>'Draft' then raise exception 'invalid_transition'; end if;
    if not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved') then raise exception 'kyc_required'; end if;
    if not exists(select 1 from public.upi_configs where worker_id=b.worker_id and verified and upi_id=b.upi_id_snapshot) then raise exception 'upi_required'; end if;
    if not exists(select 1 from public.payout_items where batch_id=b.id and status='Included') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Processing',processed_at=now(),processed_by=p_actor,
      notes=notes||case when nullif(p_note,'') is null then '[]'::jsonb else jsonb_build_array('ETA:'||p_note) end where id=b.id;
  elsif p_action='mark-paid' then
    if nullif(btrim(p_note),'') is null or length(p_note)>160 then raise exception 'invalid_transition'; end if;
    if b.status='Paid' and b.payment_reference=p_note then return to_jsonb(b); end if;
    if b.status<>'Processing' then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Paid',paid_at=now(),processed_by=p_actor,payment_reference=p_note where id=b.id;
    update public.payout_items set status='Paid' where batch_id=b.id;
  elsif p_action='reject' then
    if b.status='Failed' then return to_jsonb(b); end if;
    if b.status not in ('Draft','Processing') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Failed',processed_at=now(),processed_by=p_actor,notes=notes||jsonb_build_array(coalesce(p_note,'Rejected by Admin')) where id=b.id;
    update public.payout_items set status='Failed',reason=coalesce(p_note,'Rejected by Admin') where batch_id=b.id;
  else raise exception 'invalid_transition'; end if;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'payout_'||p_action,b.id::text);
  select * into b from public.payout_batches where id=b.id;
  return to_jsonb(b);
end; $$;

create or replace function public.submit_gig_credentials(p_actor uuid,p_assignment uuid,p_accounts jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.gig_assignments%rowtype; code text;
begin
  select * into a from public.gig_assignments where id=p_assignment for update;
  if not found then raise exception 'not_found'; end if;
  select worker_code into code from public.profiles where id=p_actor and active;
  if (code is null or a.worker_code not in (code,p_actor::text)) and not public.app_is_admin(p_actor) then raise exception 'not_found'; end if;
  if a.status not in ('Assigned','Pending','Rejected','Submitted') then raise exception 'invalid_transition'; end if;
  if jsonb_typeof(p_accounts)<>'array' or jsonb_array_length(p_accounts)<>5 then raise exception 'invalid_accounts'; end if;
  if (select count(distinct lower(x->>'email')) from jsonb_array_elements(p_accounts) x)<>5 or exists(
    select 1 from jsonb_array_elements(p_accounts) x where coalesce(x->>'handle','')='' or coalesce(x->>'password','') not like 'enc:v1:%'
      or not exists(select 1 from jsonb_array_elements_text(a.assigned_emails) e where lower(e)=lower(x->>'email'))
  ) then raise exception 'invalid_accounts'; end if;
  delete from public.gig_account_credentials where assignment_id=a.id;
  insert into public.gig_account_credentials(assignment_id,handle,email,password,phone)
    select a.id,x->>'handle',lower(x->>'email'),x->>'password',nullif(x->>'phone','') from jsonb_array_elements(p_accounts) x;
  update public.gig_assignments set status='Submitted',submitted_at=now() where id=a.id;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'credentials_submitted',a.id::text);
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.create_work_email_account(p_actor uuid,p_code_hash text,p_account jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.work_email_secret_codes%rowtype; a public.work_email_accounts%rowtype;
begin
  select * into c from public.work_email_secret_codes where code_hash=p_code_hash for update;
  if not found or c.status<>'active' or c.expires_at<=now() or (c.max_uses>0 and c.use_count>=c.max_uses) then raise exception 'invalid_code'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and active) then raise exception 'forbidden'; end if;
  if coalesce(p_account->>'social_password','') not like 'enc:v1:%' then raise exception 'invalid_accounts'; end if;
  insert into public.work_email_accounts(owner_user_id,secret_code_id,email,local_part,domain,username,social_password,platform,notes)
    values(p_actor,c.id,p_account->>'email',p_account->>'local_part',p_account->>'domain',p_account->>'username',p_account->>'social_password',p_account->>'platform',p_account->>'notes') returning * into a;
  update public.work_email_secret_codes set use_count=use_count+1,last_used_at=now() where id=c.id;
  return to_jsonb(a)-'social_password';
end; $$;

create or replace function public.review_gig_assignment(p_actor uuid,p_assignment uuid,p_status text,p_release boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.gig_assignments%rowtype; g public.gigs%rowtype; w public.work_items%rowtype;
  worker uuid; public_key text; account_key text; amount numeric(12,2); next_status text;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_status not in ('Accepted','Rejected','Pending') then raise exception 'invalid_transition'; end if;
  select * into a from public.gig_assignments where id=p_assignment for update;
  if not found then raise exception 'not_found'; end if;
  if a.status not in ('Submitted','Pending','Accepted','Rejected') then raise exception 'invalid_transition'; end if;
  select id into worker from public.profiles where worker_code=a.worker_code or id::text=a.worker_code;
  if worker is null then raise exception 'not_found'; end if;
  select * into g from public.gigs where id=a.gig_id;
  public_key:='GIGCRED-'||upper(left(replace(a.id::text,'-',''),18));
  account_key:='GIGACC-'||upper(left(replace(a.id::text,'-',''),18));
  select * into w from public.work_items where public_id=public_key for update;
  if found and w.status='Approved' then
    if p_status<>'Accepted' then raise exception 'invalid_transition'; end if;
    return to_jsonb(a)||jsonb_build_object('fundsReleased',true,'payoutStatus','Credited');
  end if;
  if p_status='Accepted' and (select count(*) from public.gig_account_credentials where assignment_id=a.id)<>5 then raise exception 'invalid_accounts'; end if;
  if p_status='Accepted' then
    amount:=coalesce(substring(replace(replace(g.payout,',',''),' ','') from '[0-9]+(?:[.][0-9]+)?'),'0')::numeric;
    if amount<=0 then raise exception 'invalid_transition'; end if;
    insert into public.accounts(id,handle,owner_team) values(account_key,g.title,g.company) on conflict(id) do nothing;
    next_status:=case when p_release then 'Approved' else 'Submitted' end;
    insert into public.work_items(public_id,worker_id,account_id,title,type,status,reward_inr,completed_at,review)
      values(public_key,worker,account_key,g.title||' credential pack','Account creation',next_status,amount,
        case when p_release then now() else null end,
        jsonb_build_object('source','gig_assignment_approval','assignmentId',a.id,'walletReleased',p_release,'walletReleasedAt',case when p_release then now() else null end))
      on conflict(public_id) do update set status=excluded.status,reward_inr=excluded.reward_inr,completed_at=excluded.completed_at,review=excluded.review;
  elsif w.id is not null then
    update public.work_items set status=case when p_status='Rejected' then 'Hard rejected' else 'Submitted' end where id=w.id;
  end if;
  update public.gig_assignments set status=p_status,decided_at=now() where id=a.id returning * into a;
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'assignment_review',a.id::text,jsonb_build_object('status',p_status,'released',p_release));
  return to_jsonb(a)||jsonb_build_object('fundsReleased',p_release,'payoutStatus',case when p_release then 'Credited' else null end);
end; $$;

create or replace function public.worker_metrics(p_worker uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
with operational as (
  select * from public.work_items where worker_id=p_worker and coalesce(review->>'source','')<>'gig_assignment_approval'
), credentials as (
  select a.id,a.status as assignment_status,w.status,
    coalesce(w.reward_inr,coalesce(substring(replace(replace(g.payout,',',''),' ','') from '[0-9]+(?:[.][0-9]+)?'),'0')::numeric) as amount
  from public.gig_assignments a join public.gigs g on g.id=a.gig_id
  join public.profiles p on p.id=p_worker and a.worker_code in (p.worker_code,p.id::text)
  left join public.work_items w on w.public_id='GIGCRED-'||upper(left(replace(a.id::text,'-',''),18))
), all_work as (
  select status,reward_inr as amount from operational
  union all
  select case when status='Approved' then 'Approved' when status='Submitted' or assignment_status in ('Submitted','Accepted','Pending') then 'Submitted' else assignment_status end,amount from credentials
)
select jsonb_build_object(
  'counts',jsonb_build_object('total',(select count(*) from all_work),'approved',(select count(*) from all_work where status='Approved'),
    'submitted',(select count(*) from all_work where status='Submitted'),'inProgress',(select count(*) from all_work where status='In progress')),
  'money',jsonb_build_object('earnings',(select coalesce(sum(amount),0) from all_work where status='Approved'),'pending',(select coalesce(sum(amount),0) from all_work where status='Submitted')),
  'sla',jsonb_build_object('met',(select count(*) from operational where status='Approved' and completed_at-started_at<=make_interval(mins=>sla_minutes)),
    'breached',(select count(*) from operational where status='Approved' and completed_at-started_at>make_interval(mins=>sla_minutes)))
);
$$;

create or replace function public.schedule_account_work(p_actor uuid,p_worker uuid,p_account text,p_schedule jsonb,p_reschedule boolean default false,p_assign boolean default false) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a public.accounts%rowtype; slot timestamptz; slots timestamptz[]; created integer:=0; affected integer;
  tz text; mins integer; result public.assignments%rowtype;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.profiles where id=p_worker and active) then raise exception 'not_found'; end if;
  select * into a from public.accounts where id=p_account for update;
  if not found then raise exception 'not_found'; end if;
  tz:=coalesce(p_schedule->>'timezone','Asia/Kolkata');
  mins:=coalesce((p_schedule->>'deadlineMin')::integer,180);
  if mins not between 60 and 720 or not exists(select 1 from pg_timezone_names where name=tz)
    or jsonb_array_length(p_schedule->'times') not between 1 and 6 or jsonb_array_length(p_schedule->'days') not between 1 and 7 then raise exception 'invalid_transition'; end if;
  if p_assign then
    delete from public.assignments where account_id=p_account and worker_id<>p_worker;
    delete from public.worker_account_assignments where account_id=p_account and worker_id<>p_worker;
    delete from public.worker_accounts where account_id=p_account and worker_id<>p_worker;
    delete from public.work_items where account_id=p_account and worker_id<>p_worker and status='Open' and public_id like 'SCH-%';
    insert into public.assignments(worker_id,account_id,schedule,assigned_by) values(p_worker,p_account,p_schedule,p_actor)
      on conflict(worker_id,account_id) do update set schedule=excluded.schedule,assigned_by=excluded.assigned_by;
    insert into public.worker_account_assignments(worker_id,account_id,schedule,assigned_by) values(p_worker,p_account,p_schedule,p_actor)
      on conflict(worker_id,account_id) do update set schedule=excluded.schedule,assigned_by=excluded.assigned_by;
    insert into public.worker_accounts(worker_id,account_id) values(p_worker,p_account) on conflict do nothing;
  elsif not exists(select 1 from public.assignments where worker_id=p_worker and account_id=p_account)
    and not exists(select 1 from public.worker_account_assignments where worker_id=p_worker and account_id=p_account) then raise exception 'not_found';
  end if;
  update public.accounts set schedule=p_schedule where id=p_account;
  update public.assignments set schedule=p_schedule where worker_id=p_worker and account_id=p_account returning * into result;
  update public.worker_account_assignments set schedule=p_schedule where worker_id=p_worker and account_id=p_account;
  select array_agg(due order by due) into slots from (
    select ((now() at time zone tz)::date + days.n + t.value::time) at time zone tz as due
    from generate_series(0,14) as days(n) cross join jsonb_array_elements_text(p_schedule->'times') t(value)
    where extract(dow from (now() at time zone tz)::date+days.n)::int in (select value::int from jsonb_array_elements_text(p_schedule->'days'))
      and (((now() at time zone tz)::date+days.n+t.value::time) at time zone tz)>now()
    order by due limit 2
  ) planned;
  if p_reschedule then delete from public.work_items where worker_id=p_worker and account_id=p_account and status='Open' and public_id like 'SCH-%' and due_at>now() and not(due_at=any(coalesce(slots,'{}'))); end if;
  foreach slot in array coalesce(slots,'{}') loop
    insert into public.work_items(public_id,worker_id,account_id,title,type,created_by,due_at,reward_inr,est_minutes,sla_minutes,gates)
      values('SCH-'||md5(p_worker::text||':'||p_account||':'||extract(epoch from slot)::text),p_worker,p_account,'Post reel for '||a.handle,'Reel posting',p_actor::text,slot,5,30,mins,
        jsonb_build_object('captionTemplate',true,'approvedAudio',lower(a.policy_tier)<>'strict','hashtagsOk',true,'noRestricted',true,'proofAttached',false))
      on conflict(public_id) do nothing;
    get diagnostics affected=row_count; created:=created+affected;
  end loop;
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,case when p_assign then 'account_assigned' else 'work_scheduled' end,p_account,jsonb_build_object('worker',p_worker,'created',created));
  return jsonb_build_object('ok',true,'created',created,'assignment',jsonb_build_object('workerId',p_worker,'accountId',p_account,'schedule',p_schedule));
end; $$;

create or replace function public.schedule_all_work(p_actor uuid,p_schedule jsonb default null,p_reschedule boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; result jsonb; created integer:=0;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  for a in select distinct on(worker_id,account_id) worker_id,account_id,schedule from (
    select worker_id,account_id,schedule from public.assignments union all select worker_id,account_id,schedule from public.worker_account_assignments
  ) all_assignments order by worker_id,account_id loop
    result:=public.schedule_account_work(p_actor,a.worker_id,a.account_id,coalesce(p_schedule,a.schedule,'{"times":["08:00","18:00"],"days":[0,1,2,3,4,5,6],"deadlineMin":180,"timezone":"Asia/Kolkata"}'::jsonb),p_reschedule,false);
    created:=created+(result->>'created')::int;
  end loop;
  return jsonb_build_object('ok',true,'created',created);
end; $$;

create or replace function public.refresh_scheduled_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select p.id into owner_id from public.profiles p where public.app_is_admin(p.id) limit 1;
  if owner_id is null then raise exception 'forbidden'; end if;
  return public.schedule_all_work(owner_id);
end; $$;

create or replace function public.unassign_account(p_actor uuid,p_worker uuid,p_account text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  perform 1 from public.accounts where id=p_account for update;
  if not found then raise exception 'not_found'; end if;
  delete from public.assignments where worker_id=p_worker and account_id=p_account;
  delete from public.worker_account_assignments where worker_id=p_worker and account_id=p_account;
  delete from public.worker_accounts where worker_id=p_worker and account_id=p_account;
  delete from public.work_items where worker_id=p_worker and account_id=p_account and status='Open' and public_id like 'SCH-%';
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'account_unassigned',p_account,jsonb_build_object('worker',p_worker));
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.delete_unused_account(p_actor uuid,p_account text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  perform 1 from public.accounts where id=p_account for update;
  if not found then raise exception 'not_found'; end if;
  if exists(select 1 from public.work_items where account_id=p_account) then raise exception 'history_exists'; end if;
  delete from public.assignments where account_id=p_account;
  delete from public.worker_account_assignments where account_id=p_account;
  delete from public.worker_accounts where account_id=p_account;
  delete from public.accounts where id=p_account;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'account_deleted',p_account);
  return jsonb_build_object('ok',true,'accountId',p_account);
end; $$;

create or replace function public.provision_worker(p_actor uuid,p_user uuid,p_code text,p_name text,p_email text,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_code !~ '^[a-zA-Z0-9_-]{1,80}$' or length(trim(p_name)) not between 1 and 150
    or lower(p_email)='savarnasumit@gmail.com'
    or not exists(select 1 from auth.users where id=p_user and lower(email)=lower(p_email) and email_confirmed_at is not null)
    then raise exception 'forbidden'; end if;
  insert into public.profiles(id,role,worker_code,display_name,email,active)
    values(p_user,'Worker',p_code,p_name,lower(p_email),p_active)
    on conflict(id) do update set role='Worker',worker_code=excluded.worker_code,display_name=excluded.display_name,email=excluded.email,active=excluded.active;
  insert into public.workers(id,user_id,name,email,active)
    values(p_code,p_user,p_name,lower(p_email),p_active)
    on conflict(user_id) do update set id=excluded.id,name=excluded.name,email=excluded.email,active=excluded.active;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'worker_created',p_user::text);
  return jsonb_build_object('id',p_code,'userId',p_user,'name',p_name,'email',lower(p_email),'active',p_active);
end; $$;

create or replace function public.create_gig_assignment(p_actor uuid,p_worker uuid,p_gig text,p_emails jsonb,p_subject text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_assignments%rowtype; worker_code_value text;
begin
  if p_actor<>p_worker and not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_code into worker_code_value from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'not_found'; end if;
  select * into a from public.gig_assignments where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) for update;
  -- Retrying creation never changes credentials, review status or timestamps.
  if found then return to_jsonb(a); end if;
  if not exists(select 1 from public.gigs where id=p_gig and status='Open') then raise exception 'invalid_transition'; end if;
  if not public.app_is_admin(p_actor) then
    perform 1 from public.gig_applications where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) and status='Accepted' for share;
    if not found then raise exception 'forbidden'; end if;
    if not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved') then raise exception 'kyc_required'; end if;
  end if;
  if jsonb_array_length(p_emails)<>5 or (select count(distinct value) from jsonb_array_elements_text(p_emails))<>5
    or exists(select 1 from jsonb_array_elements_text(p_emails) where value !~ '^[^ @]+@[^ @]+\.[^ @]+$') then raise exception 'invalid_accounts'; end if;
  insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails,subject_filter)
    values(p_gig,worker_code_value,p_emails->>0,p_emails,p_subject) returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_assigned',a.id::text);
  return to_jsonb(a);
end; $$;

create or replace function public.submit_gig_application(p_actor uuid,p_worker uuid,p_gig text,p_worker_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_applications%rowtype; g public.gigs%rowtype; code text;
begin
  if p_actor<>p_worker and not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_code into code from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'not_found'; end if;
  select * into g from public.gigs where id=p_gig for share;
  if not found then raise exception 'not_found'; end if;
  if g.status<>'Open' then raise exception 'invalid_transition'; end if;
  select * into a from public.gig_applications where gig_id=p_gig and worker_code in(code,p_worker::text) for update;
  if found and a.status='Accepted' then raise exception 'invalid_transition'; end if;
  insert into public.gig_applications(gig_id,worker_code,worker_name,status)
    values(p_gig,code,p_worker_name,case when lower(g.gig_type)='email creator' then 'Accepted' else 'Pending' end)
    on conflict(gig_id,worker_code) do update set worker_name=excluded.worker_name,status=excluded.status,applied_at=now(),decided_at=null
    returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_application_submitted',a.id::text);
  return to_jsonb(a);
end; $$;

create or replace function public.update_gig_application(p_actor uuid,p_id uuid,p_expected jsonb,p_name text,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_applications%rowtype; is_admin boolean;
begin
  is_admin:=public.app_is_admin(p_actor);
  select * into a from public.gig_applications where id=p_id for update;
  if not found or (not is_admin and a.worker_code<>p_actor::text and not exists(select 1 from public.profiles where id=p_actor and worker_code=a.worker_code)) then raise exception 'not_found'; end if;
  if to_jsonb(a) is distinct from p_expected then raise exception 'invalid_transition'; end if;
  if p_status not in('Applied','Pending','Accepted','Rejected') or (not is_admin and p_status<>a.status) then raise exception 'forbidden'; end if;
  -- The API only permits workers to confirm joining the recruiter-provided group.
  update public.gig_applications set worker_name=p_name,status=p_status,decided_at=case when is_admin then now() else decided_at end where id=p_id returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_application_updated',p_id::text);
  return to_jsonb(a);
end; $$;

create or replace function public.cleanup_scheduled_work(p_actor uuid,p_worker uuid default null,p_account text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  perform 1 from public.accounts where p_account is null or id=p_account order by id for update;
  with ranked as (
    select id,row_number() over(partition by worker_id,account_id order by due_at,id) as position
    from public.work_items where status='Open' and public_id like 'SCH-%' and due_at>now()
      and (p_worker is null or worker_id=p_worker) and (p_account is null or account_id=p_account)
  ) delete from public.work_items w using ranked r where w.id=r.id and r.position>2 and w.status='Open'
    and not exists(select 1 from public.work_item_audit where work_item_id=w.id);
  get diagnostics removed=row_count;
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'scheduled_work_cleaned',p_account,jsonb_build_object('deleted',removed));
  return jsonb_build_object('ok',true,'deleted',removed);
end; $$;

create or replace function public.prepare_worker_deletion(p_actor uuid,p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
  if not public.app_is_admin(p_actor) or p_actor=p_worker then raise exception 'forbidden'; end if;
  select * into p from public.profiles where id=p_worker for update;
  if not found or p.role<>'Worker' then raise exception 'not_found'; end if;
  if exists(select 1 from public.work_items where worker_id=p_worker)
    or exists(select 1 from public.worker_kyc where user_id=p_worker)
    or exists(select 1 from public.payout_batches where worker_id=p_worker)
    or exists(select 1 from public.gig_applications where worker_code in(p.worker_code,p_worker::text))
    or exists(select 1 from public.gig_assignments where worker_code in(p.worker_code,p_worker::text))
    or exists(select 1 from public.work_email_accounts where owner_user_id=p_worker)
    or exists(select 1 from public.audit_events where actor_id=p_worker)
    or exists(select 1 from public.work_item_audit where actor_id=p_worker)
    then raise exception 'worker_history_exists'; end if;
  update public.profiles set active=false where id=p_worker;
  update public.workers set active=false where user_id=p_worker;
  delete from public.assignments where worker_id=p_worker;
  delete from public.worker_account_assignments where worker_id=p_worker;
  delete from public.worker_accounts where worker_id=p_worker;
  delete from public.upi_configs where worker_id=p_worker;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'worker_deletion_prepared',p_worker::text);
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.submit_worker_kyc(p_worker uuid,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.worker_kyc%rowtype; code text;
begin
  select worker_code into code from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into k from public.worker_kyc where user_id=p_worker for update;
  if found and k.status='approved' then raise exception 'invalid_transition'; end if;
  if position('kyc/'||p_worker::text||'/id_doc-' in p_details->>'id_doc_path')<>1
    or position('kyc/'||p_worker::text||'/selfie-' in p_details->>'selfie_path')<>1
    or not exists(select 1 from storage.objects where bucket_id='kyc' and name=p_details->>'id_doc_path')
    or not exists(select 1 from storage.objects where bucket_id='kyc' and name=p_details->>'selfie_path') then raise exception 'documents_required'; end if;
  insert into public.worker_kyc(user_id,worker_id,status,legal_name,dob,phone,address,id_type,id_number,id_doc_path,selfie_path)
    values(p_worker,code,'pending',p_details->>'legal_name',(p_details->>'dob')::date,p_details->>'phone',p_details->>'address',p_details->>'id_type',p_details->>'id_number',p_details->>'id_doc_path',p_details->>'selfie_path')
    on conflict(user_id) do update set status='pending',legal_name=excluded.legal_name,dob=excluded.dob,phone=excluded.phone,address=excluded.address,
      id_type=excluded.id_type,id_number=excluded.id_number,id_doc_path=excluded.id_doc_path,selfie_path=excluded.selfie_path,submitted_at=now(),reviewed_at=null,reviewer_id=null,rejection_reason=null,admin_note=null
    returning * into k;
  insert into public.worker_kyc_events(kyc_id,status,note,actor_id) values(k.id,'pending','Submitted',p_worker);
  return to_jsonb(k);
end; $$;

create or replace function public.review_worker_kyc(p_actor uuid,p_id uuid,p_submitted_at timestamptz,p_status text,p_reason text default null,p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.worker_kyc%rowtype; worker uuid; code text;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_status not in('pending','approved','rejected') then raise exception 'invalid_transition'; end if;
  select user_id into worker from public.worker_kyc where id=p_id;
  select worker_code into code from public.profiles where id=worker for update;
  if not found then raise exception 'not_found'; end if;
  select * into k from public.worker_kyc where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  if k.submitted_at is distinct from p_submitted_at then raise exception 'invalid_transition'; end if;
  if p_status<>'approved' and exists(select 1 from public.payout_batches where worker_id=worker and status in('Draft','Processing')) then raise exception 'active_batch'; end if;
  update public.worker_kyc set status=p_status,reviewed_at=now(),reviewer_id=p_actor,worker_id=code,
    rejection_reason=case when p_status='rejected' then p_reason end,admin_note=p_note where id=p_id returning * into k;
  insert into public.worker_kyc_events(kyc_id,status,note,actor_id) values(k.id,p_status,coalesce(p_note,p_reason,p_status),p_actor);
  return to_jsonb(k);
end; $$;
