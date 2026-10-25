-- Seven-day recoverable deletion, followed by storage-first, atomic Auth/database erasure.
-- Completed jobs contain operational counts/timestamps only; all user identifiers are removed.
alter table public.worker_moderation add column if not exists purge_started_at timestamptz;

create table public.worker_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  aliases text[] not null default '{}',
  requested_at timestamptz not null,
  purge_after timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','processing','retry','completed')),
  phase text not null default 'storage' check(phase in ('storage','auth','completed')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  locked_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text not null default '' check(last_error in ('','storage_failed','storage_versioning','auth_failed','cleanup_failed')),
  removed_files integer not null default 0 check(removed_files>=0),
  check(purge_after=requested_at+interval '168 hours'),
  check((status='completed')=(user_id is null)),
  check(status<>'completed' or (cardinality(aliases)=0 and lease_token is null and completed_at is not null))
);
create index worker_deletion_jobs_due on public.worker_deletion_jobs(next_attempt_at,purge_after,id) where status<>'completed';
alter table public.worker_deletion_jobs enable row level security;
revoke all on public.worker_deletion_jobs from public,anon,authenticated,service_role;
grant select on public.worker_deletion_jobs to service_role;

create table public.worker_purge_scheduler_state (
  id boolean primary key default true check(id),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  processed integer not null default 0,
  completed integer not null default 0,
  retrying integer not null default 0
);
alter table public.worker_purge_scheduler_state enable row level security;
revoke all on public.worker_purge_scheduler_state from public,anon,authenticated;
grant all on public.worker_purge_scheduler_state to service_role;

create function public.queue_worker_deletion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then
    -- Auth erasure marks the job completed before removing moderation; retain no cancelled identity.
    delete from public.worker_deletion_jobs where user_id=OLD.user_id and started_at is null;
    return null;
  end if;
  if TG_OP='UPDATE' and OLD.purge_started_at is not null and
      (NEW.status<>'deleted' or NEW.deleted_at is distinct from OLD.deleted_at) then
    raise exception 'worker_purge_started';
  end if;
  if NEW.status='deleted' then
    if TG_OP='INSERT' or OLD.status<>'deleted' or OLD.deleted_at is distinct from NEW.deleted_at then
      insert into public.worker_deletion_jobs(user_id,aliases,requested_at,purge_after,next_attempt_at)
      select NEW.user_id,array(select distinct alias from unnest(array[NEW.user_id::text,p.worker_code::text,w.id::text]) alias where alias is not null),
        NEW.deleted_at,NEW.deleted_at+interval '168 hours',NEW.deleted_at+interval '168 hours'
        from public.profiles p left join public.workers w on w.user_id=p.id where p.id=NEW.user_id
      on conflict(user_id) do update set aliases=excluded.aliases,requested_at=excluded.requested_at,
        purge_after=excluded.purge_after,next_attempt_at=excluded.next_attempt_at,status='scheduled',phase='storage',
        attempts=0,last_error='',removed_files=0,started_at=null,lease_token=null,locked_until=null;
    end if;
  else
    delete from public.worker_deletion_jobs where user_id=NEW.user_id and started_at is null;
  end if;
  return NEW;
end; $$;
revoke all on function public.queue_worker_deletion() from public,anon,authenticated;
create trigger queue_worker_deletion after insert or update on public.worker_moderation
  for each row execute function public.queue_worker_deletion();
create trigger cancel_worker_deletion after delete on public.worker_moderation
  for each row execute function public.queue_worker_deletion();

insert into public.worker_deletion_jobs(user_id,aliases,requested_at,purge_after,next_attempt_at)
select m.user_id,array(select distinct alias from unnest(array[m.user_id::text,p.worker_code::text,w.id::text]) alias where alias is not null),
  m.deleted_at,m.deleted_at+interval '168 hours',m.deleted_at+interval '168 hours'
from public.worker_moderation m join public.profiles p on p.id=m.user_id left join public.workers w on w.user_id=p.id
where m.status='deleted' and p.role='Worker' and not exists(select 1 from public.admin_owner a where a.user_id=p.id);

