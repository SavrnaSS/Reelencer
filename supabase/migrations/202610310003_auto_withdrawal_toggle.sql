-- Monthly auto-withdrawal is the creator's choice: off by default, switched on or off from Payouts. While on, the
-- hourly job requests whatever is withdrawable on the chosen day (1–28, India time). It only acts on dates from
-- the moment it was switched on or its day changed (auto_withdraw_since), so turning it on for the 1st on the 31st
-- waits for the next 1st instead of sending a withdrawal straight away.

alter table public.upi_configs
  add column if not exists auto_withdraw boolean not null default false,
  add column if not exists auto_withdraw_since timestamptz;

create or replace function public.set_auto_withdrawal(p_worker uuid, p_enabled boolean, p_day integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; changed boolean;
begin
  if p_enabled is null or p_day is null or p_day not between 1 and 28 then raise exception 'invalid_input'; end if;
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into u from public.upi_configs where worker_id=p_worker for update;
  if not found then raise exception 'upi_required'; end if;
  changed := u.auto_withdraw is distinct from p_enabled or u.payout_schedule<>'Monthly' or u.payout_day is distinct from p_day::text;
  if not changed then return to_jsonb(u); end if;
  update public.upi_configs set auto_withdraw=p_enabled, payout_schedule='Monthly', payout_day=p_day::text,
    auto_withdraw_since=case when p_enabled then now() else null end
  where worker_id=p_worker returning * into u;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,case when p_enabled then 'auto_withdrawal_on' else 'auto_withdrawal_off' end,p_worker::text,jsonb_build_object('day',p_day));
  return to_jsonb(u);
end; $$;

-- Same as 202610310002, limited to creators who switched auto-withdrawal on, from their switch-on date.
create or replace function public.auto_request_payouts(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg record; today date; month_start timestamptz; created integer := 0; skipped integer := 0; result jsonb;
begin
  today := (now() at time zone 'Asia/Kolkata')::date;
  month_start := date_trunc('month', today)::timestamp at time zone 'Asia/Kolkata';
  for cfg in
    select u.worker_id from public.upi_configs u join public.profiles p on p.id=u.worker_id and p.active
    cross join lateral (select case when u.payout_schedule='Monthly' and u.payout_day ~ '^(?:[1-9]|1[0-9]|2[0-8])$' then u.payout_day::integer else 1 end as day) d
    where u.verified and u.auto_withdraw
      and extract(day from today) >= d.day
      -- This month's date must fall on or after the day auto-withdrawal was switched on (or its day changed).
      and make_date(extract(year from today)::integer, extract(month from today)::integer, d.day)
        >= coalesce((u.auto_withdraw_since at time zone 'Asia/Kolkata')::date, today)
      and not exists(select 1 from public.payout_batches x where x.worker_id=u.worker_id and x.origin='auto' and x.created_at>=month_start)
      and not exists(select 1 from public.payout_batches x where x.worker_id=u.worker_id and x.status in ('Draft','Processing'))
      and exists(select 1 from public.work_items w where w.worker_id=u.worker_id and w.status='Approved' and w.reward_inr>0
        and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed'))
    order by u.worker_id
    limit greatest(1, least(coalesce(p_limit,200), 1000))
  loop
    begin
      perform 1 from public.profiles where id=cfg.worker_id and active for update;
      -- Rechecked under the lock: the creator may have just switched it off or opened a cycle.
      if not found or not exists(select 1 from public.upi_configs where worker_id=cfg.worker_id and auto_withdraw)
        or exists(select 1 from public.payout_batches x where x.worker_id=cfg.worker_id
          and (x.status in ('Draft','Processing') or (x.origin='auto' and x.created_at>=month_start))) then
        skipped := skipped + 1;
        continue;
      end if;
      result := public.create_payout_batch(cfg.worker_id,'auto');
      created := created + 1;
    exception when others then
      if sqlerrm not in ('minimum_amount','kyc_required','upi_required') then raise; end if;
      skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('created',created,'skipped',skipped);
end; $$;

revoke all on function public.set_auto_withdrawal(uuid,boolean,integer) from public, anon, authenticated;
revoke all on function public.auto_request_payouts(integer) from public, anon, authenticated;
grant execute on function public.set_auto_withdrawal(uuid,boolean,integer) to service_role;
grant execute on function public.auto_request_payouts(integer) to service_role;

notify pgrst, 'reload schema';
