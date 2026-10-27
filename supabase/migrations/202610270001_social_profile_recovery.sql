-- A reversible removal from Linked; historical reels, measurements and payout records stay on the same row.
alter table public.linked_social_accounts add column if not exists profile_health jsonb not null default '{}'::jsonb
  check (jsonb_typeof(profile_health) = 'object');

-- Revisit old ambiguous failures with the stricter reader; no account is unlinked by this migration.
update public.linked_social_accounts set next_sync_at = now()
  where status = 'active' and sync_error_code = 'not_found' and (sync_locked_until is null or sync_locked_until <= now());

-- Creator recovery uses a server-verified bio code; manual restoration is restricted to administrators by the API.
-- Serialize restores for a worker and a handle, and re-check capacity and duplicates inside the same transaction.
create or replace function public.social_profile_platform(p_platform text) returns text
language sql immutable set search_path = '' as $$
  select case when lower(p_platform) ~ 'insta|\mig\M|reels' then 'instagram'
    when lower(p_platform) ~ 'youtube|\myt\M|shorts' then 'youtube' else lower(btrim(p_platform)) end;
$$;
revoke all on function public.social_profile_platform(text) from public,anon,authenticated;
grant execute on function public.social_profile_platform(text) to service_role;

create or replace function public.update_social_profile_recovery(
  p_account_id uuid, p_expected_health jsonb, p_health jsonb, p_worker_code text,
  p_restore boolean default false, p_handle text default null, p_profile_url text default null,
  p_external_id text default null, p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.linked_social_accounts; result public.linked_social_accounts;
begin
  select * into a from public.linked_social_accounts where id = p_account_id;
  if not found then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-recovery-worker:' || a.worker_code, 0));
  if p_restore then
    perform pg_advisory_xact_lock(hashtextextended('profile-recovery-handle:' || public.social_profile_platform(a.platform) || ':' || lower(btrim(p_handle)), 0));
  end if;
  select * into a from public.linked_social_accounts where id = p_account_id for update;
  if a.worker_code is distinct from p_worker_code or a.status <> 'unlinked' or (a.profile_health->>'status') is distinct from 'missing' or a.profile_health is distinct from p_expected_health
    then raise exception 'invalid_transition'; end if;
  if jsonb_typeof(p_health) is distinct from 'object'
    or (p_restore and (p_health->>'status') is distinct from 'healthy')
    or (not p_restore and (p_health->>'status') is distinct from 'missing') then raise exception 'invalid_transition'; end if;
  if p_restore then
    if nullif(btrim(p_handle), '') is null or nullif(btrim(p_profile_url), '') is null then raise exception 'invalid_transition'; end if;
    if exists(select 1 from public.linked_social_accounts other where other.id <> a.id and other.status <> 'unlinked'
      and public.social_profile_platform(other.platform) = public.social_profile_platform(a.platform) and lower(other.handle) = lower(btrim(p_handle)))
      then raise exception 'profile_already_linked'; end if;
    if (select count(*) from public.linked_social_accounts where worker_code = a.worker_code and status <> 'unlinked') >= 6
      or (select count(*) from public.linked_social_accounts where application_id = a.application_id and status <> 'unlinked') >= 3
      then raise exception 'profile_account_limit'; end if;
    update public.linked_social_accounts set
      handle = btrim(p_handle), profile_url = btrim(p_profile_url), external_id = coalesce(p_external_id, external_id),
      status = 'active', profile_health = p_health, linked_by = coalesce(p_actor, linked_by),
      sync_status = 'pending', sync_error = '', sync_error_code = '', sync_failures = 0,
      sync_locked_until = null, sync_lock_token = null, next_sync_at = now(), updated_at = now()
      where id = a.id returning * into result;
  else
    update public.linked_social_accounts set profile_health = p_health, updated_at = now()
      where id = a.id returning * into result;
  end if;
  return to_jsonb(result);
end $$;
revoke all on function public.update_social_profile_recovery(uuid,jsonb,jsonb,text,boolean,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.update_social_profile_recovery(uuid,jsonb,jsonb,text,boolean,text,text,text,uuid) to service_role;
notify pgrst, 'reload schema';
