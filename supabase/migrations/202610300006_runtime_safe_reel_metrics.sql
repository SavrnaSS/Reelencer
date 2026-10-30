-- Old application processes may still write metrics directly instead of using
-- apply_synced_post_metrics. Enforce the public high-water mark at the row itself.
create function public.guard_social_post_public_views() returns trigger
language plpgsql set search_path='' as $$
declare requested integer:=NEW.views; requested_at timestamptz:=NEW.views_captured_at; floor_views integer;
begin
  -- Only the authenticated, service-only resume RPC below sets this post-scoped override.
  if current_setting('reelencer.reel_view_override',true)=NEW.id::text then return NEW; end if;

  if OLD.synced_views is not null and (NEW.synced_views is null or NEW.synced_views<OLD.synced_views) then
    NEW.synced_views:=OLD.synced_views;
    NEW.synced_views_at:=OLD.synced_views_at;
  end if;
  if NEW.views_source in ('api','profile') then
    -- Capture valid direct-writer readings too, without replacing a higher known public count.
    if requested is not null and (NEW.synced_views is null or requested>NEW.synced_views) then
      NEW.synced_views:=requested;
      NEW.synced_views_at:=requested_at;
    end if;
    if OLD.views_pinned then
      NEW.views:=OLD.views;
      NEW.views_captured_at:=OLD.views_captured_at;
      NEW.views_source:=OLD.views_source;
      NEW.views_pinned:=true;
    else
      floor_views:=greatest(OLD.views,NEW.synced_views);
      if floor_views is not null and (requested is null or requested<floor_views) then
        NEW.views:=floor_views;
        if floor_views is not distinct from OLD.views then
          NEW.views_captured_at:=OLD.views_captured_at;
          NEW.views_source:=OLD.views_source;
        else
          NEW.views_captured_at:=NEW.synced_views_at;
        end if;
      elsif requested is not distinct from OLD.views and OLD.views_captured_at>NEW.views_captured_at then
        NEW.views_captured_at:=OLD.views_captured_at;
      end if;
    end if;
  end if;
  return NEW;
end; $$;
revoke all on function public.guard_social_post_public_views() from public,anon,authenticated;
create trigger social_post_public_views_guard
  before update of views,views_source,views_captured_at,views_pinned,synced_views,synced_views_at
  on public.social_account_posts for each row execute function public.guard_social_post_public_views();

-- Return the actual guarded row value, so account snapshots cannot report a stale attempted write.
create or replace function public.apply_synced_post_metrics(
  p_post uuid, p_views integer, p_likes integer, p_comments integer,
  p_source text, p_at timestamptz, p_posted_at timestamptz default null, p_caption text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur public.social_account_posts%rowtype;
  take_views boolean;
  record_public boolean;
  next_likes integer;
  next_comments integer;
  next_posted timestamptz;
  next_caption text;
  effective_views integer;
begin
  if p_source not in ('api', 'profile') then raise exception 'invalid_input'; end if;
  if coalesce(p_views, 0) < 0 or coalesce(p_likes, 0) < 0 or coalesce(p_comments, 0) < 0 then raise exception 'invalid_input'; end if;
  select * into cur from public.social_account_posts where id = p_post for update;
  if not found or cur.removed_at is not null then return null; end if;
  take_views := p_views is not null and not cur.views_pinned and (cur.views is null or p_views >= cur.views);
  record_public := p_views is not null and (cur.synced_views is null or p_views>cur.synced_views);
  next_likes := case when p_likes is not null and (cur.likes is null or p_likes > cur.likes) then p_likes else cur.likes end;
  next_comments := case when p_comments is not null and (cur.comments is null or p_comments > cur.comments) then p_comments else cur.comments end;
  next_posted := coalesce(cur.posted_at, p_posted_at);
  next_caption := case when coalesce(cur.caption, '') = '' and nullif(btrim(coalesce(p_caption, '')), '') is not null then left(btrim(p_caption), 300) else cur.caption end;
  if not take_views and not record_public and next_likes is not distinct from cur.likes and next_comments is not distinct from cur.comments
     and next_posted is not distinct from cur.posted_at and next_caption is not distinct from cur.caption then
    return jsonb_build_object('views', cur.views, 'changed', false, 'pinned', cur.views_pinned);
  end if;
  update public.social_account_posts set
    views = case when take_views then p_views else views end,
    views_captured_at = case when take_views then p_at else views_captured_at end,
    views_source = case when take_views then p_source else views_source end,
    synced_views = greatest(synced_views,p_views),
    synced_views_at = case when record_public then p_at else synced_views_at end,
    likes = next_likes, comments = next_comments, posted_at = next_posted, caption = next_caption,
    updated_at = p_at
  where id = p_post returning views into effective_views;
  return jsonb_build_object('views', effective_views, 'changed', true, 'pinned', cur.views_pinned);
end; $$;
revoke all on function public.apply_synced_post_metrics(uuid,integer,integer,integer,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.apply_synced_post_metrics(uuid,integer,integer,integer,text,timestamptz,timestamptz,text) to service_role;

-- Explicit admin changes remain possible. Resuming a pinned count is a deliberate
-- correction, so authorize only that row for the duration of this RPC's update.
create or replace function public.resume_social_post_live_views(p_actor uuid,p_post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cur public.social_account_posts%rowtype; result public.social_account_posts%rowtype; previous_override text;
begin
  if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select * into cur from public.social_account_posts where id=p_post for update;
  if not found then raise exception 'not_found'; end if;
  if cur.removed_at is not null then raise exception 'reel_removed'; end if;
  previous_override:=current_setting('reelencer.reel_view_override',true);
  begin
    perform set_config('reelencer.reel_view_override',p_post::text,true);
    update public.social_account_posts set
      views_pinned=false,views=coalesce(cur.synced_views,cur.views),
      views_captured_at=case when cur.synced_views is not null then coalesce(cur.synced_views_at,clock_timestamp()) else cur.views_captured_at end,
      views_source=case when cur.synced_views is not null then 'profile' else cur.views_source end,
      updated_by=p_actor,updated_at=clock_timestamp()
    where id=p_post returning * into result;
    perform set_config('reelencer.reel_view_override',coalesce(previous_override,''),true);
  exception when others then
    perform set_config('reelencer.reel_view_override',coalesce(previous_override,''),true);
    raise;
  end;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_actor,'social_post_views_resumed',p_post::text,jsonb_build_object('pinnedViews',cur.views,'liveViews',cur.synced_views));
  return jsonb_build_object('post',to_jsonb(result));
end; $$;
revoke all on function public.resume_social_post_live_views(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resume_social_post_live_views(uuid,uuid) to service_role;

-- Repair only proven automatic regressions; team-set and pinned values stay intact.
-- Changing metrics does not change review state or issue any wallet credit.
update public.social_account_posts set
  views=synced_views,views_captured_at=synced_views_at,updated_at=clock_timestamp()
where not views_pinned and removed_at is null and views_source in ('api','profile')
  and synced_views is not null and (views is null or views<synced_views);

notify pgrst,'reload schema';
