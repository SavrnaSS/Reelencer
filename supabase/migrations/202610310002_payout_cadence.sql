-- Withdrawal cadence: a creator can request a withdrawal themselves once every 7 days, and whatever is withdrawable
-- is requested automatically once a month on the creator's chosen day (upi_configs.payout_day when the schedule is
-- 'Monthly', otherwise the 1st; India time). Both use the same batch builder, so the INR 500 minimum and the
-- INR 1,000 KYC-free limit from 202610310001 apply to both. lib/payoutPolicy.ts mirrors these rules.

alter table public.payout_batches add column if not exists origin text not null default 'manual';
do $$ begin
  alter table public.payout_batches add constraint payout_batches_origin_check check (origin in ('manual','auto'));
exception when duplicate_object then null; end $$;
create index if not exists payout_batches_worker_origin_created_idx on public.payout_batches(worker_id, origin, created_at desc);

-- Builds one payout cycle from the creator's withdrawable credits. Callers hold the worker lock and have checked
-- that no cycle is open. Not callable through the API.
create or replace function public.create_payout_batch(p_worker uuid, p_origin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; b public.payout_batches%rowtype; ids uuid[] := '{}'; total numeric(12,2) := 0; eligible numeric(12,2) := 0;
  n integer; today date; kyc_ok boolean; item record;
begin
  if p_origin not in ('manual','auto') then raise exception 'invalid_input'; end if;
  select * into u from public.upi_configs where worker_id=p_worker and verified for update;
  if not found then raise exception 'upi_required'; end if;
  kyc_ok := exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved');
  perform 1 from public.work_items w where w.worker_id=p_worker and w.status='Approved' for update;
  for item in
    select w.id, w.reward_inr from public.work_items w
    where w.worker_id=p_worker and w.status='Approved' and w.reward_inr>0
      and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed')
    order by w.created_at, w.id
  loop
    eligible := eligible + item.reward_inr;
    if kyc_ok or total + item.reward_inr <= 1000 then
      ids := ids || item.id;
      total := total + item.reward_inr;
    end if;
  end loop;
  if total<500 then
    if eligible>=500 then raise exception 'kyc_required'; end if;
    raise exception 'minimum_amount';
  end if;
  n := coalesce(array_length(ids,1),0);
  today:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot,origin)
    values(p_worker,
      case when p_origin='auto' then 'Monthly auto-withdrawal · '||to_char(today,'Mon YYYY') else 'Withdrawal · '||to_char(today,'DD Mon YYYY') end,
      case when p_origin='auto' then date_trunc('month',today)::date else today end,today,'Draft','UPI',
      jsonb_build_array(case when p_origin='auto' then 'Automatic monthly withdrawal' else 'Requested by worker' end)
        || case when total<eligible then '["Up to INR 1,000 without KYC"]'::jsonb else '[]'::jsonb end,
      u.upi_id,p_origin) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,case when p_origin='auto' then 'payout_auto_requested' else 'payout_requested' end,b.id::text,
      jsonb_build_object('amount',total,'items',n,'kycVerified',kyc_ok,'heldBack',eligible-total,'origin',p_origin));
  return jsonb_build_object('batchId',b.id,'itemCount',n,'amount',total,'heldBackForKyc',eligible-total,'origin',p_origin);
end; $$;

-- Manual request: one every 7 days. A cycle the team rejected doesn't count, so the creator can fix and retry.
create or replace function public.request_payout(p_worker uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.payout_batches%rowtype; last_manual timestamptz;
begin
  -- The worker lock serializes payout requests, auto-withdrawals and UPI changes across all server instances.
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into b from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing');
  if found then return jsonb_build_object('batchId',b.id,'itemCount',(select count(*) from public.payout_items where batch_id=b.id),'idempotent',true); end if;
  if not exists(select 1 from public.upi_configs where worker_id=p_worker and verified) then raise exception 'upi_required'; end if;
  select max(created_at) into last_manual from public.payout_batches where worker_id=p_worker and origin='manual' and status<>'Failed';
  if last_manual is not null and last_manual > now() - interval '7 days' then raise exception 'weekly_limit'; end if;
  return public.create_payout_batch(p_worker,'manual');
end; $$;

-- Monthly auto-withdrawal, run hourly by the job scheduler. From the creator's chosen day until the month ends, it
-- tries once per run until this month has an automatic cycle (a cycle the team rejects still counts, so a problem
-- isn't retried every hour). Creators below the minimum, or blocked by KYC, are skipped and retried next run.
create or replace function public.auto_request_payouts(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg record; today date; month_start timestamptz; created integer := 0; skipped integer := 0; result jsonb;
begin
  today := (now() at time zone 'Asia/Kolkata')::date;
  month_start := date_trunc('month', today)::timestamp at time zone 'Asia/Kolkata';
  for cfg in
    select u.worker_id from public.upi_configs u join public.profiles p on p.id=u.worker_id and p.active
    where u.verified
      and extract(day from today) >= case when u.payout_schedule='Monthly' and u.payout_day ~ '^(?:[1-9]|1[0-9]|2[0-8])$' then u.payout_day::integer else 1 end
      and not exists(select 1 from public.payout_batches x where x.worker_id=u.worker_id and x.origin='auto' and x.created_at>=month_start)
      and not exists(select 1 from public.payout_batches x where x.worker_id=u.worker_id and x.status in ('Draft','Processing'))
      and exists(select 1 from public.work_items w where w.worker_id=u.worker_id and w.status='Approved' and w.reward_inr>0
        and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed'))
    order by u.worker_id
    limit greatest(1, least(coalesce(p_limit,200), 1000))
  loop
    begin
      perform 1 from public.profiles where id=cfg.worker_id and active for update;
      -- Rechecked under the lock: a manual request or another run may have just opened a cycle.
      if not found or exists(select 1 from public.payout_batches x where x.worker_id=cfg.worker_id
          and (x.status in ('Draft','Processing') or (x.origin='auto' and x.created_at>=month_start))) then
        skipped := skipped + 1;
        continue;
      end if;
      result := public.create_payout_batch(cfg.worker_id,'auto');
      created := created + 1;
    exception when others then
      -- minimum_amount / kyc_required / upi_required: nothing to send this time.
      if sqlerrm not in ('minimum_amount','kyc_required','upi_required') then raise; end if;
      skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('created',created,'skipped',skipped);
end; $$;

revoke all on function public.create_payout_batch(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.request_payout(uuid) from public, anon, authenticated;
revoke all on function public.auto_request_payouts(integer) from public, anon, authenticated;
grant execute on function public.request_payout(uuid) to service_role;
grant execute on function public.auto_request_payouts(integer) to service_role;

notify pgrst, 'reload schema';
