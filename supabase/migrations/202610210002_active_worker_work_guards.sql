-- Suspension preserves history and existing assignments, but must stop new work.
-- Share locks serialize new assignments against moderate_worker's profile lock.
create or replace function public.guard_active_worker_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if TG_TABLE_NAME='work_items' then
    if NEW.status not in ('Open','In progress','Needs fix') then return NEW; end if;
  end if;
  if TG_TABLE_NAME='gig_assignments' then
    select p.id into target from public.profiles p
      left join public.workers w on w.user_id=p.id
      where NEW.worker_code in (p.id::text,p.worker_code,w.id)
      order by p.id limit 1;
  else
    target:=(to_jsonb(NEW)->>'worker_id')::uuid;
  end if;
  perform 1 from public.profiles p
    where p.id=target and p.active
      and not exists(select 1 from public.workers w where w.user_id=p.id and not w.active)
      and not exists(select 1 from public.worker_moderation m where m.user_id=p.id and m.status<>'active')
    for share;
  if not found then raise exception 'worker_inactive'; end if;
  return NEW;
end; $$;
revoke all on function public.guard_active_worker_assignment() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['assignments','worker_account_assignments','worker_accounts','work_items'] loop
    execute format('create trigger active_worker_assignment_guard before insert or update of worker_id on public.%I for each row execute function public.guard_active_worker_assignment()',t);
  end loop;
end $$;
create trigger active_worker_assignment_guard before insert or update of worker_code
  on public.gig_assignments for each row execute function public.guard_active_worker_assignment();

create or replace function public.schedule_all_work(p_actor uuid,p_schedule jsonb default null,p_reschedule boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; result jsonb; created integer:=0;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  for a in select distinct on(worker_id,account_id) worker_id,account_id,schedule from (
    select worker_id,account_id,schedule from public.assignments
    union all select worker_id,account_id,schedule from public.worker_account_assignments
  ) all_assignments order by worker_id,account_id loop
    -- Recheck under a lock: targets may have changed since the assignment scan.
    perform 1 from public.profiles p where p.id=a.worker_id and p.active
      and not exists(select 1 from public.workers w where w.user_id=p.id and not w.active)
      and not exists(select 1 from public.worker_moderation m where m.user_id=p.id and m.status<>'active')
      for share;
    if not found then continue; end if;
    result:=public.schedule_account_work(p_actor,a.worker_id,a.account_id,
      coalesce(p_schedule,a.schedule,'{"times":["08:00","18:00"],"days":[0,1,2,3,4,5,6],"deadlineMin":180,"timezone":"Asia/Kolkata"}'::jsonb),
      p_reschedule,false);
    created:=created+(result->>'created')::int;
  end loop;
  return jsonb_build_object('ok',true,'created',created);
end; $$;
revoke all on function public.schedule_all_work(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.schedule_all_work(uuid,jsonb,boolean) to service_role;
notify pgrst, 'reload schema';
