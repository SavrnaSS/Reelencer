-- Withdrawals of up to INR 1,000 no longer need KYC; larger ones need identity verification, done once.
-- A creator without approved KYC can still request a payout: it takes whole approved credits, oldest first, up to
-- INR 1,000 (lib/payoutPolicy.ts kycFreeWithdrawal mirrors this). The rest stays in the wallet until KYC is approved.
-- Approving and paying a cycle check the same rule against the cycle's own total, so a cycle over INR 1,000 is
-- never paid without approved KYC.

create or replace function public.request_payout(p_worker uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; b public.payout_batches%rowtype; ids uuid[] := '{}'; total numeric(12,2) := 0; eligible numeric(12,2);
  n integer; today date; kyc_ok boolean; item record;
begin
  -- The worker lock serializes payout requests and UPI changes across all server instances.
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  select * into b from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing');
  if found then return jsonb_build_object('batchId',b.id,'itemCount',(select count(*) from public.payout_items where batch_id=b.id),'idempotent',true); end if;
  select * into u from public.upi_configs where worker_id=p_worker and verified for update;
  if not found then raise exception 'upi_required'; end if;
  kyc_ok := exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved');
  perform 1 from public.work_items w where w.worker_id=p_worker and w.status='Approved' for update;
  eligible := 0;
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
    -- Enough earned, but only a verified creator can withdraw it (e.g. a single credit over INR 1,000).
    if eligible>=500 then raise exception 'kyc_required'; end if;
    raise exception 'minimum_amount';
  end if;
  n := coalesce(array_length(ids,1),0);
  today:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot)
    values(p_worker,case when u.payout_schedule='Monthly' then 'Month '||to_char(today,'YYYY-MM') else 'Week of '||to_char(date_trunc('week',today),'YYYY-MM-DD') end,
      date_trunc(case when u.payout_schedule='Monthly' then 'month' else 'week' end,today)::date,today,'Draft','UPI',
      case when total<eligible then '["Requested by worker","Up to INR 1,000 without KYC"]'::jsonb else '["Requested by worker"]'::jsonb end,u.upi_id) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,'payout_requested',b.id::text,jsonb_build_object('amount',total,'items',n,'kycVerified',kyc_ok,'heldBack',eligible-total));
  return jsonb_build_object('batchId',b.id,'itemCount',n,'amount',total,'heldBackForKyc',eligible-total);
end; $$;

-- Unchanged from 202610110001 except that KYC is checked only for cycles over INR 1,000.
create or replace function public.transition_payout(p_actor uuid,p_batch uuid,p_action text,p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.payout_batches%rowtype; worker uuid; needs_kyc boolean;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_id into worker from public.payout_batches where id=p_batch;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.profiles where id=worker for update;
  select * into b from public.payout_batches where id=p_batch for update;
  needs_kyc := coalesce((select sum(amount_inr) from public.payout_items where batch_id=b.id and status<>'Failed'),0) > 1000;
  if p_action='approve' then
    if b.status='Processing' then return to_jsonb(b); end if;
    if b.status<>'Draft' then raise exception 'invalid_transition'; end if;
    if needs_kyc and not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved') then raise exception 'kyc_required'; end if;
    if not exists(select 1 from public.upi_configs where worker_id=b.worker_id and verified and upi_id=b.upi_id_snapshot) then raise exception 'upi_required'; end if;
    if not exists(select 1 from public.payout_items where batch_id=b.id and status='Included') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Processing',processed_at=now(),processed_by=p_actor,
      notes=notes||case when nullif(p_note,'') is null then '[]'::jsonb else jsonb_build_array('ETA:'||p_note) end where id=b.id;
  elsif p_action='mark-paid' then
    if nullif(btrim(p_note),'') is null or length(p_note)>160 then raise exception 'invalid_transition'; end if;
    if b.status='Paid' and b.payment_reference=p_note then return to_jsonb(b); end if;
    if b.status<>'Processing' then raise exception 'invalid_transition'; end if;
    -- KYC can be revoked (or UPI changed) between approval and payment; never send a cycle over INR 1,000 then.
    if needs_kyc and not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved') then raise exception 'kyc_required'; end if;
    if not exists(select 1 from public.upi_configs where worker_id=b.worker_id and verified and upi_id=b.upi_id_snapshot) then raise exception 'upi_required'; end if;
    update public.payout_batches set status='Paid',paid_at=now(),processed_by=p_actor,payment_reference=p_note where id=b.id;
    update public.payout_items set status='Paid' where batch_id=b.id;
  elsif p_action='reject' then
    if b.status='Failed' then return to_jsonb(b); end if;
    if b.status not in ('Draft','Processing') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Failed',processed_at=now(),processed_by=p_actor,notes=notes||jsonb_build_array(coalesce(p_note,'Rejected by Admin')) where id=b.id;
    update public.payout_items set status='Failed',reason=coalesce(p_note,'Rejected by Admin') where batch_id=b.id;
  else raise exception 'invalid_transition'; end if;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'payout_'||p_action,b.id::text);
  select * into b from public.payout_batches where id=b.id;
  return to_jsonb(b);
end; $$;

revoke all on function public.request_payout(uuid) from public, anon, authenticated;
revoke all on function public.transition_payout(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.request_payout(uuid) to service_role;
grant execute on function public.transition_payout(uuid,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
