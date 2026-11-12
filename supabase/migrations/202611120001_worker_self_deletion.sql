-- Creators can delete their own account from the app or the web (Google Play's account-deletion requirement).
-- It is the same deletion an administrator makes: status 'deleted' starts the 7-day restore window, and the
-- existing worker_deletion_jobs trigger (202610250002) erases the account once that window has passed.
create or replace function public.request_own_worker_deletion(p_user uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.profiles%rowtype; state public.worker_moderation%rowtype; cleaned_reason text;
begin
  -- Same lock as moderate_worker, so this never races an administrator's action on the account.
  perform pg_advisory_xact_lock(hashtext('reelencer_admin_owner'));
  select * into target from public.profiles where id=p_user for update;
  if not found then raise exception 'not_found'; end if;
  if target.role<>'Worker' or exists(select 1 from public.admin_owner where user_id=p_user) then raise exception 'forbidden'; end if;
  cleaned_reason:=left(coalesce(nullif(trim(p_reason),''),'Deleted by the creator'),1000);
  if length(cleaned_reason)<8 then cleaned_reason:='Deleted by the creator: '||cleaned_reason; end if;

  insert into public.worker_moderation(user_id,status,reason,suspended_at)
    values(p_user,case when target.active then 'active' else 'suspended' end,
      case when target.active then null else 'Account was previously inactive.' end,
      case when target.active then null else now() end)
    on conflict(user_id) do nothing;
  select * into state from public.worker_moderation where user_id=p_user for update;
  if state.status='deleted' then
    return jsonb_build_object('status','deleted','changed',false,'deletedAt',state.deleted_at,'purgeAfter',state.deleted_at+interval '168 hours');
  end if;

  update public.worker_moderation set status='deleted',reason=cleaned_reason,deleted_at=now(),updated_at=now() where user_id=p_user
    returning * into state;
  update public.profiles set active=false where id=p_user;
  update public.workers set active=false where user_id=p_user;
  insert into public.worker_moderation_events(user_id,actor_id,actor_label,action,reason,ip)
    values(p_user,p_user,'Creator (self-service)','delete',cleaned_reason,null);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(p_user,'worker_self_delete',p_user::text,jsonb_build_object('reason',cleaned_reason,'status','deleted'));
  return jsonb_build_object('status','deleted','changed',true,'deletedAt',state.deleted_at,'purgeAfter',state.deleted_at+interval '168 hours');
end; $$;

revoke all on function public.request_own_worker_deletion(uuid,text) from public,anon,authenticated;
grant execute on function public.request_own_worker_deletion(uuid,text) to service_role;
