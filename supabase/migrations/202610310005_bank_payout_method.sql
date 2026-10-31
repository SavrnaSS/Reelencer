-- Creators can be paid to a UPI ID or a bank account (account holder, account number, IFSC).
-- upi_configs.upi_id keeps its role as the payout destination key: the UPI ID itself, or bank:<IFSC>:<account no.>.
-- Everything that protects payouts already keys on it and now covers bank accounts too: a new destination needs the
-- team's verification (verify_upi_config matches the key the team reviewed), it can't change while a payout is open,
-- each payout snapshots it, and approving or paying a payout requires the snapshot to still be the verified one.
-- Payouts also snapshot the account holder's name, so the team pays exactly what was requested.

alter table public.upi_configs
  add column if not exists method text not null default 'UPI',
  add column if not exists bank_holder_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_ifsc text;
do $$ begin
  alter table public.upi_configs add constraint upi_configs_method_check check (method in ('UPI','Bank'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.upi_configs add constraint upi_configs_bank_details_check check (
    method<>'Bank' or (bank_holder_name is not null and bank_account_number ~ '^[0-9]{9,18}$' and bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
      and upi_id = 'bank:'||bank_ifsc||':'||bank_account_number));
exception when duplicate_object then null; end $$;
alter table public.payout_batches add column if not exists payee_name_snapshot text;

-- A new destination or account holder moves the submission time (the team's queue is ordered by it).
create or replace function public.touch_upi_submission_timestamp() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    NEW.updated_at:=clock_timestamp();
  elsif (NEW.upi_id,NEW.payout_schedule,NEW.payout_day,NEW.bank_holder_name) is distinct from
        (OLD.upi_id,OLD.payout_schedule,OLD.payout_day,OLD.bank_holder_name) then
    NEW.updated_at:=clock_timestamp();
  else
    NEW.updated_at:=OLD.updated_at;
  end if;
  return NEW;
end; $$;

-- Saves the creator's payout method. A new destination (or account holder) needs verification again and can't
-- replace one while a payout is open. The auto-withdrawal settings are kept.
create or replace function public.save_payout_method(p_worker uuid, p_method text, p_upi text, p_holder text, p_account text, p_ifsc text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype; key text; holder text; account text; ifsc text; changed boolean;
begin
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  if p_method='UPI' then
    key := btrim(coalesce(p_upi,''));
    if key !~ '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$' or length(key)>100 then raise exception 'invalid_payout_method'; end if;
  elsif p_method='Bank' then
    holder := regexp_replace(btrim(coalesce(p_holder,'')),'\s+',' ','g');
    account := regexp_replace(coalesce(p_account,''),'\s','','g');
    ifsc := upper(btrim(coalesce(p_ifsc,'')));
    if char_length(holder) not between 2 and 100 or holder !~ '^[A-Za-z][A-Za-z .''-]*$'
      or account !~ '^[0-9]{9,18}$' or ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'invalid_payout_method'; end if;
    key := 'bank:'||ifsc||':'||account;
  else
    raise exception 'invalid_payout_method';
  end if;
  select * into u from public.upi_configs where worker_id=p_worker for update;
  changed := not found or u.upi_id is distinct from key or u.method is distinct from p_method
    or coalesce(u.bank_holder_name,'') is distinct from coalesce(holder,'');
  if not changed then return to_jsonb(u); end if;
  if exists(select 1 from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing')) then raise exception 'active_batch'; end if;
  insert into public.upi_configs(worker_id,upi_id,payout_schedule,payout_day,method,bank_holder_name,bank_account_number,bank_ifsc,verified)
    values(p_worker,key,'Monthly','1',p_method,holder,account,ifsc,false)
  on conflict(worker_id) do update set upi_id=excluded.upi_id, method=excluded.method,
    bank_holder_name=excluded.bank_holder_name, bank_account_number=excluded.bank_account_number, bank_ifsc=excluded.bank_ifsc,
    verified=false, verified_at=null, verified_by=null
  returning * into u;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,'payout_method_saved',p_worker::text,jsonb_build_object('method',p_method,
      'destination',case when p_method='Bank' then ifsc||' ····'||right(account,4) else key end));
  return to_jsonb(u);
end; $$;

-- The older UPI-only save (kept for compatibility) switches the method back to UPI and clears bank details.
create or replace function public.save_upi_config(p_worker uuid,p_upi text,p_schedule text,p_day text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.upi_configs%rowtype;
begin
  perform 1 from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'forbidden'; end if;
  if p_upi !~ '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$' or length(p_upi)>100 or p_schedule not in ('Weekly','Monthly') then raise exception 'invalid_transition'; end if;
  select * into u from public.upi_configs where worker_id=p_worker;
  if u.upi_id is distinct from p_upi and exists(select 1 from public.payout_batches where worker_id=p_worker and status in ('Draft','Processing')) then raise exception 'active_batch'; end if;
  insert into public.upi_configs(worker_id,upi_id,payout_schedule,payout_day) values(p_worker,p_upi,p_schedule,p_day)
  on conflict(worker_id) do update set upi_id=excluded.upi_id,payout_schedule=excluded.payout_schedule,payout_day=excluded.payout_day,
    method='UPI', bank_holder_name=null, bank_account_number=null, bank_ifsc=null,
    verified=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified else false end,
    verified_at=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified_at else null end,
    verified_by=case when public.upi_configs.upi_id=excluded.upi_id then public.upi_configs.verified_by else null end
  returning * into u;
  return to_jsonb(u);
end; $$;

-- Same as 202610310004, plus the payout method and account holder snapshot.
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
  insert into public.payout_batches(worker_id,cycle_label,period_start,period_end,status,method,notes,upi_id_snapshot,payee_name_snapshot,origin)
    values(p_worker,
      case when p_origin='auto' then 'Monthly auto-withdrawal · '||to_char(today,'Mon YYYY') else 'Withdrawal · '||to_char(today,'DD Mon YYYY') end,
      case when p_origin='auto' then date_trunc('month',today)::date else today end,today,'Draft',u.method,
      jsonb_build_array(case when p_origin='auto' then 'Automatic monthly withdrawal' else 'Requested by worker' end),
      u.upi_id,u.bank_holder_name,p_origin) returning * into b;
  insert into public.payout_items(batch_id,work_item_id,worker_id,handle,amount_inr,status)
    select b.id,w.id,p_worker,coalesce(a.handle,''),w.reward_inr,'Included' from public.work_items w left join public.accounts a on a.id=w.account_id where w.id=any(ids);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_worker,case when p_origin='auto' then 'payout_auto_requested' else 'payout_requested' end,b.id::text,
      jsonb_build_object('amount',total,'items',n,'origin',p_origin,'method',u.method));
  return jsonb_build_object('batchId',b.id,'itemCount',n,'amount',total,'origin',p_origin,'method',u.method);
end; $$;

revoke all on function public.save_payout_method(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.save_upi_config(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.create_payout_batch(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.touch_upi_submission_timestamp() from public, anon, authenticated;
grant execute on function public.save_payout_method(uuid,text,text,text,text,text) to service_role;
grant execute on function public.save_upi_config(uuid,text,text,text) to service_role;

notify pgrst, 'reload schema';
