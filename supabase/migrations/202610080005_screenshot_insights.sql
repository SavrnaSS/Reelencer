-- Insights read from screenshots (profile, Professional dashboard, reel insights) by the AI screenshot reader are a
-- third data source next to manual check-ins and API syncs.

alter table public.social_account_snapshots drop constraint if exists social_account_snapshots_source_check;
alter table public.social_account_snapshots add constraint social_account_snapshots_source_check check (source in ('manual','api','screenshot'));

alter table public.social_account_posts drop constraint if exists social_account_posts_source_check;
alter table public.social_account_posts add constraint social_account_posts_source_check check (source in ('manual','api','screenshot'));
