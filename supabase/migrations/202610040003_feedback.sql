-- Dashboard feedback schema
-- Run this in Supabase SQL Editor.

create table if not exists public.dashboard_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  worker_id text null,
  profile_name text null,
  profile_role text null,
  section text not null,
  language_code text not null,
  language_name text null,
  category text not null,
  rating smallint null,
  subject text not null default '',
  message text not null,
  allow_contact boolean not null default true,
  status text not null default 'new',
  admin_note text null,
  source text not null default 'dashboard',
  page_url text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_feedback_status_chk check (status in ('new', 'reviewing', 'resolved', 'closed')),
  constraint dashboard_feedback_rating_chk check (rating is null or rating between 1 and 5)
);

create index if not exists idx_dashboard_feedback_status_created on public.dashboard_feedback (status, created_at desc);
create index if not exists idx_dashboard_feedback_worker_created on public.dashboard_feedback (worker_id, created_at desc);
create index if not exists idx_dashboard_feedback_user_created on public.dashboard_feedback (user_id, created_at desc);
create index if not exists idx_dashboard_feedback_category on public.dashboard_feedback (category);

create or replace function public.set_dashboard_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_dashboard_feedback_updated_at on public.dashboard_feedback;

create trigger trg_dashboard_feedback_updated_at
before update on public.dashboard_feedback
for each row
execute function public.set_dashboard_feedback_updated_at();
