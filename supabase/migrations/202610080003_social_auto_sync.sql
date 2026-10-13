-- Automatic stats sync for linked accounts (YouTube Data API, Instagram Graph API business discovery).
-- Sync state lives on the account; lifetime totals are kept on API snapshots so period figures (views gained since
-- the last sync) can be derived; reels found on the account by the sync are marked as such.

alter table public.linked_social_accounts
  add column if not exists sync_status text not null default 'pending' check (sync_status in ('pending','ok','error','unsupported','not_configured')),
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_error text not null default '' check (char_length(sync_error) <= 300),
  add column if not exists external_id text not null default '' check (char_length(external_id) <= 120);

alter table public.social_account_snapshots
  add column if not exists total_views bigint check (total_views >= 0);

alter table public.social_account_posts
  add column if not exists source text not null default 'manual' check (source in ('manual','api')),
  add column if not exists external_id text not null default '' check (char_length(external_id) <= 120);

create index if not exists linked_social_accounts_sync on public.linked_social_accounts(last_synced_at nulls first) where status = 'active';
