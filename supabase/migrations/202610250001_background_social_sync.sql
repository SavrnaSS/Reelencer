-- Durable deadlines and short, exclusive leases shared by cron, page visits and manual refreshes.
alter table public.linked_social_accounts
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists next_sync_at timestamptz default now(),
  add column if not exists sync_failures integer not null default 0 check (sync_failures >= 0),
  add column if not exists sync_error_code text not null default '',
  add column if not exists sync_provider text not null default '',
  add column if not exists sync_locked_until timestamptz,
  add column if not exists sync_lock_token uuid;

-- Previously a failed attempt overwrote the success timestamp. Recover its real provenance.
update public.linked_social_accounts a set
  last_sync_attempt_at = a.last_synced_at,
  last_synced_at = case when a.sync_status = 'error' then
    (select max(s.captured_at) from public.social_account_snapshots s where s.account_id = a.id and s.source in ('api','profile'))
    else a.last_synced_at end,
  sync_failures = case when a.sync_status = 'error' then 1 else 0 end,
  next_sync_at = coalesce(a.last_synced_at + case when a.sync_status = 'error' then interval '30 minutes'
    when lower(a.platform) ~ 'insta|\mig\M|reels' then interval '5 minutes' else interval '30 minutes' end, now());

create index if not exists linked_social_accounts_due on public.linked_social_accounts(next_sync_at, id) where status = 'active';

create or replace function public.claim_social_sync_accounts(
  p_limit integer default 2, p_account_id uuid default null, p_force boolean default false, p_youtube_enabled boolean default false
) returns setof public.linked_social_accounts
language sql security definer set search_path = '' as $$
  with due as (
    select a.id from public.linked_social_accounts a
    where a.status = 'active'
      and (p_account_id is null or a.id = p_account_id)
      and (coalesce(a.next_sync_at, '-infinity'::timestamptz) <= now() or (p_force and p_account_id is not null))
      and (a.sync_locked_until is null or a.sync_locked_until <= now())
      and (lower(a.platform) ~ 'insta|\mig\M|reels' or (p_youtube_enabled and lower(a.platform) ~ 'youtube|\myt\M|shorts'))
    order by coalesce(a.next_sync_at, a.linked_at), a.id
    limit greatest(1, least(coalesce(p_limit, 2), 12))
    for update skip locked
  )
  update public.linked_social_accounts a set
    sync_lock_token = gen_random_uuid(), sync_locked_until = now() + interval '2 minutes', last_sync_attempt_at = now()
  from due where a.id = due.id returning a.*;
$$;
revoke all on function public.claim_social_sync_accounts(integer, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.claim_social_sync_accounts(integer, uuid, boolean, boolean) to service_role;

create table if not exists public.social_sync_scheduler_state (
  id boolean primary key default true check (id),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  processed integer not null default 0,
  synced integer not null default 0,
  failed integer not null default 0
);
alter table public.social_sync_scheduler_state enable row level security;
revoke all on public.social_sync_scheduler_state from public, anon, authenticated;
grant all on public.social_sync_scheduler_state to service_role;

-- Reuse private admin invalidations; broadcasts contain no account data or credentials.
create trigger admin_linked_social_accounts_live_update after insert or update or delete on public.linked_social_accounts
  for each statement execute function public.notify_admin_live();
create trigger admin_social_account_snapshots_live_update after insert or update or delete on public.social_account_snapshots
  for each statement execute function public.notify_admin_live();
create trigger admin_social_account_posts_live_update after insert or update or delete on public.social_account_posts
  for each statement execute function public.notify_admin_live();
