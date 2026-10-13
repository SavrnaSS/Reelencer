-- API authorization is complemented by database permissions. Sensitive tables are server-only.
do $$
declare t text; p record;
begin
  foreach t in array array['profiles','workers','accounts','assignments','worker_account_assignments','worker_accounts',
    'work_items','work_item_audit','gigs','gig_applications','gig_assignments','gig_account_credentials','gig_inbox',
    'worker_kyc','worker_kyc_events','upi_configs','payout_batches','payout_items','work_email_secret_codes',
    'work_email_accounts','work_email_inbox','dashboard_feedback','api_rate_limits','audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end $$;
grant select(id,role,worker_code,display_name,email,active,timezone,created_at) on public.profiles to authenticated;
create policy own_profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
grant usage,select on sequence public.worker_code_sequence to service_role;
-- SECURITY DEFINER functions must never inherit PostgreSQL's default PUBLIC EXECUTE privilege.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.proname in ('app_is_admin','bootstrap_worker','consume_api_rate_limit','transition_work_item',
      'cleanup_scheduled_work','prepare_worker_deletion','submit_worker_kyc','review_worker_kyc','create_gig_assignment','submit_gig_application','update_gig_application','provision_worker','unassign_account','delete_unused_account','refresh_scheduled_work','schedule_account_work','schedule_all_work','worker_metrics','review_gig_assignment','save_upi_config','verify_upi_config','request_payout','transition_payout','submit_gig_credentials','create_work_email_account') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('kyc','kyc',false,10485760,array['image/jpeg','image/png','application/pdf']),
  ('worker-profile-media','worker-profile-media',false,52428800,array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png']),
  ('gig-brief-media','gig-brief-media',true,52428800,array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists reelencer_private_objects on storage.objects;
create policy reelencer_private_objects on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id not in ('kyc','worker-profile-media')) with check (bucket_id not in ('kyc','worker-profile-media','gig-brief-media'));
create or replace function public.reelencer_backend_version() returns integer language sql stable set search_path='' as $$select 1$$;
revoke all on function public.reelencer_backend_version() from public,anon,authenticated;
grant execute on function public.reelencer_backend_version() to service_role;
