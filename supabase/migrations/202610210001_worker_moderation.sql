-- Account moderation is archival: financial, identity, work and audit records remain intact.
-- Only the service API can read these records. Mutations go through audited transactions.
create table if not exists public.worker_moderation (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  status text not null default 'active' check(status in ('active','suspended','deleted')),
  reason text check(reason is null or length(reason) between 8 and 1000),
  suspended_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  check((status='deleted')=(deleted_at is not null)),
  check(status<>'suspended' or suspended_at is not null)
);
create table if not exists public.worker_access_ips (
  user_id uuid not null references public.profiles(id) on delete restrict,
  ip inet not null check(masklen(ip)=case family(ip) when 4 then 32 else 128 end),
  last_seen_at timestamptz not null default now(),
  primary key(user_id,ip)
);
create index if not exists worker_access_ips_recent on public.worker_access_ips(user_id,last_seen_at desc);
create table if not exists public.worker_ip_blocks (
  user_id uuid not null references public.profiles(id) on delete restrict,
  ip inet not null check(masklen(ip)=case family(ip) when 4 then 32 else 128 end),
  blocked_at timestamptz not null default now(),
  blocked_by uuid references auth.users(id) on delete set null,
  reason text not null check(length(reason) between 8 and 1000),
  primary key(user_id,ip)
);
create index if not exists worker_ip_blocks_address on public.worker_ip_blocks(ip);
create table if not exists public.worker_moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  action text not null check(action in ('suspend','suspend_ip','restore','delete','unblock_ip')),
  reason text not null check(length(reason) between 8 and 1000),
  ip inet,
  created_at timestamptz not null default now()
);
create index if not exists worker_moderation_events_recent on public.worker_moderation_events(user_id,created_at desc,id);

do $$
declare t text;
begin
  foreach t in array array['worker_moderation','worker_access_ips','worker_ip_blocks','worker_moderation_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
end $$;

-- Existing inactive accounts must retain their access restriction after the rollout.
insert into public.worker_moderation(user_id,status,reason,suspended_at)
select p.id,'suspended','Account was inactive before moderation was enabled.',now()
from public.profiles p
where p.role='Worker' and (not p.active or exists(select 1 from public.workers w where w.user_id=p.id and not w.active))
on conflict(user_id) do nothing;

-- Exact public host addresses only. Private, loopback, multicast, documentation and
-- transition ranges cannot become global blocks. The HTTP layer also validates IPs.
create or replace function public.is_public_worker_ip(p_ip inet) returns boolean
language sql immutable strict set search_path='' as $$
  select masklen(p_ip)=case family(p_ip) when 4 then 32 else 128 end and
    case family(p_ip) when 4 then not (
      p_ip <<= any(array['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8',
        '169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24',
        '192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24',
        '203.0.113.0/24','224.0.0.0/4','240.0.0.0/4']::inet[])
    ) else p_ip <<= '2000::/3'::inet and not (
      p_ip <<= any(array['2001::/23','2001:db8::/32','2002::/16','3fff::/20']::inet[])
    ) end;
$$;

-- The caller supplies only an address from its explicitly trusted ingress header.
-- Read traffic updates an existing address at most once per minute.
create or replace function public.record_worker_access(p_user uuid,p_ip inet) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_ip is null or not public.is_public_worker_ip(p_ip) then raise exception 'invalid_worker_ip'; end if;
  if not public.app_is_admin(p_user) and exists(select 1 from public.worker_ip_blocks b where b.ip=p_ip)
    then raise exception 'ip_blocked'; end if;
  -- Fresh canonical projects bootstrap the profile explicitly after verified login.
  -- Allow that first request without a telemetry row; subsequent requests capture it.
  if not exists(select 1 from public.profiles where id=p_user) then
    if exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
      and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)) then return true; end if;
    raise exception 'account_inactive';
  end if;
  perform 1 from public.profiles p where p.id=p_user and p.active
    and not exists(select 1 from public.workers w where w.user_id=p_user and not w.active)
    and not exists(select 1 from public.worker_moderation m where m.user_id=p_user and m.status<>'active')
    for share;
  if not found then raise exception 'account_inactive'; end if;
  insert into public.worker_access_ips(user_id,ip) values(p_user,p_ip)
    on conflict(user_id,ip) do update set last_seen_at=now()
    where public.worker_access_ips.last_seen_at < now()-interval '1 minute';
  return true;
end; $$;

