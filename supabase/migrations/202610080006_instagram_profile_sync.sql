-- Preserve provenance: public page extraction is distinct from API and screenshot data.
alter table public.social_account_snapshots drop constraint if exists social_account_snapshots_source_check;
alter table public.social_account_snapshots add constraint social_account_snapshots_source_check check (source in ('manual','api','screenshot','profile'));
alter table public.social_account_posts drop constraint if exists social_account_posts_source_check;
alter table public.social_account_posts add constraint social_account_posts_source_check check (source in ('manual','api','screenshot','profile'));
