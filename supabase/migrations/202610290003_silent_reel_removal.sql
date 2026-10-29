-- Silent removal: the team can remove a reel without the creator getting any sign of it. The app sends no email
-- and answers a resubmitted link like an ordinary duplicate; here the creator's live-update ping is skipped, so the
-- reel isn't seen vanishing from an open dashboard. Changes to a reel that's already removed never ping either,
-- since creators can't see removed reels.

alter table public.social_account_posts
 add column if not exists removal_silent boolean not null default false;

-- Split the creator ping so updates can be filtered (a WHEN clause can't use NEW/OLD on insert-or-delete triggers).
drop trigger if exists creator_social_post_live_update on public.social_account_posts;
drop trigger if exists creator_social_post_live_change on public.social_account_posts;
drop trigger if exists creator_social_post_live_edit on public.social_account_posts;
create trigger creator_social_post_live_change
  after insert or delete on public.social_account_posts
  for each row execute function public.notify_creator_social_updates();
create trigger creator_social_post_live_edit
  after update on public.social_account_posts
  for each row when (new.removed_at is null or (old.removed_at is null and not new.removal_silent))
  execute function public.notify_creator_social_updates();

notify pgrst, 'reload schema';
