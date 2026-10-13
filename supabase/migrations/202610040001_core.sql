-- Canonical schema for a new Supabase project. Run all migrations in order.
-- Existing projects must pass scripts/check-backend.mjs and the migration tests first.
create sequence if not exists public.worker_code_sequence start 1001;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'Worker' check (role in ('Admin','Worker')),
  worker_code text not null unique default ('WKR-' || nextval('public.worker_code_sequence')),
  display_name text, email text, active boolean not null default true,
  timezone text not null default 'Asia/Kolkata', created_at timestamptz not null default now()
);
create table if not exists public.workers (
  id text primary key, user_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null, email text, active boolean not null default true,
  timezone text not null default 'Asia/Kolkata', created_at timestamptz not null default now()
);
create table if not exists public.accounts (
  id text primary key, handle text not null, niche text not null default '',
  owner_team text not null default '', policy_tier text not null default 'Standard',
  health text not null default 'Healthy', rules jsonb not null default '[]',
  allowed_audios jsonb not null default '[]', required_hashtags jsonb not null default '[]',
  schedule jsonb, schedule_morning text, schedule_evening text, deadline_minutes integer,
  schedule_days integer[], schedule_timezone text, timezone text,
  created_at timestamptz not null default now()
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.profiles(id),
  account_id text not null references public.accounts(id), schedule jsonb,
  assigned_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique(worker_id,account_id)
);
create table if not exists public.worker_account_assignments (
  id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.profiles(id),
  account_id text not null references public.accounts(id), schedule jsonb,
  assigned_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique(worker_id,account_id)
);
create table if not exists public.worker_accounts (
  worker_id uuid not null references public.profiles(id), account_id text not null references public.accounts(id),
  primary key(worker_id,account_id)
);
create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(), public_id text not null unique,
  worker_id uuid not null references public.profiles(id), account_id text references public.accounts(id),
  title text not null, type text not null default 'Reel posting', created_by text,
  created_at timestamptz not null default now(), due_at timestamptz,
  started_at timestamptz, completed_at timestamptz,
  status text not null default 'Open' check(status in ('Open','In progress','Submitted','Needs fix','Approved','Hard rejected')),
  priority text not null default 'P1', reward_inr numeric(12,2) not null default 0 check(reward_inr >= 0),
  est_minutes integer not null default 10 check(est_minutes > 0), sla_minutes integer not null default 180 check(sla_minutes > 0),
  gates jsonb not null default '{}', submission jsonb, review jsonb, audit jsonb not null default '[]'
);
create index if not exists work_items_worker_status_due on public.work_items(worker_id,status,due_at);
create table if not exists public.work_item_audit (
  id uuid primary key default gen_random_uuid(), work_item_id uuid references public.work_items(id),
  actor_id uuid references auth.users(id), action text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.gigs (
  id text primary key default gen_random_uuid()::text, title text not null, company text not null,
  verified boolean not null default false, platform text, location text, workload text not null,
  payout text not null, payout_type text, gig_type text not null default 'Email Creator',
  application_mode text, requirements jsonb not null default '[]', status text not null default 'Open',
  posted_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.gig_applications (
  id uuid primary key default gen_random_uuid(), gig_id text not null references public.gigs(id),
  worker_code text not null, worker_name text, status text not null default 'Pending',
  applied_at timestamptz not null default now(), decided_at timestamptz,
  unique(gig_id,worker_code)
);
create table if not exists public.gig_assignments (
  id uuid primary key default gen_random_uuid(), gig_id text not null references public.gigs(id),
  worker_code text not null, assigned_email text not null unique, assigned_emails jsonb not null default '[]',
  subject_filter text, status text not null default 'Assigned',
  created_at timestamptz not null default now(), submitted_at timestamptz, decided_at timestamptz,
  unique(gig_id,worker_code)
);
create index if not exists gig_assignments_worker on public.gig_assignments(worker_code,created_at desc);
create index if not exists gig_applications_worker on public.gig_applications(worker_code,applied_at desc);
create table if not exists public.gig_account_credentials (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.gig_assignments(id) on delete cascade,
  handle text not null, email text not null, password text not null, phone text,
  created_at timestamptz not null default now(), unique(assignment_id,email)
);
create table if not exists public.gig_inbox (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.gig_assignments(id) on delete cascade,
  to_email text not null, subject text not null default '', body text not null default '', otp_code text,
  message_id text not null, read_at timestamptz, created_at timestamptz not null default now(),
  unique(assignment_id,message_id)
);
create index if not exists gig_inbox_recent on public.gig_inbox(assignment_id,created_at desc);
create table if not exists public.worker_kyc (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id),
  worker_id text, status text not null default 'pending' check(status in ('pending','approved','rejected')),
  legal_name text not null, dob date not null, phone text not null, address text not null,
  id_type text not null, id_number text not null, id_doc_path text not null, selfie_path text not null,
  submitted_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id), rejection_reason text, admin_note text
);
create table if not exists public.worker_kyc_events (
  id uuid primary key default gen_random_uuid(), kyc_id uuid not null references public.worker_kyc(id),
  status text not null, note text, actor_id uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.upi_configs (
  worker_id uuid primary key references public.profiles(id), upi_id text not null,
  verified boolean not null default false, verified_at timestamptz, verified_by uuid references auth.users(id),
  payout_schedule text not null default 'Weekly', payout_day text not null default 'Fri'
);
create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.profiles(id),
  cycle_label text not null, period_start date not null, period_end date not null,
  status text not null default 'Draft' check(status in ('Draft','Processing','Paid','Failed')),
  method text not null default 'UPI', notes jsonb not null default '[]',
  upi_id_snapshot text, payment_reference text, processed_by uuid references auth.users(id),
  created_at timestamptz not null default now(), processed_at timestamptz, paid_at timestamptz
);
create table if not exists public.payout_items (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.payout_batches(id),
  work_item_id uuid not null references public.work_items(id), worker_id uuid not null references public.profiles(id),
  handle text not null default '', amount_inr numeric(12,2) not null check(amount_inr > 0),
  status text not null default 'Included' check(status in ('Included','Paid','Failed')), reason text,
  unique(batch_id,work_item_id)
);
-- Constraints also protect against competing server instances, retries, and direct service writes.
create unique index if not exists one_active_payout_per_worker on public.payout_batches(worker_id) where status in ('Draft','Processing');
create unique index if not exists one_live_payout_per_item on public.payout_items(work_item_id) where status <> 'Failed';
create index if not exists payout_items_batch on public.payout_items(batch_id);
create table if not exists public.api_rate_limits (
  key text primary key, count integer not null, expires_at timestamptz not null
);
create index if not exists api_rate_limits_expiry on public.api_rate_limits(expires_at);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
  action text not null, resource_id text, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- Additive changes for installations created before this migration set.
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.workers add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.gigs add column if not exists application_mode text;
alter table public.gig_assignments add column if not exists assigned_emails jsonb not null default '[]';
alter table public.gig_assignments add column if not exists subject_filter text;
alter table public.payout_batches add column if not exists upi_id_snapshot text;
alter table public.payout_batches add column if not exists payment_reference text;
alter table public.payout_batches add column if not exists processed_by uuid references auth.users(id);
alter table public.upi_configs add column if not exists verified_by uuid references auth.users(id);
create unique index if not exists payout_payment_reference_unique on public.payout_batches(payment_reference) where payment_reference is not null;
