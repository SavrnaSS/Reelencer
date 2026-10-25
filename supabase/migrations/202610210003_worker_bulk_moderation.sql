-- Durable, bounded bulk operations. A saved result and every successful account
-- change commit together; retries never replay a completed batch.
create table if not exists public.worker_bulk_operations (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  action text not null check(action in ('suspend','suspend_ip','restore','delete')),
  reason text not null check(length(reason) between 8 and 1000),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists worker_bulk_operations_actor_recent on public.worker_bulk_operations(actor_id,created_at desc);
alter table public.worker_bulk_operations enable row level security;
revoke all on public.worker_bulk_operations from public,anon,authenticated,service_role;
grant select on public.worker_bulk_operations to service_role;

-- updated_at is the preview version. Unblocking an address also changes the
-- account's version, even when its suspension status stays the same.
create or replace function public.touch_worker_moderation_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  NEW.updated_at:=clock_timestamp();
  return NEW;
end; $$;
revoke all on function public.touch_worker_moderation_version() from public,anon,authenticated;
create trigger worker_moderation_version before update on public.worker_moderation
  for each row execute function public.touch_worker_moderation_version();
create or replace function public.touch_worker_ip_block_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then
    update public.worker_moderation set updated_at=clock_timestamp() where user_id=OLD.user_id;
  else
    update public.worker_moderation set updated_at=clock_timestamp() where user_id=NEW.user_id;
  end if;
  return null;
end; $$;
revoke all on function public.touch_worker_ip_block_version() from public,anon,authenticated;
create trigger worker_ip_block_version after insert or update or delete on public.worker_ip_blocks
  for each row execute function public.touch_worker_ip_block_version();

-- Restoring also reconciles legacy inactive flags when an old moderation row
-- already says active. Earlier applied migrations retain their original checksums.
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
    changed:=found or not target.active or exists(select 1 from public.workers where user_id=p_worker and not active);
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

create or replace function public.preview_workers_bulk(p_actor uuid,p_worker_ids text[],p_action text,p_actor_ip inet default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare requested text; target public.profiles%rowtype; state public.worker_moderation%rowtype;
  current_status text; candidate inet; eligible boolean; skip_reason text;
  items jsonb:='[]'::jsonb; seen uuid[]:='{}'::uuid[]; current_name text; worker_active boolean; matches integer;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_worker_ids is null or cardinality(p_worker_ids) not between 1 and 100
    or exists(select 1 from unnest(p_worker_ids) id where id is null or id !~ '^[a-zA-Z0-9_-]{1,80}$')
    then raise exception 'invalid_bulk_selection'; end if;
  if p_action is null or p_action not in ('suspend','suspend_ip','restore','delete') then raise exception 'invalid_moderation_action'; end if;
  foreach requested in array p_worker_ids loop
    select count(distinct p.id)::int into matches from public.profiles p left join public.workers w on w.user_id=p.id
      where p.worker_code=requested or p.id::text=requested or w.id=requested;
    if matches>1 then
      items:=items||jsonb_build_array(jsonb_build_object('workerId',requested,'userId',null,'name',requested,
        'email','','status',null,'eligible',false,'skipReason','This identifier matches multiple users. Review the users individually.','expectedUpdatedAt',null));
      continue;
    end if;
    -- Prefer the displayed profile code, then UUID, then a retained legacy alias.
    select p.* into target from public.profiles p left join public.workers w on w.user_id=p.id
      where p.worker_code=requested or p.id::text=requested or w.id=requested
      order by (p.worker_code=requested) desc,(p.id::text=requested) desc,p.id limit 1;
    if not found then
      items:=items||jsonb_build_array(jsonb_build_object('workerId',requested,'userId',null,'name',requested,
        'email','','status',null,'eligible',false,'skipReason','User no longer exists.','expectedUpdatedAt',null));
      continue;
    end if;
    if target.id=any(seen) then continue; end if;
    seen:=array_append(seen,target.id);
    select * into state from public.worker_moderation where user_id=target.id;
    select w.active into worker_active from public.workers w where w.user_id=target.id;
    current_status:=coalesce(nullif(state.status,'active'),case when target.active and worker_active is distinct from false then 'active' else 'suspended' end);
    current_name:=left(coalesce(nullif(target.display_name,''),nullif(target.email,''),target.worker_code),150);
    eligible:=true;skip_reason:=null;candidate:=null;
    if target.id=p_actor or target.role<>'Worker' or exists(select 1 from public.admin_owner where user_id=target.id) then
      eligible:=false;skip_reason:='Administrator accounts are protected.';
    elsif p_action='suspend' and current_status<>'active' then
      eligible:=false;skip_reason:=case when current_status='deleted' then 'Restore this deleted user before suspending access.' else 'Access is already suspended.' end;
    elsif p_action='delete' and current_status='deleted' then
      eligible:=false;skip_reason:='User is already deleted.';
    elsif p_action='restore' and current_status='active' and not exists(select 1 from public.worker_ip_blocks where user_id=target.id) then
      eligible:=false;skip_reason:='Access is already active.';
    elsif p_action='suspend_ip' then
      if current_status='deleted' then
        eligible:=false;skip_reason:='Restore this deleted user before blocking an address.';
      elsif p_actor_ip is null or not public.is_public_worker_ip(p_actor_ip) then
        eligible:=false;skip_reason:='Your current connection address cannot be verified.';
      else
        select a.ip into candidate from public.worker_access_ips a
          where a.user_id=target.id and public.is_public_worker_ip(a.ip) and a.ip<>p_actor_ip
            and not exists(select 1 from public.worker_ip_blocks b where b.user_id=target.id and b.ip=a.ip)
            and not exists(select 1 from public.worker_access_ips admin_ip join public.admin_owner o on o.user_id=admin_ip.user_id where admin_ip.ip=a.ip)
          order by a.last_seen_at desc,a.ip limit 1;
        if candidate is null then eligible:=false;skip_reason:='No safe, unblocked captured IP address is available.'; end if;
      end if;
    end if;
    items:=items||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'workerId',target.worker_code,'userId',target.id,'name',current_name,'email',left(coalesce(target.email,''),254),
      'status',current_status,'eligible',eligible,'skipReason',skip_reason,'ip',case when candidate is not null then host(candidate) else null end,
      'expectedUpdatedAt',state.updated_at,'expectedProfileActive',target.active,'expectedWorkerActive',worker_active)));
  end loop;
  return items;
