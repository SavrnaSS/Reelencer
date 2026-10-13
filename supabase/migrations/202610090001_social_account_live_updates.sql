-- Notify each creator when their linked-account data changes. Never broadcast
-- row contents or grant browser access to the server-only social tables.
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;

create policy creator_social_updates_read on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and topic = 'social-accounts:' || (select auth.uid())::text);

-- Keep this namespace private even if another feature has broader policies.
create policy creator_social_updates_owner on realtime.messages as restrictive
  for select to anon, authenticated
  using (topic not like 'social-accounts:%' or topic = 'social-accounts:' || (select auth.uid())::text);
create policy creator_social_updates_server_send on realtime.messages as restrictive
  for insert to anon, authenticated
  with check (topic not like 'social-accounts:%');

create or replace function public.notify_creator_social_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  codes text[] := array[]::text[];
  account_ids uuid[] := array[]::uuid[];
  recipient uuid;
begin
  if TG_TABLE_NAME = 'linked_social_accounts' then
    if TG_OP <> 'INSERT' then codes := array_append(codes, OLD.worker_code); end if;
    if TG_OP <> 'DELETE' then codes := array_append(codes, NEW.worker_code); end if;
  else
    if TG_OP <> 'INSERT' then account_ids := array_append(account_ids, OLD.account_id); end if;
    if TG_OP <> 'DELETE' then account_ids := array_append(account_ids, NEW.account_id); end if;
    select array_agg(distinct a.worker_code) into codes
      from public.linked_social_accounts a where a.id = any(account_ids);
  end if;
  for recipient in
    select distinct p.id from public.profiles p
      left join public.workers w on w.user_id = p.id
      where p.active and coalesce(w.active, true)
        and (p.id::text = any(codes) or p.worker_code = any(codes) or w.id = any(codes))
  loop
    begin
      perform realtime.send(jsonb_build_object('changedAt', clock_timestamp()),
        'changed', 'social-accounts:' || recipient::text, true);
    exception when others then
      -- Notifications are best effort; saved insights must survive a Broadcast outage.
      raise warning 'Social account notification unavailable (%); polling will catch up.', SQLSTATE;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.notify_creator_social_updates() from public, anon, authenticated;

create trigger creator_linked_account_live_update
  after insert or update or delete on public.linked_social_accounts
  for each row execute function public.notify_creator_social_updates();
create trigger creator_social_snapshot_live_update
  after insert or update or delete on public.social_account_snapshots
  for each row execute function public.notify_creator_social_updates();
create trigger creator_social_post_live_update
  after insert or update or delete on public.social_account_posts
  for each row execute function public.notify_creator_social_updates();
