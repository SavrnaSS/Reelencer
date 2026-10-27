-- Aggregate recorded creator activity on the server. No tracking table, IP address or session data is exposed.
create index if not exists gig_applications_activity_date on public.gig_applications(applied_at);
create index if not exists social_account_posts_creator_activity_date on public.social_account_posts(created_at) where submitted_by_worker;
create index if not exists view_payout_claims_activity_date on public.view_payout_claims(created_at);
create index if not exists payout_batches_activity_date on public.payout_batches(created_at);

create or replace function public.admin_activity_overview(p_days integer default 30, p_now timestamptz default now()) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_days is null or p_days not in (7,30,90) or p_now is null then raise exception 'invalid_input'; end if;
  with bounds as (
    select (p_now at time zone 'Asia/Kolkata')::date as today,
      ((p_now at time zone 'Asia/Kolkata')::date - (p_days-1))::timestamp at time zone 'Asia/Kolkata' as starts,
      ((p_now at time zone 'Asia/Kolkata')::date - (p_days*2-1))::timestamp at time zone 'Asia/Kolkata' as previous_starts
  ), people as materialized (
    select p.id,p.worker_code,p.display_name,p.email,p.created_at from public.profiles p
    where p.role='Worker' and not exists(select 1 from public.worker_moderation m where m.user_id=p.id and m.status='deleted')
  ), aliases as materialized (
    select distinct on (a.alias) a.alias,p.id,p.worker_code,p.display_name
    from people p cross join lateral (values(lower(p.id::text),0),(lower(p.worker_code),1),(lower(p.email),2)) a(alias,priority)
    where nullif(a.alias,'') is not null order by a.alias,a.priority,p.id
  ), events as materialized (
    select 'signup'::text as kind,p.id::text as event_id,p.id as user_id,p.worker_code,p.display_name,p.created_at as at
      from people p,bounds b where p.created_at>=b.previous_starts and p.created_at<=p_now
    union all
    select 'application',g.id::text,a.id,a.worker_code,a.display_name,g.applied_at
      from public.gig_applications g join aliases a on a.alias=lower(g.worker_code) cross join bounds b
      where g.applied_at>=b.previous_starts and g.applied_at<=p_now
    union all
    select 'reel',r.id::text,a.id,a.worker_code,a.display_name,r.created_at
      from public.social_account_posts r join public.linked_social_accounts l on l.id=r.account_id
      join aliases a on a.alias=lower(l.worker_code) cross join bounds b
      where r.submitted_by_worker and r.created_at>=b.previous_starts and r.created_at<=p_now
    union all
    select 'claim',c.id::text,p.id,p.worker_code,p.display_name,c.created_at
      from public.view_payout_claims c join people p on p.id=c.worker_id cross join bounds b
      where c.created_at>=b.previous_starts and c.created_at<=p_now
    union all
    select 'withdrawal',w.id::text,p.id,p.worker_code,p.display_name,w.created_at
      from public.payout_batches w join people p on p.id=w.worker_id cross join bounds b
      where w.created_at>=b.previous_starts and w.created_at<=p_now
  ), periods as (
    select 'current' as name,b.starts as starts,p_now as ends from bounds b
    union all select 'previous',b.previous_starts,b.starts from bounds b
  ), summaries as (
    select p.name,jsonb_build_object(
      'activeUsers',count(distinct e.user_id),'newUsers',count(*) filter(where e.kind='signup'),
      'applications',count(*) filter(where e.kind='application'),'reels',count(*) filter(where e.kind='reel'),
      'claims',count(*) filter(where e.kind='claim'),'withdrawals',count(*) filter(where e.kind='withdrawal'),
      'actions',count(*) filter(where e.kind<>'signup')) as value
    from periods p left join events e on e.at>=p.starts and (case when p.name='previous' then e.at<p.ends else e.at<=p.ends end)
    group by p.name
  ), daily as (
    select d.day::date as date,count(distinct e.user_id) as active_users,
      count(*) filter(where e.kind='signup') as new_users,count(*) filter(where e.kind='application') as applications,
      count(*) filter(where e.kind='reel') as reels,count(*) filter(where e.kind='claim') as claims,
      count(*) filter(where e.kind='withdrawal') as withdrawals,count(*) filter(where e.kind<>'signup') as actions
    from bounds b cross join lateral generate_series(b.today-(p_days-1),b.today,interval '1 day') d(day)
      left join events e on (e.at at time zone 'Asia/Kolkata')::date=d.day::date
    group by d.day
  ), queues as (
    select
      (select count(*) from public.gig_applications g join aliases a on a.alias=lower(g.worker_code) where g.status in ('Applied','Pending')) as applications,
      (select count(*) from public.worker_kyc k join people p on p.id=k.user_id where lower(k.status)='pending') as kyc,
      (select count(*) from public.social_account_posts where status='submitted') as reels,
      (select count(*) from public.linked_social_accounts where status='unlinked' and profile_health->>'status'='missing') as profiles,
      (select count(*) from public.view_payout_claims where status='Pending') as claims,
      (select count(*) from public.payout_batches where status in ('Draft','Processing')) as withdrawals
  )
  select jsonb_build_object(
    'generatedAt',p_now,'timezone','Asia/Kolkata','period',jsonb_build_object('days',p_days,'start',(b.starts at time zone 'Asia/Kolkata')::date,'end',b.today),
    'totalUsers',(select count(*) from people),
    'counts',jsonb_build_object('linkedAccounts',(select count(*) from public.linked_social_accounts where status in ('active','paused')),
      'pendingClaims',q.claims,'pendingWithdrawals',q.withdrawals,'pendingPayouts',q.claims+q.withdrawals),
    'summary',(select value from summaries where name='current'),'previous',(select value from summaries where name='previous'),
    'queues',to_jsonb(q),
    'days',(select jsonb_agg(jsonb_build_object('date',date,'activeUsers',active_users,'newUsers',new_users,'applications',applications,
      'reels',reels,'claims',claims,'withdrawals',withdrawals,'actions',actions) order by date) from daily),
    'recent',coalesce((select jsonb_agg(jsonb_build_object('id',kind||':'||event_id,'kind',kind,'userName',left(coalesce(nullif(btrim(display_name),''),'Creator'),160),
      'workerCode',worker_code,'at',at) order by at desc,kind,event_id) from
      (select e.* from events e where e.at>=b.starts order by e.at desc,e.kind,e.event_id limit 8) recent),'[]'::jsonb)
  ) into result from bounds b cross join queues q;
  return result;
end $$;
revoke all on function public.admin_activity_overview(integer,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_activity_overview(integer,timestamptz) to service_role;
notify pgrst, 'reload schema';
