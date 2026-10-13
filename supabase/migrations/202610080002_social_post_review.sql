-- Creators submit each reel they post on a linked account; the team reviews it (approved reels count towards pay)
-- and records its numbers. Reels the team adds themselves are approved straight away.

alter table public.social_account_posts
  add column if not exists status text not null default 'approved' check (status in ('submitted','approved','rejected')),
  add column if not exists submitted_by_worker boolean not null default false,
  add column if not exists review_note text not null default '' check (char_length(review_note) <= 500),
  add column if not exists reviewed_at timestamptz;

create index if not exists social_account_posts_review on public.social_account_posts(status, created_at) where status = 'submitted';
