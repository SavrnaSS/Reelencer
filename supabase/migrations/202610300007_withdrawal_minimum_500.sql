-- Lower the withdrawal minimum to INR 500. Preserve locking, eligibility,
-- reservations, UPI snapshots and idempotent retries for existing requests.
create or replace function public.request_payout(p_worker uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; b public.payout_batches%rowtype; ids uuid[]; total numeric(12,2); n integer; today date;
begin
  -- The worker lock serializes payout requests and UPI changes across all server instances.
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into b from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing');
  if found then return jsonb_build_object('batchId',b.id,'itemCount',(select count(*) from public.payout_items where batch_id=b.id),'idempotent',true); end if;
  if not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved') then raise exception 'kyc_required'; end if;
  select * into u from public.upi_configs where worker_id=p_worker and verified for update;
  if not found then raise exception 'upi_required'; end if;
  perform 1 from public.work_items w where w.worker_id=p_worker and w.status='Approved' for update;
  select array_agg(w.id),coalesce(sum(w.reward_inr),0),count(*) into ids,total,n
    from public.work_items w where w.worker_id=p_worker and w.status='Approved' and w.reward_inr>0
    and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed');
  if total<500 then raise exception 'minimum_amount'; end if;
  today:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot)
    values(p_worker,case when u.payout_schedule='Monthly' then 'Month '||to_char(today,'YYYY-MM') else 'Week of '||to_char(date_trunc('week',today),'YYYY-MM-DD') end,
      date_trunc(case when u.payout_schedule='Monthly' then 'month' else 'week' end,today)::date,today,'Draft','UPI','["Requested by worker"]',u.upi_id) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details) values(p_worker,'payout_requested',b.id::text,jsonb_build_object('amount',total,'items',n));
  return jsonb_build_object('batchId',b.id,'itemCount',n);
end; $$;
