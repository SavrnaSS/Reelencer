-- Switching on monthly auto-withdrawal failed with "Invalid field value" on databases created before this schema:
-- upi_configs.payout_day (and payout_schedule) could still carry legacy rules that only accept weekday names,
-- either as an enum type or as CHECK constraints, so saving the monthly day ("1"–"28") was rejected.
-- Normalise both columns to text and replace any legacy rule on them with one that accepts both schedules.

do $$
declare col record; con record; old_default text;
begin
  -- 1. Text columns (an old enum type would reject "1").
  for col in
    select a.attname, t.typtype, pg_get_expr(d.adbin, d.adrelid) as default_expr
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.upi_configs'::regclass and a.attname in ('payout_day', 'payout_schedule') and not a.attisdropped
      and t.typname <> 'text'
  loop
    -- Drop rules on the column first: they may compare against the old type.
    for con in
      select c.conname from pg_constraint c
      where c.conrelid = 'public.upi_configs'::regclass and c.contype = 'c' and (
        select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = col.attname) = any(c.conkey)
    loop
      execute format('alter table public.upi_configs drop constraint %I', con.conname);
    end loop;
    execute format('alter table public.upi_configs alter column %I drop default', col.attname);
    execute format('alter table public.upi_configs alter column %I type text using %I::text', col.attname, col.attname);
  end loop;

  -- 2. Replace every remaining legacy rule that mentions either column.
  for con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.upi_configs'::regclass and c.contype = 'c'
      and c.conname <> 'upi_configs_payout_schedule_day_check'
      and pg_get_constraintdef(c.oid) ~ '(payout_day|payout_schedule)'
  loop
    execute format('alter table public.upi_configs drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.upi_configs alter column payout_schedule set default 'Weekly';
alter table public.upi_configs alter column payout_day set default 'Fri';

-- Correct any value outside the rule first, so every later update (e.g. the team verifying the payout method) keeps
-- passing it: "friday" becomes "Fri"; anything unusable falls back to the default weekly Friday. The submission
-- timestamp trigger is paused so the team's verification queue keeps its order.
alter table public.upi_configs disable trigger upi_submission_timestamp;
update public.upi_configs set payout_schedule = 'Weekly'
  where payout_schedule is distinct from 'Monthly' and payout_schedule is distinct from 'Weekly' and lower(btrim(coalesce(payout_schedule, ''))) = 'weekly';
update public.upi_configs set payout_schedule = 'Monthly'
  where payout_schedule is distinct from 'Monthly' and lower(btrim(coalesce(payout_schedule, ''))) = 'monthly';
update public.upi_configs set payout_day = initcap(left(btrim(payout_day), 3))
  where payout_schedule = 'Weekly' and payout_day not in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')
    and initcap(left(btrim(coalesce(payout_day, '')), 3)) in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun');
update public.upi_configs set payout_day = ltrim(btrim(payout_day), '0')
  where payout_schedule = 'Monthly' and btrim(coalesce(payout_day, '')) ~ '^0*(?:[1-9]|1[0-9]|2[0-8])$' and payout_day <> ltrim(btrim(payout_day), '0');
update public.upi_configs set payout_schedule = 'Weekly', payout_day = 'Fri'
  where not ((payout_schedule = 'Weekly' and payout_day in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun'))
    or (payout_schedule = 'Monthly' and payout_day ~ '^(?:[1-9]|1[0-9]|2[0-8])$'));
alter table public.upi_configs enable trigger upi_submission_timestamp;

-- A weekday for weekly schedules, the 1st–28th for monthly ones (auto-withdrawal uses the monthly day).
alter table public.upi_configs drop constraint if exists upi_configs_payout_schedule_day_check;
alter table public.upi_configs add constraint upi_configs_payout_schedule_day_check check (
  (payout_schedule = 'Weekly' and payout_day in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun'))
  or (payout_schedule = 'Monthly' and payout_day ~ '^(?:[1-9]|1[0-9]|2[0-8])$')
);

notify pgrst, 'reload schema';
