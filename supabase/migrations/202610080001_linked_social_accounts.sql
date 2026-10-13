-- Content Posting: once screening verifies the account a creator made for a gig, it is linked to their Reelencer
-- profile. The team records the account's insights (followers, reach, per-reel results) as dated snapshots, and the
-- creator's dashboard charts them. Login details stay on the application (encrypted); nothing secret lives here.

create table if not exists public.linked_social_accounts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.gig_applications(id) on delete cascade,
  gig_id text not null references public.gigs(id),
  worker_code text not null,
  platform text not null check (char_length(btrim(platform)) between 1 and 40),
  handle text not null check (char_length(btrim(handle)) between 1 and 120),
  profile_url text not null default '' check (char_length(profile_url) <= 300),
  status text not null default 'active' check (status in ('active','paused','unlinked')),
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index if not exists linked_social_accounts_worker on public.linked_social_accounts(worker_code, linked_at desc);

-- One row per check-in. Counters are totals at capture time; reach/impressions/etc. cover `period_days` before it.
create table if not exists public.social_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linked_social_accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  period_days integer not null default 7 check (period_days between 1 and 90),
  followers integer check (followers >= 0),
  following integer check (following >= 0),
  posts integer check (posts >= 0),
  reach integer check (reach >= 0),
  impressions integer check (impressions >= 0),
  profile_views integer check (profile_views >= 0),
  engagements integer check (engagements >= 0),
  link_clicks integer check (link_clicks >= 0),
  source text not null default 'manual' check (source in ('manual','api')),
  note text not null default '' check (char_length(note) <= 500),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists social_account_snapshots_account on public.social_account_snapshots(account_id, captured_at desc);

create table if not exists public.social_account_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linked_social_accounts(id) on delete cascade,
  url text not null check (char_length(url) between 8 and 500 and url ~* '^https://'),
  caption text not null default '' check (char_length(caption) <= 300),
  posted_at timestamptz,
  views integer check (views >= 0),
  reach integer check (reach >= 0),
  likes integer check (likes >= 0),
  comments integer check (comments >= 0),
  shares integer check (shares >= 0),
  saves integer check (saves >= 0),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, url)
);
create index if not exists social_account_posts_account on public.social_account_posts(account_id, posted_at desc nulls last);

-- Same posture as other sensitive tables: server-only through the service role.
do $$
declare t text;
begin
  foreach t in array array['linked_social_accounts','social_account_snapshots','social_account_posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon,authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
