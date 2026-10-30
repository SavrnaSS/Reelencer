-- Automatic sync never lowers a reel's numbers. Public Instagram pages round counts ("1.2K") and can lag behind,
-- and the team may enter exact numbers from Insights; a sync reading only replaces a count when it is at least as
-- high. Applied atomically, so a manual edit saved while a sync is running is never overwritten with older data.
-- Unchanged readings write nothing, so creators and admins are only pinged when a number actually moves.

create or replace function public.apply_synced_post_metrics(
  p_post uuid, p_views integer, p_likes integer, p_comments integer,
  p_source text, p_at timestamptz, p_posted_at timestamptz default null, p_caption text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur public.social_account_posts%rowtype;
  take_views boolean;
  next_likes integer;
  next_comments integer;
  next_posted timestamptz;
  next_caption text;
begin
  if p_source not in ('api', 'profile') then raise exception 'invalid_input'; end if;
  if coalesce(p_views, 0) < 0 or coalesce(p_likes, 0) < 0 or coalesce(p_comments, 0) < 0 then raise exception 'invalid_input'; end if;
  select * into cur from public.social_account_posts where id = p_post for update;
  if not found or cur.removed_at is not null then return null; end if;
  take_views := p_views is not null and (cur.views is null or p_views >= cur.views);
  next_likes := case when p_likes is not null and (cur.likes is null or p_likes > cur.likes) then p_likes else cur.likes end;
  next_comments := case when p_comments is not null and (cur.comments is null or p_comments > cur.comments) then p_comments else cur.comments end;
  next_posted := coalesce(cur.posted_at, p_posted_at);
  next_caption := case when coalesce(cur.caption, '') = '' and nullif(btrim(coalesce(p_caption, '')), '') is not null then left(btrim(p_caption), 300) else cur.caption end;
  if not take_views and next_likes is not distinct from cur.likes and next_comments is not distinct from cur.comments
     and next_posted is not distinct from cur.posted_at and next_caption is not distinct from cur.caption then
    return jsonb_build_object('views', cur.views, 'changed', false);
  end if;
  update public.social_account_posts set
    views = case when take_views then p_views else views end,
    views_captured_at = case when take_views then p_at else views_captured_at end,
    views_source = case when take_views then p_source else views_source end,
    likes = next_likes, comments = next_comments, posted_at = next_posted, caption = next_caption,
    updated_at = p_at
  where id = p_post;
  return jsonb_build_object('views', case when take_views then p_views else cur.views end, 'changed', true);
end; $$;

revoke all on function public.apply_synced_post_metrics(uuid, integer, integer, integer, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.apply_synced_post_metrics(uuid, integer, integer, integer, text, timestamptz, timestamptz, text) to service_role;

notify pgrst, 'reload schema';
