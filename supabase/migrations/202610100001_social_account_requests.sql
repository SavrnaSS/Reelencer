-- Additional accounts: a creator already linked on a Content Posting gig can ask to link more accounts on that gig
-- (each one earns at the gig's rate). Every request is verified by the team before it is linked. Automated checks
-- (ownership code in the bio, duplicate handle/email, public profile read) are stored with the request for review.

create table if not exists public.social_account_requests (
  id uuid primary key default gen_random_uuid(),
  -- The creator's existing linked account on the gig; the new account inherits its application and gig.
  source_account_id uuid not null references public.linked_social_accounts(id) on delete cascade,
  application_id uuid not null references public.gig_applications(id) on delete cascade,
  gig_id text not null references public.gigs(id),
  worker_code text not null,
  platform text not null check (char_length(btrim(platform)) between 1 and 40),
  handle text not null check (char_length(btrim(handle)) between 1 and 120),
  -- Lower-cased handle for duplicate checks across creators.
  handle_key text not null check (char_length(handle_key) between 1 and 120),
  profile_url text not null check (char_length(profile_url) between 8 and 300),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null default '' check (char_length(phone) <= 30),
  password_enc text,
  notes text not null default '' check (char_length(notes) <= 600),
  -- Shown to the creator to place in the account's bio; proves they control the account.
  verify_code text not null check (verify_code ~ '^RL-[A-Z0-9]{6}$'),
  status text not null default 'pending' check (status in ('pending','changes_requested','approved','rejected','withdrawn')),
  revision integer not null default 1 check (revision between 1 and 50),
  checks jsonb not null default '[]'::jsonb,
  risk text not null default 'unknown' check (risk in ('low','medium','high','unknown')),
  checked_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  linked_account_id uuid references public.linked_social_accounts(id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_account_requests_worker on public.social_account_requests(worker_code, created_at desc);
create index if not exists social_account_requests_queue on public.social_account_requests(status, submitted_at) where status in ('pending','changes_requested');
-- One open request per account handle, across every creator.
create unique index if not exists social_account_requests_open_handle
  on public.social_account_requests(lower(platform), handle_key) where status in ('pending','changes_requested');

-- Several accounts per application: the primary (screened) account keeps request_key '' and each approved request
-- adds a row keyed by its request id.
alter table public.linked_social_accounts add column if not exists request_key text not null default '';
alter table public.linked_social_accounts drop constraint if exists linked_social_accounts_application_id_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'linked_social_accounts_application_request_key') then
    alter table public.linked_social_accounts add constraint linked_social_accounts_application_request_key unique (application_id, request_key);
  end if;
end $$;
create index if not exists linked_social_accounts_handle on public.linked_social_accounts(lower(platform), lower(handle));

alter table public.social_account_requests enable row level security;
revoke all on public.social_account_requests from anon, authenticated;
grant all on public.social_account_requests to service_role;

-- Live updates for the creator's request list, on the same private broadcast topic as their accounts.
create or replace function public.notify_creator_account_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  codes text[] := array[]::text[];
  recipient uuid;
begin
  if TG_OP <> 'INSERT' then codes := array_append(codes, OLD.worker_code); end if;
  if TG_OP <> 'DELETE' then codes := array_append(codes, NEW.worker_code); end if;
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
      raise warning 'Account request notification unavailable (%); polling will catch up.', SQLSTATE;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.notify_creator_account_requests() from public, anon, authenticated;

drop trigger if exists creator_account_request_live_update on public.social_account_requests;
create trigger creator_account_request_live_update
  after insert or update or delete on public.social_account_requests
  for each row execute function public.notify_creator_account_requests();
