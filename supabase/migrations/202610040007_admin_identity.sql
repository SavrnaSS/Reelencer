-- The administrator is enrolled by the explicit server-side admin:sync command.
-- No fallback email, editable user metadata, or browser role flag grants authority.
create table if not exists public.admin_owner (
  singleton boolean primary key default true check(singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null check(email=lower(trim(email)) and email like '%@%'),
  updated_at timestamptz not null default now()
);
alter table public.admin_owner enable row level security;
-- Supabase can grant table access through default privileges; reset those too.
revoke all on public.admin_owner from public,anon,authenticated,service_role;
grant select on public.admin_owner to service_role;

create or replace function public.is_configured_admin(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admin_owner o join auth.users u on u.id=o.user_id
    where o.user_id=p_user and lower(trim(u.email))=o.email and u.email_confirmed_at is not null);
$$;

create or replace function public.app_is_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_configured_admin(p_actor)
    and exists(select 1 from public.profiles where id=p_actor and active)
    and not exists(select 1 from public.workers where user_id=p_actor and not active);
$$;

create or replace function public.configure_admin_owner(p_user uuid,p_email text,p_name text,p_expected_owner uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous_owner uuid; normalized_email text;
begin
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  select user_id into previous_owner from public.admin_owner where singleton for update;
  if previous_owner is distinct from p_expected_owner then raise exception 'configuration_changed'; end if;
  normalized_email:=lower(trim(p_email));
  if normalized_email is null or normalized_email !~ '^[^ @]+@[^ @]+\.[^ @]+$'
    or p_name is null or length(trim(p_name)) not between 1 and 150 then raise exception 'invalid_configuration'; end if;
  perform 1 from auth.users where id=p_user and lower(trim(email))=normalized_email and email_confirmed_at is not null for update;
  if not found then raise exception 'forbidden'; end if;
  insert into public.profiles(id,role,display_name,email,active) values(p_user,'Admin',trim(p_name),normalized_email,true)
    on conflict(id) do update set role='Admin',display_name=excluded.display_name,email=excluded.email,active=true;
  update public.workers set active=true where user_id=p_user;
  insert into public.admin_owner(singleton,user_id,email) values(true,p_user,normalized_email)
    on conflict(singleton) do update set user_id=excluded.user_id,email=excluded.email,updated_at=now();
  update public.profiles set role='Worker' where role='Admin' and id<>p_user;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_user,'admin_owner_configured',p_user::text,jsonb_build_object('previousOwner',previous_owner));
  return jsonb_build_object('userId',p_user,'configured',true);
end; $$;

-- Readiness checks never need the provisioning password.
create or replace function public.admin_configuration_ready(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admin_owner where email=lower(trim(p_email)) and public.app_is_admin(user_id));
$$;

revoke all on function public.is_configured_admin(uuid) from public,anon,authenticated;
revoke all on function public.app_is_admin(uuid) from public,anon,authenticated;
revoke all on function public.configure_admin_owner(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_configuration_ready(text) from public,anon,authenticated;
grant execute on function public.is_configured_admin(uuid),public.app_is_admin(uuid),public.configure_admin_owner(uuid,text,text,uuid),public.admin_configuration_ready(text) to service_role;


create or replace function public.bootstrap_worker(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u auth.users%rowtype; p public.profiles%rowtype;
begin
  select * into u from auth.users where id=p_user and email_confirmed_at is not null;
  if not found then raise exception 'forbidden'; end if;
  insert into public.profiles(id,role,display_name,email)
    values(p_user,case when public.is_configured_admin(p_user) then 'Admin' else 'Worker' end,
      coalesce(nullif(u.raw_user_meta_data->>'name',''),u.email),u.email)
    on conflict(id) do nothing;
  select * into p from public.profiles where id=p_user for update;
  if not p.active then raise exception 'forbidden'; end if;
  update public.profiles set role=case when public.is_configured_admin(p_user) then 'Admin' else 'Worker' end,
    email=u.email where id=p_user returning * into p;
  if p.role='Worker' then
    insert into public.workers(id,user_id,name,email,active)
      values(p.worker_code,p_user,coalesce(p.display_name,'Worker'),u.email,true)
      on conflict(user_id) do nothing;
  end if;
  return jsonb_build_object('id',p.id,'role',p.role,'workerCode',p.worker_code,'worker_code',p.worker_code,'display_name',p.display_name);
end; $$;

create or replace function public.provision_worker(p_actor uuid,p_user uuid,p_code text,p_name text,p_email text,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_code !~ '^[a-zA-Z0-9_-]{1,80}$' or length(trim(p_name)) not between 1 and 150
    or exists(select 1 from public.admin_owner where user_id=p_user or email=lower(trim(p_email)))
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

create or replace function public.reelencer_backend_version() returns integer language sql stable set search_path='' as $$select 3$$;
notify pgrst, 'reload schema';