create function public.claim_worker_deletions(p_limit integer default 1)
returns setof public.worker_deletion_jobs language plpgsql security definer set search_path='' as $$
declare candidate record; target public.profiles%rowtype; state public.worker_moderation%rowtype;
  job public.worker_deletion_jobs%rowtype; claimed integer:=0;
begin
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  for candidate in select id,user_id from public.worker_deletion_jobs
    where status<>'completed' and purge_after<=now() and next_attempt_at<=now()
      and (locked_until is null or locked_until<=now()) order by next_attempt_at,purge_after,id limit 50
  loop
    -- Same lock order as restoration: profile, moderation, then queue.
    select * into target from public.profiles where id=candidate.user_id for update skip locked;
    if not found or target.role<>'Worker' or target.active or exists(select 1 from public.admin_owner where user_id=target.id) then continue; end if;
    select * into state from public.worker_moderation where user_id=target.id for update;
    if not found or state.status<>'deleted' or state.deleted_at>now()-interval '168 hours' then continue; end if;
    select * into job from public.worker_deletion_jobs where id=candidate.id for update skip locked;
    if not found or job.user_id is distinct from target.id or job.status='completed' or job.purge_after>now()
      or job.next_attempt_at>now() or job.locked_until>now() then continue; end if;
    if exists(select 1 from public.workers where user_id=target.id and active) then continue; end if;
    -- Alias collisions are never used to erase another account's records or files.
    if exists(select 1 from public.profiles p left join public.workers w on w.user_id=p.id
      where p.id<>target.id and (p.worker_code::text=any(job.aliases) or w.id::text=any(job.aliases))) then continue; end if;
    update public.worker_moderation set purge_started_at=coalesce(purge_started_at,clock_timestamp()) where user_id=target.id;
    update public.worker_deletion_jobs set status='processing',attempts=attempts+1,
      started_at=coalesce(started_at,clock_timestamp()),lease_token=gen_random_uuid(),locked_until=clock_timestamp()+interval '3 minutes'
      where id=job.id returning * into job;
    return next job;
    claimed:=claimed+1;
    exit when claimed>=greatest(1,least(coalesce(p_limit,1),3));
  end loop;
end; $$;

create function public.worker_deletion_storage_batch(p_job uuid,p_token uuid,p_limit integer default 100)
returns table(bucket_id text,name text,version text,versioned boolean) language plpgsql security definer set search_path='' as $$
declare job public.worker_deletion_jobs%rowtype;
begin
  select * into job from public.worker_deletion_jobs where id=p_job and lease_token=p_token
    and status='processing' and locked_until>now() and purge_after<=now();
  if not found then raise exception 'worker_purge_lease_lost'; end if;
  return query select o.bucket_id::text,o.name::text,to_jsonb(o)->>'version',
    coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
    from storage.objects o where
      to_jsonb(o)->>'owner_id'=job.user_id::text or to_jsonb(o)->>'owner'=job.user_id::text
      or string_to_array(o.name,'/') && job.aliases
      or (o.bucket_id='kyc' and exists(select 1 from public.worker_kyc k where k.user_id=job.user_id and o.name in(k.id_doc_path,k.selfie_path))
        and not exists(select 1 from public.worker_kyc k where k.user_id<>job.user_id and o.name in(k.id_doc_path,k.selfie_path)))
    order by o.bucket_id,o.name,to_jsonb(o)->>'version' limit greatest(1,least(coalesce(p_limit,100),1000));
end; $$;

