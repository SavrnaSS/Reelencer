-- KYC becomes mandatory once a creator's wallet has received more than INR 1,000 in total (all approved credits,
-- including money already paid out or in a payout). From then on every payout is blocked until KYC is approved:
-- manual requests, monthly auto-withdrawals, and approving or paying a cycle that is already open. Below that,
-- payouts need no KYC. This replaces 202610310001's per-withdrawal INR 1,000 cap, which a creator could repeat
-- every week without ever verifying. lib/payoutPolicy.ts mirrors the rule.

create or replace function public.payout_kyc_required(p_worker uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved')
    and coalesce((select sum(w.reward_inr) from public.work_items w where w.worker_id=p_worker and w.status='Approved' and w.reward_inr>0),0) > 1000;
$$;

create or replace function public.create_payout_batch(p_worker uuid, p_origin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; b public.payout_batches%rowtype; ids uuid[]; total numeric(12,2); n integer; today date;
begin
  if p_origin not in ('manual','auto') then raise exception 'invalid_input'; end if;
  select * into u from public.upi_configs where worker_id=p_worker and verified for update;
  if not found then raise exception 'upi_required'; end if;
  perform 1 from public.work_items w where w.worker_id=p_worker and w.status='Approved' for update;
  if public.payout_kyc_required(p_worker) then raise exception 'kyc_required'; end if;
  select array_agg(w.id order by w.created_at, w.id),coalesce(sum(w.reward_inr),0),count(*) into ids,total,n
    from public.work_items w where w.worker_id=p_worker and w.status='Approved' and w.reward_inr>0
    and not exists(select 1 from public.payout_items i where i.work_item_id=w.id and i.status<>'Failed');
  if total<500 then raise exception 'minimum_amount'; end if;
  today:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot,origin)
    values(p_worker,
      case when p_origin='auto' then 'Monthly auto-withdrawal · '||to_char(today,'Mon YYYY') else 'Withdrawal · '||to_char(today,'DD Mon YYYY') end,
      case when p_origin='auto' then date_trunc('month',today)::date else today end,today,'Draft','UPI',
      jsonb_build_array(case when p_origin='auto' then 'Automatic monthly withdrawal' else 'Requested by worker' end),
      u.upi_id,p_origin) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,case when p_origin='auto' then 'payout_auto_requested' else 'payout_requested' end,b.id::text,
      jsonb_build_object('amount',total,'items',n,'origin',p_origin));
  return jsonb_build_object('batchId',b.id,'itemCount',n,'amount',total,'origin',p_origin);
end; $$;

-- Unchanged from 202610310001 except the KYC check: any cycle of a creator past INR 1,000 in credits (or a cycle
-- over INR 1,000 itself) needs approved KYC to be approved or paid.
create or replace function public.transition_payout(p_actor uuid,p_batch uuid,p_action text,p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.payout_batches%rowtype; worker uuid; needs_kyc boolean;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_id into worker from public.payout_batches where id=p_batch;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.profiles where id=worker for update;
  select * into b from public.payout_batches where id=p_batch for update;
  needs_kyc := not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved')
    and (public.payout_kyc_required(b.worker_id)
      or coalesce((select sum(amount_inr) from public.payout_items where batch_id=b.id and status<>'Failed'),0) > 1000);
  if p_action='approve' then
    if b.status='Processing' then return to_jsonb(b); end if;
    if b.status<>'Draft' then raise exception 'invalid_transition'; end if;
    if needs_kyc then raise exception 'kyc_required'; end if;
    if not exists(select 1 from public.upi_configs where worker_id=b.worker_id and verified and upi_id=b.upi_id_snapshot) then raise exception 'upi_required'; end if;
    if not exists(select 1 from public.payout_items where batch_id=b.id and status='Included') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Processing',processed_at=now(),processed_by=p_actor,
      notes=notes||case when nullif(p_note,'') is null then '[]'::jsonb else jsonb_build_array('ETA:'||p_note) end where id=b.id;
  elsif p_action='mark-paid' then
    if nullif(btrim(p_note),'') is null or length(p_note)>160 then raise exception 'invalid_transition'; end if;
    if b.status='Paid' and b.payment_reference=p_note then return to_jsonb(b); end if;
    if b.status<>'Processing' then raise exception 'invalid_transition'; end if;
    -- KYC can be revoked (or UPI changed) between approval and payment; never send money in that case.
    if needs_kyc then raise exception 'kyc_required'; end if;
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

revoke all on function public.payout_kyc_required(uuid) from public, anon, authenticated;
revoke all on function public.create_payout_batch(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.transition_payout(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.payout_kyc_required(uuid) to service_role;
grant execute on function public.transition_payout(uuid,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
