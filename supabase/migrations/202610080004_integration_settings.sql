-- Third-party integration credentials set from the admin console (e.g. the YouTube / Instagram auto-sync keys),
-- so connecting them doesn't need a server restart. Values are encrypted by the app (lib/secretCrypto) before they
-- reach the database; environment variables still take precedence when set.

create table if not exists public.integration_settings (
  key text primary key check (key ~ '^[a-z0-9_.]{3,60}$'),
  value_enc text not null check (char_length(value_enc) <= 8000),
  hint text not null default '' check (char_length(hint) <= 40),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from anon, authenticated;
grant all on public.integration_settings to service_role;
