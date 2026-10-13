-- Earlier projects retained Auth/profile triggers and RPCs after the canonical
-- table migration. Replace only routines that already exist: fresh projects
-- continue to create profiles through the explicit server bootstrap endpoint.
-- Metadata supplies display names only; administrator authority belongs to 007.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.handle_new_user()') is not null then
    execute $definition$
      create or replace function public.handle_new_user() returns trigger
      language plpgsql security definer set search_path='' as $body$
      begin
        insert into public.profiles(id,role,display_name,email)
          values(new.id,'Worker',coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),
            nullif(trim(new.raw_user_meta_data->>'full_name'),''),new.email),lower(new.email))
          on conflict(id) do nothing;
        return new;
      end;
      $body$;
    $definition$;
  end if;

  if pg_catalog.to_regprocedure('public.next_worker_code()') is not null then
    execute $definition$
      create or replace function public.next_worker_code() returns text
      language sql set search_path='' as $body$
        select 'WKR-' || pg_catalog.nextval('public.worker_code_sequence'::pg_catalog.regclass)::text
      $body$;
    $definition$;
  end if;

  if pg_catalog.to_regprocedure('public.profiles_set_worker_code()') is not null then
    execute $definition$
      create or replace function public.profiles_set_worker_code() returns trigger
      language plpgsql set search_path='' as $body$
      begin
        if new.worker_code is null or new.worker_code='' then
          new.worker_code:='WKR-' || pg_catalog.nextval('public.worker_code_sequence'::pg_catalog.regclass)::text;
        end if;
        return new;
      end;
      $body$;
    $definition$;
  end if;

  if pg_catalog.to_regprocedure('public.profiles_block_worker_code_change()') is not null then
    execute $definition$
      create or replace function public.profiles_block_worker_code_change() returns trigger
      language plpgsql set search_path='' as $body$
      declare privileged boolean;
      begin
        if old.id is distinct from new.id then
          raise exception 'profile identity is immutable';
        end if;
        if old.worker_code is distinct from new.worker_code then
          -- Invoker rights retain the effective database role. A canonical
          -- SECURITY DEFINER provision_worker call runs as its trusted owner;
          -- browser JWT claims and user metadata cannot choose this identity.
          select current_user='service_role' or current_user::pg_catalog.regrole=p.proowner
            into privileged from pg_catalog.pg_proc p
            where p.oid=pg_catalog.to_regprocedure('public.provision_worker(uuid,uuid,text,text,text,boolean)');
          if not coalesce(privileged,false) then
            raise exception 'worker_code is immutable';
          end if;
        end if;
        return new;
      end;
      $body$;
    $definition$;
  end if;

  if pg_catalog.to_regprocedure('public.sync_worker_from_profile()') is not null then
    execute $definition$
      create or replace function public.sync_worker_from_profile() returns trigger
      language plpgsql security definer set search_path='' as $body$
      declare worker_email text; worker_name text; code_changed boolean:=false;
      begin
        -- Changing a role never deletes a worker row or its related history.
        if new.role<>'Worker' or new.worker_code is null or new.worker_code='' then return new; end if;
        select lower(u.email),coalesce(nullif(trim(new.display_name),''),
          nullif(trim(u.raw_user_meta_data->>'name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email,'Worker')
          into worker_email,worker_name from auth.users u where u.id=new.id;
        if worker_email is null or worker_email='' then return new; end if;
        if tg_op='UPDATE' then code_changed:=old.worker_code is distinct from new.worker_code; end if;
        insert into public.workers(id,user_id,name,email,active)
          values(new.worker_code,new.id,worker_name,worker_email,new.active)
          on conflict(user_id) do update set
            -- Some old public worker IDs differ from the profile code. Ordinary
            -- bootstrap/name updates preserve those established identifiers.
            id=case when code_changed then excluded.id else public.workers.id end,
            name=excluded.name,email=excluded.email,
            -- A profile refresh must never silently reactivate an inactive
            -- worker. Canonical provisioning/enrollment explicitly does so.
            active=public.workers.active and excluded.active;
        return new;
      end;
      $body$;
    $definition$;
  end if;

  if pg_catalog.to_regprocedure('public.ensure_profile()') is not null then
    execute $definition$
      create or replace function public.ensure_profile() returns public.profiles
      language plpgsql security definer set search_path='' as $body$
      declare self_id uuid:=auth.uid(); result public.profiles%rowtype;
      begin
        if self_id is null or not exists(select 1 from auth.users u where u.id=self_id
          and u.email_confirmed_at is not null
          and not coalesce((pg_catalog.to_jsonb(u)->>'is_anonymous')::boolean,false))
          or exists(select 1 from public.workers where user_id=self_id and not active) then
          raise exception 'forbidden';
        end if;
        perform public.bootstrap_worker(self_id);
        select * into strict result from public.profiles where id=self_id;
        return result;
      end;
      $body$;
    $definition$;
    execute 'revoke all on function public.ensure_profile() from public,anon';
    execute 'grant execute on function public.ensure_profile() to authenticated,service_role';
  end if;

  if pg_catalog.to_regprocedure('public.is_admin()') is not null then
    execute $definition$
      create or replace function public.is_admin() returns boolean
      language sql stable security definer set search_path='' as $body$
        select coalesce(public.app_is_admin(auth.uid()),false)
          and exists(select 1 from auth.users u where u.id=auth.uid()
            and not coalesce((pg_catalog.to_jsonb(u)->>'is_anonymous')::boolean,false))
      $body$;
    $definition$;
    execute 'revoke all on function public.is_admin() from public';
    -- Existing unrelated policies may call this harmless self-only predicate.
    execute 'grant execute on function public.is_admin() to anon,authenticated,service_role';
  end if;
end;
$migration$;

-- Trigger execution preserves the trusted function owner's permissions while
-- direct RPC access stays closed. Auth owns the existing trigger on auth.users;
-- keep that role's execute permission without requiring it on fresh projects.
do $permissions$
declare routine text;
begin
  foreach routine in array array['handle_new_user','sync_worker_from_profile',
    'profiles_set_worker_code','profiles_block_worker_code_change','next_worker_code'] loop
    if pg_catalog.to_regprocedure('public.'||routine||'()') is null then continue; end if;
    execute pg_catalog.format('revoke all on function public.%I() from public,anon,authenticated',routine);
    execute pg_catalog.format('grant execute on function public.%I() to service_role',routine);
    if exists(select 1 from pg_catalog.pg_roles where rolname='supabase_auth_admin') then
      execute pg_catalog.format('grant execute on function public.%I() to supabase_auth_admin',routine);
    end if;
  end loop;
end;
$permissions$;

notify pgrst, 'reload schema';
