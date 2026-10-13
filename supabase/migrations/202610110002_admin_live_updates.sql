-- Live admin consoles. Like the creator topics, the admin topic carries only a content-free "changed" signal with
-- the kind of record (table name); consoles re-read through their authenticated admin APIs. Only admins may listen.

-- Realtime policies run as the browser's role, which can't execute app_is_admin(uuid); this wrapper only ever
-- answers for the caller's own session.
create or replace function public.realtime_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.app_is_admin((select auth.uid())), false);
$$;
-- anon needs it too: the restrictive guard below applies to every role (it simply answers false without a session).
revoke all on function public.realtime_is_admin() from public;
grant execute on function public.realtime_is_admin() to anon, authenticated;

create policy admin_live_updates_read on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and topic = 'admin:live' and (select public.realtime_is_admin()));
create policy admin_live_updates_guard on realtime.messages as restrictive
  for select to anon, authenticated
  using (topic not like 'admin:%' or (select public.realtime_is_admin()));
create policy admin_live_updates_server_send on realtime.messages as restrictive
  for insert to anon, authenticated
  with check (topic not like 'admin:%');

create or replace function public.notify_admin_live()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('changedAt', clock_timestamp(), 'kind', TG_TABLE_NAME, 'op', TG_OP),
      'changed', 'admin:live', true);
  exception when others then
    raise warning 'Admin live notification unavailable (%); consoles poll as a fallback.', SQLSTATE;
  end;
  return null;
end;
$$;
revoke all on function public.notify_admin_live() from public, anon, authenticated;

-- Statement-level: a payout touching many items signals once.
do $$
declare t text;
begin
  foreach t in array array['upi_configs','worker_kyc','payout_batches','view_payout_claims','social_account_requests'] loop
    execute format('drop trigger if exists admin_live_update on public.%I', t);
    execute format('create trigger admin_live_update after insert or update or delete on public.%I for each statement execute function public.notify_admin_live()', t);
  end loop;
end $$;
-- Work items change often for unrelated reasons; only status/reward changes matter to payouts.
drop trigger if exists admin_live_update on public.work_items;
create trigger admin_live_update after insert or delete or update of status, reward_inr on public.work_items
  for each statement execute function public.notify_admin_live();
