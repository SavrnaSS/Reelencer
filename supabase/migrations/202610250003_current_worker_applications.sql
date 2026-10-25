-- Keep restorable applications in storage, but exclude deleted accounts from operational reads.
-- Resolve canonical codes first; old applications can also contain a user ID or email snapshot.
create function public.application_worker_identity(p_alias text,p_name text default null) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare identities uuid[]; payload jsonb; encoded text; decoded text; owner_id text;
begin
  select array_agg(distinct p.id) into identities from public.profiles p
    left join public.workers w on w.user_id=p.id
    where p_alias in(p.id::text,p.worker_code,w.id);
  if cardinality(identities)=1 then return identities[1]; end if;
  if cardinality(identities)>1 then return null; end if;

  if left(coalesce(p_name,''),23)='__REELENCER_PROPOSAL__:' then
    encoded:=substr(p_name,24);
    begin
      select convert_from(string_agg(case when left(part[1],1)='%' and length(part[1])=3
        then decode(substr(part[1],2),'hex') else convert_to(part[1],'UTF8') end,''::bytea),'UTF8')
        into decoded from regexp_matches(encoded,'%[0-9a-fA-F]{2}|[^%]+|%','g') part;
      payload:=decoded::jsonb;
    exception when others then
      begin payload:=convert_from(decode(encoded,'base64'),'UTF8')::jsonb;
      exception when others then payload:=null; end;
    end;
    owner_id:=payload->>'workerUserId';
    if owner_id is not null then
      select array_agg(p.id) into identities from public.profiles p where p.id::text=owner_id;
      if cardinality(identities)=1 then return identities[1]; end if;
    end if;
  end if;

  select array_agg(distinct p.id) into identities from public.profiles p
    left join public.workers w on w.user_id=p.id
    where lower(nullif(trim(p_alias),'')) in(lower(p.email),lower(w.email))
      or lower(nullif(trim(payload->>'workerEmail'),'')) in(lower(p.email),lower(w.email));
  if cardinality(identities)=1 then return identities[1]; end if;
  return null;
end; $$;

create view public.current_gig_applications with(security_invoker=true) as
  select a.* from public.gig_applications a
  where exists(select 1 from public.profiles p
    where p.id=public.application_worker_identity(a.worker_code,a.worker_name)
      and not exists(select 1 from public.worker_moderation m where m.user_id=p.id and m.status='deleted'));
revoke all on public.current_gig_applications from public,anon,authenticated,service_role;
grant select on public.current_gig_applications to service_role;
revoke all on function public.application_worker_identity(text,text) from public,anon,authenticated;
grant execute on function public.application_worker_identity(text,text) to service_role;

-- A stale browser or an automation selected before deletion must not update or message that account.
-- Share the profile lock used by moderation so deletion and application changes are serialized.
create function public.guard_current_application_worker() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  target:=public.application_worker_identity(NEW.worker_code,NEW.worker_name);
  if target is not null then
    perform 1 from public.profiles where id=target for share;
    if exists(select 1 from public.worker_moderation where user_id=target and status='deleted') then
      raise exception 'worker_deleted';
    end if;
  end if;
  return NEW;
end; $$;
revoke all on function public.guard_current_application_worker() from public,anon,authenticated;
create trigger current_application_worker_guard before insert or update on public.gig_applications
  for each row execute function public.guard_current_application_worker();

notify pgrst,'reload schema';
