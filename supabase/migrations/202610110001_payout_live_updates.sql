-- Live payout updates for creators. The payout tables are server-only (no browser grants, not published), so the
-- old postgres_changes subscriptions never fired. Instead, triggers broadcast a content-free "changed" signal on a
-- private per-user topic; the page then re-reads everything through the authenticated API.
-- Also: a payout can only be marked paid while the worker's KYC is still approved and the UPI still verified.

-- Each user may only listen to their own payouts topic; only the server may send on it.
create policy creator_payout_updates_read on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and topic = 'payouts:' || (select auth.uid())::text);
create policy creator_payout_updates_owner on realtime.messages as restrictive
  for select to anon, authenticated
  using (topic not like 'payouts:%' or topic = 'payouts:' || (select auth.uid())::text);
create policy creator_payout_updates_server_send on realtime.messages as restrictive
  for insert to anon, authenticated
  with check (topic not like 'payouts:%');

create or replace function public.notify_worker_payout_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidates text[] := array[]::text[];
  recipient uuid;
  kind text := TG_TABLE_NAME;
begin
  -- The creator's auth user id: user_id where present (worker_kyc also has a text worker code in worker_id),
  -- otherwise worker_id. Only real UUIDs are used, so a code like 'WKR-1014' can never fail the write.
  if TG_OP <> 'INSERT' then
    candidates := candidates || coalesce(to_jsonb(OLD)->>'user_id', to_jsonb(OLD)->>'worker_id');
  end if;
  if TG_OP <> 'DELETE' then
    candidates := candidates || coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(NEW)->>'worker_id');
  end if;
  for recipient in
    select distinct c::uuid from unnest(candidates) c
      where c ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    begin
      perform realtime.send(jsonb_build_object('changedAt', clock_timestamp(), 'kind', kind),
        'changed', 'payouts:' || recipient::text, true);
    exception when others then
      -- Best effort: the page also polls, so a Broadcast outage never blocks payout writes.
      raise warning 'Payout notification unavailable (%); polling will catch up.', SQLSTATE;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.notify_worker_payout_updates() from public, anon, authenticated;

drop trigger if exists worker_payout_batch_live_update on public.payout_batches;
create trigger worker_payout_batch_live_update
  after insert or update or delete on public.payout_batches
  for each row execute function public.notify_worker_payout_updates();
drop trigger if exists worker_payout_item_live_update on public.payout_items;
create trigger worker_payout_item_live_update
  after insert or update or delete on public.payout_items
  for each row execute function public.notify_worker_payout_updates();
-- Wallet balance = approved work items (including approved view claims); ignore unrelated edits.
drop trigger if exists worker_work_item_payout_live_update on public.work_items;
create trigger worker_work_item_payout_live_update
  after insert or delete or update of status, reward_inr on public.work_items
  for each row execute function public.notify_worker_payout_updates();
drop trigger if exists worker_upi_live_update on public.upi_configs;
create trigger worker_upi_live_update
  after insert or update or delete on public.upi_configs
  for each row execute function public.notify_worker_payout_updates();
drop trigger if exists worker_kyc_live_update on public.worker_kyc;
create trigger worker_kyc_live_update
  after insert or update or delete on public.worker_kyc
  for each row execute function public.notify_worker_payout_updates();
drop trigger if exists worker_view_claim_live_update on public.view_payout_claims;
create trigger worker_view_claim_live_update
  after insert or update or delete on public.view_payout_claims
  for each row execute function public.notify_worker_payout_updates();

-- Same function as 202610040004, plus: KYC and the snapshot UPI are re-checked before money is marked as sent.
create or replace function public.transition_payout(p_actor uuid,p_batch uuid,p_action text,p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.payout_batches%rowtype; worker uuid;
begin
  if not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_id into worker from public.payout_batches where id=p_batch;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.profiles where id=worker for update;
  select * into b from public.payout_batches where id=p_batch for update;
  if p_action='approve' then
    if b.status='Processing' then return to_jsonb(b); end if;
    if b.status<>'Draft' then raise exception 'invalid_transition'; end if;
    if not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved') then raise exception 'kyc_required'; end if;
    if not exists(select 1 from public.upi_configs where worker_id=b.worker_id and verified and upi_id=b.upi_id_snapshot) then raise exception 'upi_required'; end if;
    if not exists(select 1 from public.payout_items where batch_id=b.id and status='Included') then raise exception 'invalid_transition'; end if;
    update public.payout_batches set status='Processing',processed_at=now(),processed_by=p_actor,
      notes=notes||case when nullif(p_note,'') is null then '[]'::jsonb else jsonb_build_array('ETA:'||p_note) end where id=b.id;
  elsif p_action='mark-paid' then
    if nullif(btrim(p_note),'') is null or length(p_note)>160 then raise exception 'invalid_transition'; end if;
    if b.status='Paid' and b.payment_reference=p_note then return to_jsonb(b); end if;
    if b.status<>'Processing' then raise exception 'invalid_transition'; end if;
    -- KYC can be revoked (or UPI changed) between approval and payment; never send money in that case.
    if not exists(select 1 from public.worker_kyc where user_id=b.worker_id and status='approved') then raise exception 'kyc_required'; end if;
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
revoke all on function public.transition_payout(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.transition_payout(uuid,uuid,text,text) to service_role;
