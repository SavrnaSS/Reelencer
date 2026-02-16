-- Work email creator schema
-- Run this in Supabase SQL Editor.

create table if not exists public.work_email_secret_codes (
  id uuid primary key default gen_random_uuid(),
  label text null,
  code_hash text not null unique,
  code_hint text not null,
  status text not null default 'active',
  created_by uuid null,
  use_count integer not null default 0,
  max_uses integer null,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  blocked_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint work_email_secret_codes_status_chk check (status in ('active', 'blocked'))
);

create index if not exists idx_work_email_secret_codes_status on public.work_email_secret_codes (status);
create index if not exists idx_work_email_secret_codes_expires_at on public.work_email_secret_codes (expires_at);

create table if not exists public.work_email_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  secret_code_id uuid null references public.work_email_secret_codes(id) on delete set null,
  email text not null unique,
  local_part text not null,
  domain text not null,
  username text not null,
  social_password text null,
  platform text not null default 'General',
  notes text null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_email_accounts_status_chk check (status in ('active', 'blocked', 'deleted'))
);

create index if not exists idx_work_email_accounts_owner on public.work_email_accounts (owner_user_id, created_at desc);
create index if not exists idx_work_email_accounts_code on public.work_email_accounts (secret_code_id);
create index if not exists idx_work_email_accounts_email_lower on public.work_email_accounts (lower(email));

alter table public.work_email_accounts
  add column if not exists social_password text null;

create table if not exists public.work_email_inbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.work_email_accounts(id) on delete cascade,
  to_email text not null,
  from_email text null,
  subject text not null default '',
  body text not null default '',
  otp_code text null,
  message_id text not null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (account_id, message_id)
);

create index if not exists idx_work_email_inbox_account_created on public.work_email_inbox (account_id, created_at desc);
create index if not exists idx_work_email_inbox_account_read on public.work_email_inbox (account_id, read_at);
