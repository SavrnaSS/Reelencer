-- Creators can apply to at most 2 gigs in any rolling 7 days. A gig uses a slot from its latest application until
-- 7 days later; withdrawn or declined applications still count, so withdrawing can't be used to apply to more.
-- Re-submitting or revising an application for a gig already counted doesn't use another slot. Team members
-- applying on a creator's behalf aren't limited.

create or replace function public.gig_application_window(p_worker uuid, p_code text, p_now timestamptz)
returns table(gig_id text, last_applied_at timestamptz)
language sql stable security definer set search_path='' as $$
  select a.gig_id, max(a.applied_at)
  from public.gig_applications a
  where a.applied_at > p_now - interval '7 days' and a.applied_at <= p_now
    -- Match the same canonical owner as application reads, including legacy worker,
    -- email and encoded-payload aliases. A direct owner always wins over payload data.
    and public.application_worker_identity(a.worker_code, a.worker_name) = p_worker
  group by a.gig_id
$$;

-- What the creator's dashboard shows: slots used, slots left and when the next one opens.
create or replace function public.gig_application_quota(p_worker uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  code text;
  max_gigs constant integer := 2;
  used integer;
  gigs jsonb;
  next_slot timestamptz;
begin
  select worker_code into code from public.profiles where id=p_worker;
  if not found then raise exception 'not_found'; end if;
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object('gigId', w.gig_id, 'appliedAt', w.last_applied_at, 'freesAt', w.last_applied_at + interval '7 days') order by w.last_applied_at), '[]'::jsonb)
    into used, gigs from public.gig_application_window(p_worker, code, p_now) w;
  -- Full: the next slot opens when enough of the oldest applications age out to drop below the limit.
  if used >= max_gigs then
    select w.last_applied_at + interval '7 days' into next_slot
      from public.gig_application_window(p_worker, code, p_now) w
      order by w.last_applied_at offset used - max_gigs limit 1;
  end if;
  return jsonb_build_object('limit', max_gigs, 'windowDays', 7, 'used', used, 'remaining', greatest(max_gigs - used, 0), 'nextSlotAt', next_slot, 'gigs', gigs);
end; $$;

create or replace function public.submit_gig_application(p_actor uuid,p_worker uuid,p_gig text,p_worker_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_applications%rowtype; g public.gigs%rowtype; code text; used integer;
begin
  if p_actor<>p_worker and not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  -- Locking the profile serialises a creator's applications, so two at once can't both take the last slot.
  select worker_code into code from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'not_found'; end if;
  select * into g from public.gigs where id=p_gig for share;
  if not found then raise exception 'not_found'; end if;
  if g.status<>'Open' then raise exception 'invalid_transition'; end if;
  select * into a from public.gig_applications where gig_id=p_gig and worker_code in(code,p_worker::text) for update;
  if found and a.status='Accepted' then raise exception 'invalid_transition'; end if;
  if p_actor=p_worker and not public.app_is_admin(p_actor) then
    select count(*) into used from public.gig_application_window(p_worker, code, now()) w where w.gig_id<>p_gig;
    if used >= 2 then raise exception 'weekly_application_limit'; end if;
  end if;
  insert into public.gig_applications(gig_id,worker_code,worker_name,status)
    values(p_gig,code,p_worker_name,case when lower(g.gig_type)='email creator' then 'Accepted' else 'Pending' end)
    on conflict(gig_id,worker_code) do update set worker_name=excluded.worker_name,status=excluded.status,applied_at=now(),decided_at=null
    returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_application_submitted',a.id::text);
  return to_jsonb(a);
end; $$;

create index if not exists gig_applications_worker_recent on public.gig_applications(worker_code, applied_at desc);
create index if not exists gig_applications_recent on public.gig_applications(applied_at desc);

revoke all on function public.gig_application_window(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.gig_application_quota(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.submit_gig_application(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gig_application_quota(uuid,timestamptz) to service_role;
grant execute on function public.submit_gig_application(uuid,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
