-- Live profile/account updates for creators: a content-free "changed" signal on a private per-user topic when
-- their profile details, worker record or account assignments change (from another tab, device or an admin).
-- The dashboard then re-reads its profile through the authenticated API.

create policy creator_account_updates_read on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and topic = 'account:' || (select auth.uid())::text);
create policy creator_account_updates_owner on realtime.messages as restrictive
  for select to anon, authenticated
  using (topic not like 'account:%' or topic = 'account:' || (select auth.uid())::text);
create policy creator_account_updates_server_send on realtime.messages as restrictive
  for insert to anon, authenticated
  with check (topic not like 'account:%');

create or replace function public.notify_creator_account_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidates text[] := array[]::text[];
  recipient uuid;
  key text := case TG_TABLE_NAME when 'profiles' then 'id' when 'workers' then 'user_id' else 'worker_id' end;
begin
  if TG_OP <> 'INSERT' then candidates := candidates || (to_jsonb(OLD)->>key); end if;
  if TG_OP <> 'DELETE' then candidates := candidates || (to_jsonb(NEW)->>key); end if;
  for recipient in
    select distinct c::uuid from unnest(candidates) c
      where c ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    begin
      perform realtime.send(jsonb_build_object('changedAt', clock_timestamp(), 'kind', TG_TABLE_NAME),
        'changed', 'account:' || recipient::text, true);
    exception when others then
      raise warning 'Account notification unavailable (%); polling will catch up.', SQLSTATE;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.notify_creator_account_updates() from public, anon, authenticated;

-- Profiles change for many reasons; only what the account card and profile show matters.
drop trigger if exists creator_profile_live_update on public.profiles;
create trigger creator_profile_live_update
  after update of display_name, headline, city, bio, active, role, timezone on public.profiles
  for each row execute function public.notify_creator_account_updates();
drop trigger if exists creator_worker_live_update on public.workers;
create trigger creator_worker_live_update
  after insert or update or delete on public.workers
  for each row execute function public.notify_creator_account_updates();
do $$
declare t text;
begin
  foreach t in array array['assignments', 'worker_account_assignments'] loop
    execute format('drop trigger if exists creator_assignment_live_update on public.%I', t);
    execute format('create trigger creator_assignment_live_update after insert or update or delete on public.%I for each row execute function public.notify_creator_account_updates()', t);
  end loop;
end $$;
