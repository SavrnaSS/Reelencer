-- Addresses the mailer must not send to, fed by Resend's webhook (app/api/webhooks/resend): permanent bounces and
-- spam complaints. Protects the business sending domain's reputation. Service role only: RLS on, no policies.
create table if not exists public.email_suppressions (
  email text primary key check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  reason text not null check (reason in ('bounced', 'complained', 'manual')),
  detail text not null default '' check (char_length(detail) <= 300),
  source_email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;
