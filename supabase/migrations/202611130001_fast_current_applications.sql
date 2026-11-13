-- The Applications page timed out: every application re-scanned all profiles and workers to find its owner.
create or replace function public.application_worker_identity(p_alias text,p_name text default null) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare identities uuid[]; payload jsonb; encoded text; decoded text; owner_id text; alias_email text; payload_email text;
begin
  -- Each lookup is a separate equality so it uses an index; OR across columns forced a scan of every profile per row.
  select array_agg(distinct id) into identities from (
    select p.id from public.profiles p
      where p_alias ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id=p_alias::uuid
    union all select p.id from public.profiles p where p.worker_code=p_alias
    union all select p.id from public.workers w join public.profiles p on p.id=w.user_id where w.id=p_alias
  ) found;
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

  alias_email:=lower(nullif(trim(p_alias),''));
  payload_email:=lower(nullif(trim(payload->>'workerEmail'),''));
  if alias_email is null and payload_email is null then return null; end if;
  select array_agg(distinct id) into identities from (
    select p.id from public.profiles p where lower(p.email) in(alias_email,payload_email)
    union all select p.id from public.workers w join public.profiles p on p.id=w.user_id where lower(w.email) in(alias_email,payload_email)
  ) found;
  if cardinality(identities)=1 then return identities[1]; end if;
  return null;
end; $$;

-- Resolve each application's owner once; comparing profiles.id to the function inside EXISTS let the planner call it per profile.
create or replace view public.current_gig_applications with(security_invoker=true) as
  select a.* from public.gig_applications a
  cross join lateral(select public.application_worker_identity(a.worker_code,a.worker_name) owner_id offset 0) owner
  where exists(select 1 from public.profiles p where p.id=owner.owner_id)
    and not exists(select 1 from public.worker_moderation m where m.user_id=owner.owner_id and m.status='deleted');

notify pgrst,'reload schema';
