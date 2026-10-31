-- Creators see gigs in the order the team sets, not newest first.
-- gigs.feed_position is that order (1 = top of the feed). Existing gigs start in today's order (newest first), new
-- gigs join at the bottom until the team moves them, and reorder_gigs saves a whole new order in one step.

alter table public.gigs add column if not exists feed_position integer;

with ranked as (
  select id, row_number() over (order by created_at desc, id) as pos from public.gigs
)
update public.gigs g set feed_position = r.pos from ranked r where g.id = r.id and g.feed_position is null;

create index if not exists gigs_feed_order on public.gigs(feed_position, created_at desc);

-- New gigs go to the bottom of the feed unless a position is given.
create or replace function public.gigs_default_feed_position() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.feed_position is null then
    perform pg_advisory_xact_lock(hashtext('gigs_feed_position'));
    select coalesce(max(feed_position), 0) + 1 into new.feed_position from public.gigs;
  end if;
  return new;
end $$;

drop trigger if exists gigs_default_feed_position on public.gigs;
create trigger gigs_default_feed_position before insert on public.gigs
  for each row execute function public.gigs_default_feed_position();

-- Save the team's order: listed gigs take positions 1..n in the given order; any gig left out (e.g. one created
-- while the team was reordering) keeps its relative place after them. Unknown ids are ignored.
create or replace function public.reorder_gigs(p_ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 1000
    or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) as u(id)) then
    raise exception 'invalid_gig_order' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('gigs_feed_position'));
  with wanted as (
    select u.id, u.ord from unnest(p_ids) with ordinality as u(id, ord)
  ), ordered as (
    select g.id, row_number() over (order by w.ord nulls last, g.feed_position nulls last, g.created_at desc, g.id) as pos
    from public.gigs g left join wanted w on w.id = g.id
  )
  update public.gigs g set feed_position = o.pos
  from ordered o where g.id = o.id and g.feed_position is distinct from o.pos;
  get diagnostics changed = row_count;
  return changed;
end $$;

revoke all on function public.reorder_gigs(text[]) from public, anon, authenticated;
grant execute on function public.reorder_gigs(text[]) to service_role;

notify pgrst, 'reload schema';