create or replace function public.moderate_worker(
  p_actor uuid,p_worker uuid,p_action text,p_reason text,
  p_confirmation text default null,p_ip inet default null,p_actor_ip inet default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.profiles%rowtype; state public.worker_moderation%rowtype;
  target_code text; actor_name text; next_status text; cleaned_reason text; changed boolean:=false;
begin
  -- Serialize with owner rotation so an enrolled administrator can never be targeted.
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  if not public.app_is_admin(p_actor) or p_actor=p_worker then raise exception 'forbidden'; end if;
  select * into target from public.profiles where id=p_worker for update;
  if not found then raise exception 'not_found'; end if;
  if target.role<>'Worker' or exists(select 1 from public.admin_owner where user_id=p_worker) then raise exception 'forbidden'; end if;
  if p_action is null or p_action not in ('suspend','suspend_ip','restore','delete','unblock_ip') then raise exception 'invalid_moderation_action'; end if;
  cleaned_reason:=trim(p_reason);
  if cleaned_reason is null or length(cleaned_reason) not between 8 and 1000 then raise exception 'moderation_reason_required'; end if;
  target_code:=target.worker_code;
  if p_action='delete' and p_confirmation is distinct from target_code then raise exception 'moderation_confirmation_required'; end if;

  insert into public.worker_moderation(user_id,status,reason,suspended_at)
    values(p_worker,case when target.active then 'active' else 'suspended' end,
      case when target.active then null else 'Account was previously inactive.' end,
      case when target.active then null else now() end)
    on conflict(user_id) do nothing;
  select * into state from public.worker_moderation where user_id=p_worker for update;
  next_status:=state.status;
  if p_action in ('suspend','suspend_ip') and state.status='deleted' then raise exception 'invalid_transition'; end if;

  if p_action='suspend_ip' then
    if p_ip is null or not public.is_public_worker_ip(p_ip)
      or not exists(select 1 from public.worker_access_ips where user_id=p_worker and ip=p_ip)
      then raise exception 'worker_ip_not_observed'; end if;
    if p_actor_ip is null or not public.is_public_worker_ip(p_actor_ip) then raise exception 'actor_ip_required'; end if;
    if p_ip=p_actor_ip or exists(select 1 from public.worker_access_ips a join public.admin_owner o on o.user_id=a.user_id where a.ip=p_ip)
      then raise exception 'admin_ip_protected'; end if;
    insert into public.worker_ip_blocks(user_id,ip,blocked_by,reason)
      values(p_worker,p_ip,p_actor,cleaned_reason) on conflict(user_id,ip) do nothing;
    changed:=found;
  elsif p_action='unblock_ip' then
    if p_ip is null or not public.is_public_worker_ip(p_ip) then raise exception 'invalid_worker_ip'; end if;
    delete from public.worker_ip_blocks where user_id=p_worker and ip=p_ip;
    changed:=found;
  end if;

  if p_action in ('suspend','suspend_ip') then next_status:='suspended';
  elsif p_action='delete' then next_status:='deleted';
  elsif p_action='restore' then
    next_status:='active';
    delete from public.worker_ip_blocks where user_id=p_worker;
    changed:=found;
  end if;

  if next_status<>state.status or changed then
    if p_action<>'unblock_ip' then
      update public.worker_moderation set status=next_status,reason=cleaned_reason,
        suspended_at=case when next_status='active' then null when next_status='suspended' then coalesce(suspended_at,now()) else suspended_at end,
        deleted_at=case when next_status='deleted' then coalesce(deleted_at,now()) else null end,
        updated_at=now() where user_id=p_worker;
      update public.profiles set active=(next_status='active') where id=p_worker;
      update public.workers set active=(next_status='active') where user_id=p_worker;
    end if;
    select coalesce(nullif(display_name,''),email,p_actor::text) into actor_name from public.profiles where id=p_actor;
    insert into public.worker_moderation_events(user_id,actor_id,actor_label,action,reason,ip)
      values(p_worker,p_actor,coalesce(actor_name,'Administrator'),p_action,cleaned_reason,
        case when p_action in ('suspend_ip','unblock_ip') then p_ip else null end);
    insert into public.audit_events(actor_id,action,resource_id,details)
      values(p_actor,'worker_'||p_action,p_worker::text,
        jsonb_build_object('reason',cleaned_reason,'previousStatus',state.status,'status',next_status,
          'ip',case when p_action in ('suspend_ip','unblock_ip') then host(p_ip) else null end));
  end if;
  return jsonb_build_object('status',next_status,'changed',next_status<>state.status or changed);
end; $$;

revoke all on function public.is_public_worker_ip(inet) from public,anon,authenticated;
revoke all on function public.record_worker_access(uuid,inet) from public,anon,authenticated;
revoke all on function public.moderate_worker(uuid,uuid,text,text,text,inet,inet) from public,anon,authenticated;
grant execute on function public.is_public_worker_ip(inet),public.record_worker_access(uuid,inet),
  public.moderate_worker(uuid,uuid,text,text,text,inet,inet) to service_role;

-- The console receives a content-free invalidation and refreshes its authenticated data.
drop trigger if exists admin_live_update on public.worker_moderation;
create trigger admin_live_update after insert or update or delete on public.worker_moderation
  for each statement execute function public.notify_admin_live();
drop trigger if exists admin_live_update on public.worker_ip_blocks;
create trigger admin_live_update after insert or update or delete on public.worker_ip_blocks
  for each statement execute function public.notify_admin_live();

notify pgrst, 'reload schema';
