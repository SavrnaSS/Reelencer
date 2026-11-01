-- Bulk email from the admin Workers directory: Terms reminders, gig promotions and announcements to filtered users.
-- email_broadcasts keeps each send (what was sent, to whom, and how it went) for the team's history; the sender
-- sends it in chunks and records each chunk once, so a retried chunk never double counts.
-- email_unsubscribes holds addresses that opted out of promotional email (one-click unsubscribe links).

create table if not exists public.email_unsubscribes (
  email text primary key check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);
alter table public.email_unsubscribes enable row level security;
revoke all on public.email_unsubscribes from anon, authenticated;

create table if not exists public.email_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('terms', 'promotion', 'announcement')),
  subject text not null check (char_length(subject) between 1 and 160),
  content jsonb not null,
  -- [{ workerId, email, name }], in send order.
  recipients jsonb not null default '[]',
  recipient_count integer not null default 0 check (recipient_count >= 0),
  -- [{ workerId, name, reason }]: selected users who weren't sent to, and why.
  skipped jsonb not null default '[]',
  -- { "<offset>": { "sent": n, "failed": n } }: each chunk's result, recorded once.
  chunks jsonb not null default '{}',
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'ready' check (status in ('ready', 'sending', 'sent', 'partial')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.email_broadcasts enable row level security;
revoke all on public.email_broadcasts from anon, authenticated;
create index if not exists email_broadcasts_recent on public.email_broadcasts(created_at desc);

-- Records one chunk's result (first write wins) and recomputes the totals and status.
create or replace function public.record_broadcast_chunk(p_id uuid, p_offset integer, p_sent integer, p_failed integer)
returns public.email_broadcasts
language plpgsql security definer set search_path = '' as $$
declare b public.email_broadcasts%rowtype;
begin
  select * into b from public.email_broadcasts where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not (b.chunks ? p_offset::text) then
    b.chunks := b.chunks || jsonb_build_object(p_offset::text, jsonb_build_object('sent', greatest(p_sent, 0), 'failed', greatest(p_failed, 0)));
  end if;
  select coalesce(sum((value->>'sent')::integer), 0), coalesce(sum((value->>'failed')::integer), 0)
    into b.sent_count, b.failed_count from jsonb_each(b.chunks);
  if b.sent_count + b.failed_count >= b.recipient_count then
    b.status := case when b.failed_count = 0 then 'sent' else 'partial' end;
    b.completed_at := coalesce(b.completed_at, now());
  else
    b.status := 'sending';
  end if;
  update public.email_broadcasts set chunks = b.chunks, sent_count = b.sent_count, failed_count = b.failed_count,
    status = b.status, completed_at = b.completed_at where id = p_id;
  return b;
end $$;

revoke all on function public.record_broadcast_chunk(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_broadcast_chunk(uuid, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
