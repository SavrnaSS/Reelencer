-- Gigs the team holds for established creators. When gigs.new_creator_hold is on, a creator can apply (or, for Email
-- Creator gigs, start) only once they have been assigned another project (an Accepted application or a work
-- assignment on any other gig) or their account is NEW_CREATOR_HOLD_DAYS (20) days old. Keep lib/newCreatorHold.ts
-- in sync. The team (admins) is never held.

alter table public.gigs add column if not exists new_creator_hold boolean not null default false;

-- When this creator's hold on held gigs lifts: null when they are already free to apply.
create or replace function public.new_creator_hold_until(p_worker uuid, p_gig text default null) returns timestamptz
language sql stable security definer set search_path='' as $$
  select case
    when p.created_at + interval '20 days' <= now() then null
    when exists(select 1 from public.gig_applications a
                where a.worker_code in(p.worker_code, p.id::text) and a.status='Accepted' and a.gig_id is distinct from p_gig)
      or exists(select 1 from public.gig_assignments s
                where s.worker_code in(p.worker_code, p.id::text) and s.gig_id is distinct from p_gig)
      then null
    else p.created_at + interval '20 days'
  end
  from public.profiles p where p.id = p_worker
$$;

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
    -- Gigs the team holds for established creators: an Accepted application here was already let in.
    if g.new_creator_hold and (a.id is null or a.status<>'Accepted') and public.new_creator_hold_until(p_worker,p_gig) is not null then
      raise exception 'new_creator_hold';
    end if;
  end if;
  insert into public.gig_applications(gig_id,worker_code,worker_name,status)
    values(p_gig,code,p_worker_name,case when lower(g.gig_type)='email creator' then 'Accepted' else 'Pending' end)
    on conflict(gig_id,worker_code) do update set worker_name=excluded.worker_name,status=excluded.status,applied_at=now(),decided_at=null
    returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_application_submitted',a.id::text);
  return to_jsonb(a);
end; $$;

create or replace function public.create_gig_assignment(p_actor uuid,p_worker uuid,p_gig text,p_emails jsonb,p_subject text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_assignments%rowtype; worker_code_value text; worker_name_value text; g public.gigs%rowtype;
begin
  if p_actor<>p_worker and not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_code, coalesce(nullif(btrim(display_name),''),worker_code) into worker_code_value, worker_name_value
    from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'not_found'; end if;
  select * into a from public.gig_assignments where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) for update;
  -- Retrying creation never changes credentials, review status or timestamps.
  if found then return to_jsonb(a); end if;
  select * into g from public.gigs where id=p_gig and status='Open';
  if not found then raise exception 'invalid_transition'; end if;
  if not public.app_is_admin(p_actor) then
    if lower(btrim(coalesce(g.gig_type,''))) = 'email creator' then
      -- Held gigs wait for established creators unless this one was already accepted.
      if g.new_creator_hold and public.new_creator_hold_until(p_worker,p_gig) is not null
        and not exists(select 1 from public.gig_applications where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) and status='Accepted') then
        raise exception 'new_creator_hold';
      end if;
      -- No approval needed: make sure an Accepted application exists for the record.
      insert into public.gig_applications(gig_id,worker_code,worker_name,status,decided_at)
        values(p_gig,worker_code_value,worker_name_value,'Accepted',now())
        on conflict(gig_id,worker_code) do update set status='Accepted',decided_at=coalesce(public.gig_applications.decided_at,now())
          where public.gig_applications.status<>'Accepted';
    else
      perform 1 from public.gig_applications where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) and status='Accepted' for share;
      if not found then raise exception 'forbidden'; end if;
      if not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved') then raise exception 'kyc_required'; end if;
    end if;
  end if;
  if jsonb_array_length(p_emails)<>5 or (select count(distinct value) from jsonb_array_elements_text(p_emails))<>5
    or exists(select 1 from jsonb_array_elements_text(p_emails) where value !~ '^[^ @]+@[^ @]+\.[^ @]+$') then raise exception 'invalid_accounts'; end if;
  insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails,subject_filter)
    values(p_gig,worker_code_value,p_emails->>0,p_emails,p_subject) returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_assigned',a.id::text);
  return to_jsonb(a);
end; $$;

revoke all on function public.new_creator_hold_until(uuid,text) from public, anon, authenticated;
grant execute on function public.new_creator_hold_until(uuid,text) to service_role;
revoke all on function public.submit_gig_application(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.submit_gig_application(uuid,uuid,text,text) to service_role;
revoke all on function public.create_gig_assignment(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_gig_assignment(uuid,uuid,text,jsonb,text) to service_role;

notify pgrst, 'reload schema';
