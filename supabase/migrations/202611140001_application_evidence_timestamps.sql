-- A biography refresh or recruiter note does not create a new application decision.
-- Preserve the existing row lock, ownership checks, compare-and-set guard and audit trail.
create or replace function public.update_gig_application(p_actor uuid,p_id uuid,p_expected jsonb,p_name text,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_applications%rowtype; is_admin boolean;
begin
  is_admin:=public.app_is_admin(p_actor);
  select * into a from public.gig_applications where id=p_id for update;
  if not found or (not is_admin and a.worker_code<>p_actor::text and not exists(select 1 from public.profiles where id=p_actor and worker_code=a.worker_code)) then raise exception 'not_found'; end if;
  if to_jsonb(a) is distinct from p_expected then raise exception 'invalid_transition'; end if;
  if p_status not in('Applied','Pending','Accepted','Rejected') or (not is_admin and p_status<>a.status) then raise exception 'forbidden'; end if;
  update public.gig_applications
    set worker_name=p_name,status=p_status,
        decided_at=case when is_admin and p_status is distinct from a.status then now() else a.decided_at end
    where id=p_id returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_application_updated',p_id::text);
  return to_jsonb(a);
end; $$;
