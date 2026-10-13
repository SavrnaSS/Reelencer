-- Email Creator gigs need no approval to start: a creator can open their five work emails and inbox right away,
-- without an accepted application or approved KYC. Starting records an Accepted application (so Jobs and the admin
-- console show it like any other gig). Everything else is unchanged: other gig types still need an accepted
-- application and approved KYC, and getting paid still requires approved KYC (request_payout / transition_payout).
create or replace function public.create_gig_assignment(p_actor uuid,p_worker uuid,p_gig text,p_emails jsonb,p_subject text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.gig_assignments%rowtype; worker_code_value text; worker_name_value text; g public.gigs%rowtype;
begin
  if p_actor<>p_worker and not public.app_is_admin(p_actor) then raise exception 'forbidden'; end if;
  select worker_code, coalesce(nullif(btrim(display_name),''),worker_code) into worker_code_value, worker_name_value
    from public.profiles where id=p_worker and active for update;
  if not found then raise exception 'not_found'; end if;
  select * into a from public.gig_assignments where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) for update;
  -- Retrying creation never changes credentials, review status or timestamps.
  if found then return to_jsonb(a); end if;
  select * into g from public.gigs where id=p_gig and status='Open';
  if not found then raise exception 'invalid_transition'; end if;
  if not public.app_is_admin(p_actor) then
    if lower(btrim(coalesce(g.gig_type,''))) = 'email creator' then
      -- No approval needed: make sure an Accepted application exists for the record.
      insert into public.gig_applications(gig_id,worker_code,worker_name,status,decided_at)
        values(p_gig,worker_code_value,worker_name_value,'Accepted',now())
        on conflict(gig_id,worker_code) do update set status='Accepted',decided_at=coalesce(public.gig_applications.decided_at,now())
          where public.gig_applications.status<>'Accepted';
    else
      perform 1 from public.gig_applications where gig_id=p_gig and worker_code in(worker_code_value,p_worker::text) and status='Accepted' for share;
      if not found then raise exception 'forbidden'; end if;
      if not exists(select 1 from public.worker_kyc where user_id=p_worker and status='approved') then raise exception 'kyc_required'; end if;
    end if;
  end if;
  if jsonb_array_length(p_emails)<>5 or (select count(distinct value) from jsonb_array_elements_text(p_emails))<>5
    or exists(select 1 from jsonb_array_elements_text(p_emails) where value !~ '^[^ @]+@[^ @]+\.[^ @]+$') then raise exception 'invalid_accounts'; end if;
  insert into public.gig_assignments(gig_id,worker_code,assigned_email,assigned_emails,subject_filter)
    values(p_gig,worker_code_value,p_emails->>0,p_emails,p_subject) returning * into a;
  insert into public.audit_events(actor_id,action,resource_id) values(p_actor,'gig_assigned',a.id::text);
  return to_jsonb(a);
end; $$;
revoke all on function public.create_gig_assignment(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_gig_assignment(uuid,uuid,text,jsonb,text) to service_role;