create function public.prepare_worker_auth_deletion(p_job uuid,p_token uuid,p_removed integer default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare job public.worker_deletion_jobs%rowtype;
begin
  select * into job from public.worker_deletion_jobs where id=p_job and lease_token=p_token and status='processing'
    and locked_until>now() and purge_after<=now() for update;
  if not found then raise exception 'worker_purge_lease_lost'; end if;
  if exists(select 1 from public.worker_deletion_storage_batch(p_job,p_token,1)) then raise exception 'worker_purge_storage_remaining'; end if;
  update public.worker_deletion_jobs set phase='auth',removed_files=removed_files+greatest(0,coalesce(p_removed,0)),
    locked_until=clock_timestamp()+interval '3 minutes' where id=p_job;
  return job.user_id;
end; $$;

create function public.retry_worker_deletion(p_job uuid,p_token uuid,p_error text,p_removed integer default 0,p_yield boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.worker_deletion_jobs set status='retry',lease_token=null,locked_until=null,
    removed_files=removed_files+greatest(0,coalesce(p_removed,0)),
    last_error=case when p_yield then '' when p_error in ('storage_failed','storage_versioning','auth_failed','cleanup_failed') then p_error else 'cleanup_failed' end,
    next_attempt_at=clock_timestamp()+case when p_yield then interval '1 minute'
      else make_interval(secs=>least(21600,60*power(2,least(attempts,9)))::integer) end
    where id=p_job and lease_token=p_token and status='processing' and locked_until>now();
  return found;
end; $$;

-- All database erasure commits in the same Auth transaction. No profile-less valid login can slip between steps.
create function public.erase_expired_worker() returns trigger
language plpgsql security definer set search_path='' as $$
declare job public.worker_deletion_jobs%rowtype; target public.profiles%rowtype;
  applications uuid[]; linked uuid[]; work uuid[]; claims uuid[]; assignment_ids uuid[]; work_emails uuid[];
  resources text[]; addresses text[]; item record; kept jsonb; aliases text[];
begin
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  select * into target from public.profiles where id=OLD.id for update;
  if not found then return OLD; end if;
  if not exists(select 1 from public.worker_moderation where user_id=OLD.id and status='deleted') then return OLD; end if;
  if target.role<>'Worker' or target.active or exists(select 1 from public.admin_owner where user_id=OLD.id) then raise exception 'worker_purge_protected'; end if;
  perform 1 from public.worker_moderation where user_id=OLD.id and status='deleted'
    and deleted_at<=now()-interval '168 hours' and purge_started_at is not null for update;
  if not found then raise exception 'worker_purge_not_due'; end if;
  select * into job from public.worker_deletion_jobs where user_id=OLD.id and status='processing' and phase='auth'
    and purge_after<=now() and locked_until>now() for update;
  if not found then raise exception 'worker_purge_not_ready'; end if;
  if exists(select 1 from public.worker_deletion_storage_batch(job.id,job.lease_token,1)) then raise exception 'worker_purge_storage_remaining'; end if;
  aliases:=job.aliases;
  if exists(select 1 from public.profiles p left join public.workers w on w.user_id=p.id
    where p.id<>OLD.id and (p.worker_code::text=any(aliases) or w.id::text=any(aliases))) then raise exception 'worker_purge_alias_conflict'; end if;

  select coalesce(array_agg(id),'{}') into applications from public.gig_applications where worker_code=any(aliases);
  select coalesce(array_agg(id),'{}') into linked from public.linked_social_accounts where worker_code=any(aliases) or application_id=any(applications);
  select coalesce(array_agg(id),'{}') into work from public.work_items where worker_id=OLD.id;
  select coalesce(array_agg(id),'{}') into claims from public.view_payout_claims where worker_id=OLD.id or account_id=any(linked);
  select coalesce(array_agg(id),'{}') into assignment_ids from public.gig_assignments where worker_code=any(aliases);
  select coalesce(array_agg(id),'{}') into work_emails from public.work_email_accounts where owner_user_id=OLD.id;
  resources:=aliases||applications::text[]||linked::text[]||work::text[]||claims::text[]||assignment_ids::text[]||work_emails::text[];
  resources:=resources||array(select id::text from public.payout_batches where worker_id=OLD.id)
    ||array(select id::text from public.payout_items where worker_id=OLD.id or work_item_id=any(work))
    ||array(select id::text from public.worker_kyc where user_id=OLD.id)
    ||array(select id::text from public.social_account_posts where account_id=any(linked))
    ||array(select id::text from public.social_account_snapshots where account_id=any(linked))
    ||array(select id::text from public.social_account_requests where worker_code=any(aliases) or application_id=any(applications))
    ||array(select id::text from public.dashboard_feedback where user_id=OLD.id or (user_id is null and worker_id=any(aliases)));
  select coalesce(array_agg(distinct lower(address)),'{}') into addresses from (
    select OLD.email as address union select target.email union select email from public.workers where user_id=OLD.id
    union select assigned_email from public.gig_assignments where id=any(assignment_ids)
    union select jsonb_array_elements_text(assigned_emails) from public.gig_assignments where id=any(assignment_ids)
    union select email from public.work_email_accounts where id=any(work_emails)
  ) owned where nullif(address,'') is not null;

  delete from public.view_payout_claim_items where claim_id=any(claims) or post_id in(select id from public.social_account_posts where account_id=any(linked));
  delete from public.view_payout_claims where id=any(claims);
  delete from public.payout_items where worker_id=OLD.id or work_item_id=any(work) or batch_id in(select id from public.payout_batches where worker_id=OLD.id);
  delete from public.payout_batches where worker_id=OLD.id;
  delete from public.work_item_audit where work_item_id=any(work) or actor_id=OLD.id;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='by_profile') then
    execute 'delete from public.work_item_audit where by_profile::text=any($1)' using aliases;
  end if;
  delete from public.work_items where id=any(work);
  delete from public.upi_configs where worker_id=OLD.id;
  delete from public.worker_kyc_events where kyc_id in(select id from public.worker_kyc where user_id=OLD.id) or actor_id=OLD.id;
  delete from public.worker_kyc where user_id=OLD.id or (user_id is null and worker_id::text=any(aliases));
  delete from public.social_account_requests where worker_code=any(aliases) or application_id=any(applications) or source_account_id=any(linked);
  delete from public.linked_social_accounts where id=any(linked);
  delete from public.gig_applications where id=any(applications);
  delete from public.inbox_recipients where gig_assignment_id=any(assignment_ids) or work_email_account_id=any(work_emails);
  delete from public.gig_assignments where id=any(assignment_ids);
  delete from public.work_email_accounts where id=any(work_emails);
  delete from public.assignments where worker_id=OLD.id;
  delete from public.worker_account_assignments where worker_id=OLD.id;
  delete from public.worker_accounts where worker_id=OLD.id;
  if to_regclass('public.legacy_worker_accounts') is not null then
    execute 'delete from public.legacy_worker_accounts where worker_id::text=any($1)' using aliases;
  end if;
  delete from public.dashboard_feedback where user_id=OLD.id or (user_id is null and worker_id::text=any(aliases));
  delete from public.email_suppressions where email=any(addresses);
  delete from public.api_rate_limits where string_to_array(key,':') && aliases;

  -- Erase only the deleted user from multi-user operation results; retain other users' entries.
  delete from public.worker_bulk_operations where actor_id=OLD.id;
  for item in select id,result from public.worker_bulk_operations where exists(
    select 1 from jsonb_array_elements(coalesce(result->'items','[]')) entry
      where entry->>'userId'=OLD.id::text or entry->>'workerId'=any(aliases)) for update
  loop
    select coalesce(jsonb_agg(entry),'[]') into kept from jsonb_array_elements(item.result->'items') entry
      where coalesce(entry->>'userId','')<>OLD.id::text and not coalesce(entry->>'workerId','')=any(aliases);
    update public.worker_bulk_operations set result=(item.result||jsonb_build_object('items',kept,
      'succeeded',(select count(*) from jsonb_array_elements(kept) e where e->>'status'='success'),
      'skipped',(select count(*) from jsonb_array_elements(kept) e where e->>'status'='skipped'),
      'failed',(select count(*) from jsonb_array_elements(kept) e where e->>'status'='failed'))),
      reason='User data removed after the deletion retention period.' where id=item.id;
    update public.audit_events set details=jsonb_build_object('reason','User data removed after the deletion retention period.') where resource_id=item.id::text;
  end loop;
  delete from public.audit_events where actor_id=OLD.id or resource_id=any(resources)
    or details->>'workerId'=any(aliases) or details->>'userId'=OLD.id::text;
  delete from public.worker_moderation_events where user_id=OLD.id;
  update public.worker_moderation_events set actor_id=null,actor_label='Deleted user' where actor_id=OLD.id;
  delete from public.worker_access_ips where user_id=OLD.id;
  delete from public.worker_ip_blocks where user_id=OLD.id;
  update public.worker_ip_blocks set blocked_by=null where blocked_by=OLD.id;

  -- Shared resources survive with their former actor reference removed.
  update public.assignments set assigned_by=null where assigned_by=OLD.id;
  update public.worker_account_assignments set assigned_by=null where assigned_by=OLD.id;
  update public.worker_kyc set reviewer_id=null where reviewer_id=OLD.id;
  update public.upi_configs set verified_by=null where verified_by=OLD.id;
  update public.payout_batches set processed_by=null where processed_by=OLD.id;
  update public.linked_social_accounts set linked_by=null where linked_by=OLD.id;
  update public.social_account_posts set updated_by=null where updated_by=OLD.id;
  update public.social_account_snapshots set recorded_by=null where recorded_by=OLD.id;
  update public.social_account_requests set reviewed_by=null where reviewed_by=OLD.id;
  update public.view_payout_claims set reviewed_by=null where reviewed_by=OLD.id;
  update public.integration_settings set updated_by=null where updated_by=OLD.id;
  delete from public.application_automation_runs where actor_id=OLD.id or rule_id in(select id from public.application_automation_rules where owner_id=OLD.id);
  delete from public.application_automation_rules where owner_id=OLD.id;
  update public.application_automation_rules set template_id=null where template_id in(select id from public.application_message_templates where created_by=OLD.id);
  delete from public.application_message_templates where created_by=OLD.id;
  update public.work_email_secret_codes set created_by=null where created_by::text=OLD.id::text;
  update public.work_items set created_by=null where created_by::text=any(aliases);

  update public.worker_deletion_jobs set status='completed',phase='completed',completed_at=clock_timestamp(),
    user_id=null,aliases='{}',lease_token=null,locked_until=null,last_error='' where id=job.id;
  delete from public.worker_moderation where user_id=OLD.id;
  -- profiles/workers and provider-managed identities/sessions cascade from the Auth API's deletion.
  return OLD;
end; $$;
revoke all on function public.erase_expired_worker() from public,anon,authenticated,service_role;
create trigger erase_expired_worker before delete on auth.users for each row execute function public.erase_expired_worker();

revoke all on function public.claim_worker_deletions(integer),public.worker_deletion_storage_batch(uuid,uuid,integer),
  public.prepare_worker_auth_deletion(uuid,uuid,integer),public.retry_worker_deletion(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.claim_worker_deletions(integer),public.worker_deletion_storage_batch(uuid,uuid,integer),
  public.prepare_worker_auth_deletion(uuid,uuid,integer),public.retry_worker_deletion(uuid,uuid,text,integer,boolean) to service_role;

-- Keep previously deployed bulk functions consistent without changing their moderation/idempotency logic.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.moderate_workers_bulk(uuid,text,text,jsonb,uuid,text,timestamptz,inet)'::regprocedure);
  execute replace(definition,'User deleted; records retained.','User deleted; permanent removal is scheduled after 7 days.');
  definition:=pg_get_functiondef('public.preview_workers_bulk(uuid,text[],text,inet)'::regprocedure);
  execute replace(definition,
    'elsif p_action=''restore'' and current_status=''active''',
    'elsif p_action=''restore'' and state.purge_started_at is not null then eligible:=false;skip_reason:=''Permanent deletion has started; this user can no longer be restored.'';
    elsif p_action=''restore'' and current_status=''active''');
end; $$;

create trigger admin_worker_deletion_live_update after insert or update or delete on public.worker_deletion_jobs
  for each statement execute function public.notify_admin_live();
notify pgrst,'reload schema';
