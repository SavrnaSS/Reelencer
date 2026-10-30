-- A view count the team enters by hand is authoritative: it's pinned, and automatic sync no longer changes it
-- (higher or lower) until the team resumes live tracking. Sync keeps recording Instagram's latest public count
-- beside it (synced_views), so the team can compare the two and switch back to the live number in one step.

alter table public.social_account_posts
  add column if not exists views_pinned boolean not null default false,
  add column if not exists synced_views integer check (synced_views is null or synced_views >= 0),
  add column if not exists synced_views_at timestamptz;

-- Sync: pinned views are left alone; the public reading is still recorded when it changes.
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
begin
  if p_source not in ('api', 'profile') then raise exception 'invalid_input'; end if;
  if coalesce(p_views, 0) < 0 or coalesce(p_likes, 0) < 0 or coalesce(p_comments, 0) < 0 then raise exception 'invalid_input'; end if;
  select * into cur from public.social_account_posts where id = p_post for update;
  if not found or cur.removed_at is not null then return null; end if;
  take_views := p_views is not null and not cur.views_pinned and (cur.views is null or p_views >= cur.views);
  record_public := p_views is not null and p_views is distinct from cur.synced_views;
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
    synced_views = case when p_views is not null then p_views else synced_views end,
    synced_views_at = case when record_public then p_at else synced_views_at end,
    likes = next_likes, comments = next_comments, posted_at = next_posted, caption = next_caption,
    updated_at = p_at
  where id = p_post;
  return jsonb_build_object('views', case when take_views then p_views else cur.views end, 'changed', true, 'pinned', cur.views_pinned);
end; $$;

-- Admin save (unchanged from 202610300001 apart from views_pinned): 'views_pinned' in the input sets the pin;
-- leaving it out keeps the reel's current pin.
create or replace function public.save_social_post_with_wallet(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; current_post public.social_account_posts%rowtype; result public.social_account_posts%rowtype;
 metric text; value jsonb; desired_status text; review_at timestamptz; posting timestamptz; input_url text; pinned boolean;
begin
 if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid_input'; end if;
 v_account_id:=(p_input->>'account_id')::uuid;
 input_url:=btrim(coalesce(p_input->>'url',''));
 if v_account_id is null or char_length(input_url) not between 8 and 500 or input_url !~* '^https://' then raise exception 'invalid_input'; end if;
 if char_length(coalesce(p_input->>'caption',''))>300 then raise exception 'invalid_input'; end if;
 foreach metric in array array['views','reach','likes','comments','shares','saves'] loop
  value:=p_input->metric;
  if value is not null and value<>'null'::jsonb and
    (jsonb_typeof(value)<>'number' or (value#>>'{}') !~ '^[0-9]+$' or (value#>>'{}')::numeric>2000000000) then raise exception 'invalid_input'; end if;
 end loop;
 if p_input ? 'status' and coalesce(p_input->>'status','') not in ('approved','rejected') then raise exception 'invalid_input'; end if;
 if nullif(p_input->>'views_source','') is not null and p_input->>'views_source' not in ('manual','api','profile','screenshot') then raise exception 'invalid_input'; end if;
 if p_input ? 'views_pinned' and jsonb_typeof(p_input->'views_pinned')<>'boolean' then raise exception 'invalid_input'; end if;
 perform public.lock_social_reel_wallet_owner(v_account_id);
 select * into current_post from public.social_account_posts where account_id=v_account_id and url=input_url for update;
 if current_post.removed_at is not null then raise exception 'reel_removed'; end if;
 posting:=nullif(p_input->>'posted_at','')::timestamptz;
 if posting is not null and posting<public.reel_tracking_start((select linked_at from public.linked_social_accounts where id=v_account_id)) then raise exception 'reel_before_link'; end if;
 desired_status:=coalesce(p_input->>'status',current_post.status,'submitted');
 review_at:=case when p_input ? 'status' then greatest(clock_timestamp(),coalesce(current_post.reviewed_at,'-infinity'::timestamptz)+interval '1 microsecond') else current_post.reviewed_at end;
 -- A pin needs a number to hold.
 pinned:=coalesce((p_input->>'views_pinned')::boolean,current_post.views_pinned,false) and p_input->>'views' is not null;
 insert into public.social_account_posts(account_id,url,caption,posted_at,views,views_captured_at,views_source,views_pinned,reach,likes,comments,shares,saves,status,reviewed_at,updated_by,updated_at)
 values(v_account_id,input_url,btrim(coalesce(p_input->>'caption','')),posting,(p_input->>'views')::integer,
  case when p_input->>'views' is not null then coalesce(nullif(p_input->>'views_captured_at','')::timestamptz,clock_timestamp()) else null end,
  case when p_input->>'views' is not null then coalesce(nullif(p_input->>'views_source',''),'manual') else null end,
  pinned,
  (p_input->>'reach')::integer,(p_input->>'likes')::integer,(p_input->>'comments')::integer,(p_input->>'shares')::integer,(p_input->>'saves')::integer,
  desired_status,review_at,p_actor,clock_timestamp())
 on conflict(account_id,url) do update set caption=excluded.caption,posted_at=excluded.posted_at,views=excluded.views,
  views_captured_at=excluded.views_captured_at,views_source=excluded.views_source,views_pinned=excluded.views_pinned,reach=excluded.reach,likes=excluded.likes,comments=excluded.comments,
  shares=excluded.shares,saves=excluded.saves,status=excluded.status,reviewed_at=excluded.reviewed_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at
 returning * into result;
 return jsonb_build_object('post',to_jsonb(result));
end; $$;

-- "Resume live tracking": unpin and take Instagram's latest public count when one has been read.
create or replace function public.resume_social_post_live_views(p_actor uuid, p_post uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.social_account_posts%rowtype; result public.social_account_posts%rowtype;
begin
  if p_actor is null or not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select * into cur from public.social_account_posts where id = p_post for update;
  if not found then raise exception 'not_found'; end if;
  if cur.removed_at is not null then raise exception 'reel_removed'; end if;
  update public.social_account_posts set
    views_pinned = false,
    views = coalesce(cur.synced_views, cur.views),
    views_captured_at = case when cur.synced_views is not null then coalesce(cur.synced_views_at, clock_timestamp()) else cur.views_captured_at end,
    views_source = case when cur.synced_views is not null then 'profile' else cur.views_source end,
    updated_by = p_actor, updated_at = clock_timestamp()
  where id = p_post
  returning * into result;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (p_actor, 'social_post_views_resumed', p_post::text, jsonb_build_object('pinnedViews', cur.views, 'liveViews', cur.synced_views));
  return jsonb_build_object('post', to_jsonb(result));
end; $$;

revoke all on function public.apply_synced_post_metrics(uuid, integer, integer, integer, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.save_social_post_with_wallet(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.resume_social_post_live_views(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_synced_post_metrics(uuid, integer, integer, integer, text, timestamptz, timestamptz, text) to service_role;
grant execute on function public.save_social_post_with_wallet(uuid, jsonb) to service_role;
grant execute on function public.resume_social_post_live_views(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
