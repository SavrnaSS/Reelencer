-- Server-side automation for gig applications: shared message templates, rules, a per-application
-- ledger that guarantees each application is processed at most once per rule, and a run log.

create table if not exists public.application_message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  admin_explanation text not null default '' check (char_length(admin_explanation) <= 4000),
  whatsapp_link text not null default '' check (char_length(whatsapp_link) <= 500 and (whatsapp_link = '' or whatsapp_link ~* '^https://')),
  onboarding_steps text not null default '' check (char_length(onboarding_steps) <= 4000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.application_automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  conditions jsonb not null default '{}' check (jsonb_typeof(conditions) = 'object'),
  action text not null check (action in ('Accepted','Rejected','Pending','push')),
  -- null template = keep each application's existing recruiter message
  template_id uuid references public.application_message_templates(id) on delete restrict,
  enabled boolean not null default false,
  -- Scheduled runs act as this administrator; runs stop if they lose admin access.
  owner_id uuid not null references auth.users(id),
  max_per_run integer not null default 25 check (max_per_run between 1 and 100),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists application_automation_rules_enabled on public.application_automation_rules(enabled) where enabled;

create table if not exists public.application_automation_handled (
  rule_id uuid not null references public.application_automation_rules(id) on delete cascade,
  application_id uuid not null references public.gig_applications(id) on delete cascade,
  -- baseline: matched when auto-run was switched on, intentionally left alone
  outcome text not null check (outcome in ('claimed','baseline','ok','failed')),
  error text check (char_length(error) <= 500),
  handled_at timestamptz not null default now(),
  primary key (rule_id, application_id)
);

create table if not exists public.application_automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.application_automation_rules(id) on delete set null,
  rule_name text not null,
  trigger text not null check (trigger in ('manual','schedule')),
  action text not null,
  actor_id uuid references auth.users(id),
  matched integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  emails_sent integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists application_automation_runs_recent on public.application_automation_runs(started_at desc);

-- Same posture as other sensitive tables: server-only through the service role.
do $$
declare t text;
begin
  foreach t in array array['application_message_templates','application_automation_rules','application_automation_handled','application_automation_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon,authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