end; $$;

create or replace function public.moderate_workers_bulk(
  p_actor uuid,p_action text,p_reason text,p_items jsonb,p_operation_id uuid,p_request_hash text,p_preview_expires_at timestamptz,p_actor_ip inet default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.worker_bulk_operations%rowtype; item jsonb; target public.profiles%rowtype;
  state public.worker_moderation%rowtype; current_status text; outcome jsonb;
  results jsonb:='[]'::jsonb; output jsonb; succeeded integer:=0; skipped integer:=0; failed integer:=0;
  item_status text; item_message text; target_id uuid; worker_active boolean;
begin
  -- The same ordering as single moderation and administrator enrollment avoids
  -- deadlocks between a batch, another moderator and owner rotation.
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  if p_operation_id is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_bulk_operation'; end if;
  select * into previous from public.worker_bulk_operations where id=p_operation_id;
  if found then
    if previous.actor_id<>p_actor or previous.request_hash<>p_request_hash then raise exception 'bulk_idempotency_conflict'; end if;
    return previous.result;
  end if;
  -- Check expiry only after the same lock as operation commits. A timed-out
  -- caller can retry an expired preview and still recover its committed result.
  if p_preview_expires_at is null or p_preview_expires_at<=clock_timestamp() then raise exception 'bulk_preview_expired'; end if;
  if p_action is null or p_action not in ('suspend','suspend_ip','restore','delete') then raise exception 'invalid_moderation_action'; end if;
  if p_reason is null or length(trim(p_reason)) not between 8 and 1000 then raise exception 'moderation_reason_required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid_bulk_selection'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) v where jsonb_typeof(v)<>'object'
    or coalesce(v->>'workerId','') !~ '^[a-zA-Z0-9_-]{1,80}$'
    or (v->>'userId' is not null and v->>'userId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    or jsonb_typeof(v->'eligible') is distinct from 'boolean')
    or (select count(*) from jsonb_array_elements(p_items) v where v->>'userId' is not null)<>
      (select count(distinct v->>'userId') from jsonb_array_elements(p_items) v where v->>'userId' is not null)
    then raise exception 'invalid_bulk_selection'; end if;

  for item in select value from jsonb_array_elements(p_items) order by value->>'userId' nulls last,value->>'workerId' loop
    item_status:='skipped';item_message:=coalesce(item->>'skipReason','This user was not eligible in the reviewed preview.');
    target_id:=nullif(item->>'userId','')::uuid;
    if (item->>'eligible')::boolean and target_id is not null then
      -- Each user is a savepoint. One rejected target cannot roll back the
      -- successful changes for other selected users.
      begin
        select * into target from public.profiles where id=target_id for update;
        if not found then raise exception 'not_found'; end if;
        if target.id=p_actor or target.role<>'Worker' or exists(select 1 from public.admin_owner where user_id=target.id) then raise exception 'forbidden'; end if;
        select * into state from public.worker_moderation where user_id=target.id for update;
        select w.active into worker_active from public.workers w where w.user_id=target.id;
        current_status:=coalesce(nullif(state.status,'active'),case when target.active and worker_active is distinct from false then 'active' else 'suspended' end);
        if current_status is distinct from item->>'status' or state.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz
          or target.worker_code is distinct from item->>'workerId'
          or target.active is distinct from (item->>'expectedProfileActive')::boolean
          or worker_active is distinct from (item->>'expectedWorkerActive')::boolean then raise exception 'bulk_preview_stale'; end if;
        outcome:=public.moderate_worker(p_actor,target.id,p_action,trim(p_reason),
          case when p_action='delete' then target.worker_code else null end,
          nullif(item->>'ip','')::inet,p_actor_ip);
        if (outcome->>'changed')::boolean then
          item_status:='success';item_message:=case p_action when 'suspend' then 'Access suspended.' when 'suspend_ip' then 'Access suspended and selected IP blocked.' when 'restore' then 'Access restored and owned IP blocks removed.' else 'User deleted; records retained.' end;
        else item_status:='skipped';item_message:='The requested state is already applied.'; end if;
      exception when others then
        item_status:=case when SQLSTATE='P0001' then 'skipped' else 'failed' end;
        item_message:=case SQLERRM
          when 'bulk_preview_stale' then 'Access changed after this preview. Review this user again.'
          when 'forbidden' then 'Administrator accounts are protected.'
          when 'not_found' then 'User no longer exists.'
          when 'admin_ip_protected' then 'Selected IP is now used by an administrator.'
          when 'actor_ip_required' then 'Your current connection address cannot be verified.'
          when 'worker_ip_not_observed' then 'Selected IP is no longer available for this user.'
          when 'invalid_transition' then 'This action is no longer available. Review this user again.'
          else 'This user could not be updated. Review and retry separately.' end;
      end;
    end if;
    if item_status='success' then succeeded:=succeeded+1; elsif item_status='skipped' then skipped:=skipped+1; else failed:=failed+1; end if;
    results:=results||jsonb_build_array(jsonb_build_object('workerId',item->>'workerId','userId',target_id,
      'name',coalesce(item->>'name',item->>'workerId'),'status',item_status,'message',item_message));
  end loop;
  output:=jsonb_build_object('operationId',p_operation_id,'action',p_action,'items',results,'succeeded',succeeded,'skipped',skipped,'failed',failed);
  insert into public.worker_bulk_operations(id,actor_id,request_hash,action,reason,result)
    values(p_operation_id,p_actor,p_request_hash,p_action,trim(p_reason),output);
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'worker_bulk_'||p_action,p_operation_id::text,
    jsonb_build_object('succeeded',succeeded,'skipped',skipped,'failed',failed,'reason',trim(p_reason)));
  return output;
end; $$;

revoke all on function public.preview_workers_bulk(uuid,text[],text,inet) from public,anon,authenticated;
revoke all on function public.moderate_workers_bulk(uuid,text,text,jsonb,uuid,text,timestamptz,inet) from public,anon,authenticated;
grant execute on function public.preview_workers_bulk(uuid,text[],text,inet),
  public.moderate_workers_bulk(uuid,text,text,jsonb,uuid,text,timestamptz,inet) to service_role;
notify pgrst, 'reload schema';
